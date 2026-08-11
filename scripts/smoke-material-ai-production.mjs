import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apiOrigin = String(process.env.SMOKE_API_ORIGIN || "http://127.0.0.1:8411/api").replace(/\/$/, "");
const users = [];
const storagePaths = [];

assert.match(supabaseUrl, /^https:\/\/[a-z0-9-]+\.supabase\.co$/, "SUPABASE_URL is invalid");
assert.ok(serviceKey, "SUPABASE_SERVICE_ROLE_KEY is required");
assert.equal(process.env.FEATURE_MATERIAL_AI, "true", "Materials AI must be enabled for the public smoke");
assert.notEqual(process.env.MATERIAL_AI_FAKE_PROVIDER, "true", "production smoke refuses the fake provider");

const adminHeaders = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};

async function body(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function request(name, url, init = {}, expected = [200, 201], timeout = 30_000) {
  let response;
  try { response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) }); }
  catch (error) { throw new Error(`${name} could not reach its target`, { cause: error }); }
  const value = await body(response);
  if (!expected.includes(response.status)) {
    const safe = value && typeof value === "object"
      ? JSON.stringify({ code: value.code, message: value.message }) : String(value || "");
    throw new Error(`${name} returned HTTP ${response.status}: ${safe}`);
  }
  return value;
}

function authHeaders(token) {
  return { apikey: serviceKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function createUser() {
  const suffix = `${Date.now()}-${randomBytes(5).toString("hex")}`;
  const email = `nalanda-material-ai-release-${suffix}@example.invalid`;
  const password = `Nalanda-${randomBytes(24).toString("base64url")}!`;
  const created = await request("temporary user creation", `${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST", headers: adminHeaders,
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: "Materials AI release smoke" } }),
  });
  users.push(created.id);
  const signed = await request("temporary user sign-in", `${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: serviceKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.ok(signed.access_token);
  return { id: created.id, token: signed.access_token };
}

async function createSource(user) {
  const course = await request("Materials course creation", `${supabaseUrl}/rest/v1/courses`, {
    method: "POST", headers: { ...authHeaders(user.token), Prefer: "return=representation" },
    body: JSON.stringify({ code: "AI-SMOKE", name: "Materials AI protected release" }),
  });
  const content = Buffer.from(
    "Working memory holds information for current tasks. Long-term memory stores durable knowledge. Retrieval practice improves later recall.",
  );
  const storagePath = `${user.id}/${randomUUID()}.txt`;
  storagePaths.push(storagePath);
  await request("private material upload", `${supabaseUrl}/storage/v1/object/materials/${storagePath}`, {
    method: "POST",
    headers: { ...authHeaders(user.token), "Content-Type": "text/plain", "x-upsert": "false" },
    body: content,
  });
  const material = await request("material record creation", `${supabaseUrl}/rest/v1/materials`, {
    method: "POST", headers: { ...authHeaders(user.token), Prefer: "return=representation" },
    body: JSON.stringify({
      course_id: course[0].id, name: "release-smoke.txt", type: "txt",
      size_bytes: content.length, storage_path: storagePath,
    }),
  });
  return { course: course[0], material: material[0] };
}

async function waitForJob(user, jobId) {
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    const job = await request("generation status", `${apiOrigin}/ai-jobs/${jobId}`, { headers: authHeaders(user.token) });
    if (job.status === "succeeded") return job;
    if (job.status === "failed" || job.status === "cancelled") {
      throw new Error(`generation ended with ${job.errorCode || job.status}: ${job.errorMessage || ""}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("generation did not finish before the protected smoke deadline");
}

function answerFor(question) {
  if (question.type === "single_choice") return 0;
  if (question.type === "multiple_choice") return [0];
  if (question.type === "true_false") return true;
  if (question.type === "fill_blank") return "working memory";
  return "Retrieval practice strengthens the ability to retrieve durable memories later.";
}

async function waitForGrading(user, attemptId) {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const attempt = await request("grading status", `${apiOrigin}/exam-attempts/${attemptId}`, { headers: authHeaders(user.token) });
    if (attempt.status === "completed") return attempt;
    if (attempt.status === "submitted_ungraded") throw new Error("grading quota was unexpectedly unavailable");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("grading did not finish before the protected smoke deadline");
}

async function providerFacts(jobId, attemptId) {
  const query = new URLSearchParams({
    select: "job_id,attempt_id,purpose,model,provider_request_id,total_tokens,cost_micro_usd,zdr_enforced,status",
    or: `(job_id.eq.${jobId},attempt_id.eq.${attemptId})`,
    order: "id.asc",
  });
  const rows = await request("provider usage facts", `${supabaseUrl}/rest/v1/ai_provider_usage_events?${query}`, { headers: adminHeaders });
  assert.ok(rows.some((row) => row.job_id === jobId && row.model === "deepseek/deepseek-v4-flash-0731"));
  assert.ok(rows.some((row) => row.attempt_id === attemptId && row.purpose === "exam_grading"));
  assert.ok(rows.every((row) => row.zdr_enforced === true && row.status === "succeeded"));
  assert.ok(rows.every((row) => typeof row.provider_request_id === "string" && row.provider_request_id));
  assert.ok(rows.every((row) => Number.isSafeInteger(row.total_tokens) && Number.isSafeInteger(row.cost_micro_usd)));
  return rows.length;
}

async function cleanup() {
  for (const path of storagePaths) {
    await request("Storage fallback cleanup", `${supabaseUrl}/storage/v1/object/materials/${path}`, {
      method: "DELETE", headers: adminHeaders,
    }, [200, 404]).catch(() => undefined);
  }
  for (const id of users) {
    await request("temporary user cleanup", `${supabaseUrl}/auth/v1/admin/users/${id}`, {
      method: "DELETE", headers: adminHeaders,
    }, [200, 204, 404]).catch(() => undefined);
  }
}

try {
  const coreHealth = await request("API readiness", `${apiOrigin}/health`);
  assert.equal(coreHealth.status, "ok");
  assert.equal(coreHealth.deps?.supabase, "ok");
  const aiHealth = await request("AI readiness", `${apiOrigin}/health/ai`);
  assert.equal(aiHealth.status, "ok");
  assert.equal(aiHealth.deps?.worker, "ok");

  const user = await createUser();
  const source = await createSource(user);
  const created = await request("public generation creation", `${apiOrigin}/materials/${source.material.id}/ai-jobs`, {
    method: "POST", headers: authHeaders(user.token),
    body: JSON.stringify({
      idempotencyKey: randomUUID(), kind: "exam", consentVersion: 1,
      settings: {
        language: "en", difficulty: "mixed", durationMinutes: 30, totalMarks: 20,
        questionCounts: { singleChoice: 4, multipleChoice: 0, trueFalse: 0, fillBlank: 0, shortAnswer: 1, essay: 0 },
        answerDetail: "detailed", focus: "",
      },
    }),
  });
  const finished = await waitForJob(user, created.id);
  assert.ok(finished.noteId);
  const note = await request("generated note", `${apiOrigin}/notes/${finished.noteId}`, { headers: authHeaders(user.token) });
  assert.equal(note.courseId, source.course.id);
  assert.equal(note.exam.sections.flatMap((section) => section.questions).length, 5);

  let attempt = await request("timed attempt creation", `${apiOrigin}/notes/${note.id}/exam-attempts`, {
    method: "POST", headers: authHeaders(user.token), body: "{}",
  });
  const hidden = JSON.stringify(attempt.exam);
  for (const secretField of ["correctOptionIndexes", "acceptedAnswers", "modelAnswer", "explanation", "rubric"]) {
    assert.ok(!hidden.includes(secretField), `exam session leaked ${secretField}`);
  }
  const questions = attempt.exam.sections.flatMap((section) => section.questions);
  attempt = await request("revisioned answer save", `${apiOrigin}/exam-attempts/${attempt.id}/answers`, {
    method: "PATCH", headers: authHeaders(user.token),
    body: JSON.stringify({
      operationId: randomUUID(), expectedRevision: attempt.revision,
      answers: questions.map((question) => ({ questionId: question.id, value: answerFor(question) })),
    }),
  });
  attempt = await request("exam submission", `${apiOrigin}/exam-attempts/${attempt.id}/submit`, {
    method: "POST", headers: authHeaders(user.token),
    body: JSON.stringify({ operationId: randomUUID(), expectedRevision: attempt.revision }),
  });
  assert.equal(attempt.status, "grading");
  const completed = await waitForGrading(user, attempt.id);
  assert.ok(Number.isFinite(completed.totalScore));

  const quota = await request("Free plan quota", `${apiOrigin}/profile/ai-quota`, { headers: authHeaders(user.token) });
  assert.deepEqual({ plan: quota.plan, generation: quota.generation.consumed, grading: quota.grading.consumed },
    { plan: "free", generation: 1, grading: 1 });
  const usageEvents = await providerFacts(created.id, attempt.id);
  await request("transactional source and result deletion", `${apiOrigin}/material-courses/${source.course.id}?aiResults=delete`, {
    method: "DELETE", headers: authHeaders(user.token),
  });
  const noteAfterDelete = await request("deleted note verification", `${apiOrigin}/notes/${note.id}`, {
    headers: authHeaders(user.token),
  }, [404]);
  assert.equal(noteAfterDelete.code, "NOTE_NOT_FOUND");
  storagePaths.length = 0;
  console.log(JSON.stringify({
    ok: true,
    generationJob: "succeeded",
    grading: "completed",
    quota: { generation: 1, grading: 1 },
    usageEvents,
    sourceAndResultsDeleted: true,
    deps: { supabase: coreHealth.deps.supabase, ai: aiHealth.deps.worker },
  }));
} finally {
  await cleanup();
}
