import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apiOrigin = String(process.env.SMOKE_API_ORIGIN || "http://127.0.0.1:8411/api").replace(/\/$/, "");
const expectLunaEnabled = String(process.env.MATERIAL_AI_EXPECT_LUNA_ENABLED || "true") === "true";
const users = [];
const storagePaths = [];

assert.match(supabaseUrl, /^https:\/\/[a-z0-9-]+\.supabase\.co$/, "SUPABASE_URL is invalid");
assert.ok(serviceKey, "SUPABASE_SERVICE_ROLE_KEY is required");
assert.equal(process.env.FEATURE_MATERIAL_AI, "true", "Materials AI must be enabled for the public smoke");
assert.equal(
  process.env.FEATURE_MATERIAL_AI_LUNA,
  String(expectLunaEnabled),
  "Luna native-file processing did not match the protected provider gate",
);
assert.notEqual(
  process.env.FEATURE_MATERIAL_AI_OX_ALPHA,
  "true",
  "the retired Ox Alpha pipeline must stay disabled in production",
);
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

function fixedPdf(text) {
  const escaped = text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n",
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  let value = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) { offsets.push(Buffer.byteLength(value)); value += object; }
  const xref = Buffer.byteLength(value);
  value += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\n`;
  value += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(value);
}

async function createNativeSource(user, course) {
  const content = fixedPdf("Working memory supports current tasks. Retrieval practice strengthens durable recall.");
  const storagePath = `${user.id}/${randomUUID()}.pdf`;
  storagePaths.push(storagePath);
  await request("private native PDF upload", `${supabaseUrl}/storage/v1/object/materials/${storagePath}`, {
    method: "POST", headers: { ...authHeaders(user.token), "Content-Type": "application/pdf", "x-upsert": "false" },
    body: content,
  });
  const material = await request("native material record creation", `${supabaseUrl}/rest/v1/materials`, {
    method: "POST", headers: { ...authHeaders(user.token), Prefer: "return=representation" },
    body: JSON.stringify({
      course_id: course.id, name: "release-smoke.pdf", type: "pdf",
      size_bytes: content.length, storage_path: storagePath,
    }),
  });
  return material[0];
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

async function waitForKnowledgeQuestion(user, questionId) {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const question = await request("knowledge question status", `${apiOrigin}/knowledge-questions/${questionId}`, {
      headers: authHeaders(user.token),
    });
    if (question.status === "succeeded") return question;
    if (question.status === "failed" || question.status === "cancelled") {
      throw new Error(`knowledge question ended with ${question.errorCode || question.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("knowledge question did not finish before the protected smoke deadline");
}

async function providerFacts(
  jobIds, attemptId, lunaJobIds, lunaAttempt,
) {
  const generationQuery = new URLSearchParams({
    select: "job_id,attempt_id,purpose,model,provider_request_id,total_tokens,cost_micro_usd,zdr_enforced,status,pipeline,upstream_provider,upstream_endpoint",
    job_id: `in.(${jobIds.join(",")})`,
    order: "id.asc",
  });
  const gradingQuery = new URLSearchParams({
    select: "job_id,attempt_id,purpose,model,provider_request_id,total_tokens,cost_micro_usd,zdr_enforced,status,pipeline,upstream_provider,upstream_endpoint",
    attempt_id: `eq.${attemptId}`,
    order: "id.asc",
  });
  const [generationRows, gradingRows] = await Promise.all([
    request("generation provider usage facts", `${supabaseUrl}/rest/v1/ai_provider_usage_events?${generationQuery}`, { headers: adminHeaders }),
    request("grading provider usage facts", `${supabaseUrl}/rest/v1/ai_provider_usage_events?${gradingQuery}`, { headers: adminHeaders }),
  ]);
  const rows = [...generationRows, ...gradingRows];
  const succeeded = (predicate) => rows.some((row) => row.status === "succeeded" && predicate(row));
  assert.ok(succeeded((row) => row.job_id === jobIds[0] && row.purpose === "safety_audit"));
  assert.ok(succeeded((row) => row.job_id === jobIds[0] && row.purpose === "exam_generation"));
  assert.ok(succeeded((row) => row.job_id === jobIds[1] && row.purpose === "knowledge_graph_generation"));
  assert.ok(succeeded((row) => row.job_id === jobIds[2] && row.purpose === "knowledge_node_question"));
  if (jobIds.length === 5) {
    assert.ok(succeeded((row) => row.job_id === jobIds[3] && row.purpose === "knowledge_graph_generation"));
    assert.ok(succeeded((row) => row.job_id === jobIds[4] && row.purpose === "knowledge_node_question"));
  }
  assert.ok(succeeded((row) => row.attempt_id === attemptId && row.purpose === "exam_grading"));
  assert.ok(rows.every((row) => row.zdr_enforced === true));
  assert.ok(rows.every((row) => row.status === "succeeded" || row.status === "failed"));
  const succeededRows = rows.filter((row) => row.status === "succeeded");
  assert.ok(succeededRows.every((row) => typeof row.provider_request_id === "string" && row.provider_request_id));
  assert.ok(succeededRows.every((row) => Number.isSafeInteger(row.total_tokens) && Number.isSafeInteger(row.cost_micro_usd)));
  const lunaRows = rows.filter((row) => lunaJobIds.includes(row.job_id) || (lunaAttempt && row.attempt_id === attemptId));
  assert.equal(lunaRows.length > 0, expectLunaEnabled);
  assert.ok(lunaRows.every((row) => row.pipeline === "luna_native_file_v1"));
  assert.ok(lunaRows.every((row) => row.model === "openai/gpt-6-luna"));
  const succeededLunaRows = lunaRows.filter((row) => row.status === "succeeded");
  assert.ok(succeededLunaRows.every((row) => row.upstream_provider === "Azure"));
  assert.ok(succeededLunaRows.every((row) => typeof row.upstream_endpoint === "string" && row.upstream_endpoint));
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
  const nativeMaterial = await createNativeSource(user, source.course);
  const capabilities = await request("native-file capabilities", `${apiOrigin}/materials/${nativeMaterial.id}/ai-capabilities`, {
    headers: authHeaders(user.token),
  });
  const lunaCapability = capabilities.capabilities.find((entry) => entry.pipeline === "luna_native_file_v1");
  assert.ok(lunaCapability);
  assert.equal(lunaCapability.available, expectLunaEnabled);
  assert.equal(lunaCapability.default, expectLunaEnabled);
  if (!expectLunaEnabled) assert.equal(lunaCapability.reasonCode, "OPENROUTER_ZDR_UNAVAILABLE");
  assert.ok(!capabilities.capabilities.some((entry) => entry.pipeline === "ox_alpha_native_file_v1"));
  const examMaterial = expectLunaEnabled ? nativeMaterial : source.material;
  const examPipeline = expectLunaEnabled ? "luna_native_file_v1" : "document_ir_v1";
  const created = await request("public exam generation creation", `${apiOrigin}/materials/${examMaterial.id}/ai-jobs`, {
    method: "POST", headers: authHeaders(user.token),
    body: JSON.stringify({
      idempotencyKey: randomUUID(), kind: "exam", pipeline: examPipeline, consentVersion: 1,
      settings: {
        language: "en", difficulty: "mixed", durationMinutes: 30, totalMarks: 20,
        questionCounts: { singleChoice: 4, multipleChoice: 0, trueFalse: 0, fillBlank: 0, shortAnswer: 1, essay: 0 },
        answerDetail: "detailed", focus: "",
      },
    }),
  });
  const finished = await waitForJob(user, created.id);
  assert.ok(finished.noteId);
  assert.equal(finished.pipeline, examPipeline);
  assert.equal(finished.model, expectLunaEnabled
    ? "openai/gpt-6-luna"
    : "deepseek/deepseek-v4-flash-0731");
  const note = await request("generated note", `${apiOrigin}/notes/${finished.noteId}`, { headers: authHeaders(user.token) });
  assert.equal(note.courseId, source.course.id);
  assert.equal(note.pipeline, examPipeline);
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

  const graphCreated = await request("public knowledge organization creation", `${apiOrigin}/materials/${source.material.id}/ai-jobs`, {
    method: "POST", headers: authHeaders(user.token),
    body: JSON.stringify({
      idempotencyKey: randomUUID(), kind: "knowledge_graph", consentVersion: 1,
      pipeline: "document_ir_v1",
      settings: { language: "en", detail: "comprehensive", focus: "" },
    }),
  });
  const graphFinished = await waitForJob(user, graphCreated.id);
  const graphNote = await request("generated knowledge note", `${apiOrigin}/notes/${graphFinished.noteId}`, {
    headers: authHeaders(user.token),
  });
  assert.equal(graphNote.kind, "ai_knowledge_graph");
  assert.ok(graphNote.graph.nodes.length > 0);
  assert.ok(graphNote.graph.nodes.every((node, index, nodes) => index === 0 || node.sourceOrder >= nodes[index - 1].sourceOrder));
  assert.ok(graphNote.graph.nodes.every((node) => node.explanation && node.sourceRefs.length));
  const layout = await request("knowledge graph layout", `${apiOrigin}/notes/${graphNote.id}/knowledge-graph-layout`, {
    headers: authHeaders(user.token),
  });
  const savedLayout = await request("knowledge graph layout save", `${apiOrigin}/notes/${graphNote.id}/knowledge-graph-layout`, {
    method: "PUT", headers: authHeaders(user.token),
    body: JSON.stringify({
      artifactVersion: layout.artifactVersion, expectedRevision: layout.revision,
      positions: [{ nodeId: graphNote.graph.nodes[0].id, x: 24, y: 48 }],
      viewport: { x: 3, y: 5, zoom: 1.2 },
    }),
  });
  assert.equal(savedLayout.revision, 1);
  const selectedNode = graphNote.graph.nodes[0];
  const questionCreated = await request("grounded knowledge question creation", `${apiOrigin}/notes/${graphNote.id}/knowledge-nodes/${selectedNode.id}/questions`, {
    method: "POST", headers: authHeaders(user.token),
    body: JSON.stringify({ idempotencyKey: randomUUID(), question: "Explain this point in simpler terms." }),
  });
  const questionAnswered = await waitForKnowledgeQuestion(user, questionCreated.id);
  assert.ok(questionAnswered.answer?.answer);
  assert.ok(questionAnswered.answer.sourceRefs.every((ref) => selectedNode.sourceRefs.some((source) => source.blockId === ref.blockId)));

  let nativeGraphCreated = null;
  let nativeGraphNote = null;
  let nativeQuestionCreated = null;
  if (expectLunaEnabled) {
    nativeGraphCreated = await request("public native knowledge organization", `${apiOrigin}/materials/${nativeMaterial.id}/ai-jobs`, {
      method: "POST", headers: authHeaders(user.token),
      body: JSON.stringify({
        idempotencyKey: randomUUID(), kind: "knowledge_graph", pipeline: "luna_native_file_v1", consentVersion: 1,
        settings: { language: "en", detail: "comprehensive", focus: "" },
      }),
    });
    const nativeGraphFinished = await waitForJob(user, nativeGraphCreated.id);
    nativeGraphNote = await request("native knowledge note", `${apiOrigin}/notes/${nativeGraphFinished.noteId}`, {
      headers: authHeaders(user.token),
    });
    assert.equal(nativeGraphNote.pipeline, "luna_native_file_v1");
    assert.equal(nativeGraphNote.model, "openai/gpt-6-luna");
    assert.ok(nativeGraphNote.graph.nodes.length > 0);
    const nativeNode = nativeGraphNote.graph.nodes[0];
    nativeQuestionCreated = await request("native grounded question creation", `${apiOrigin}/notes/${nativeGraphNote.id}/knowledge-nodes/${nativeNode.id}/questions`, {
      method: "POST", headers: authHeaders(user.token),
      body: JSON.stringify({ idempotencyKey: randomUUID(), question: "Explain this native-file point simply." }),
    });
    const nativeQuestionAnswered = await waitForKnowledgeQuestion(user, nativeQuestionCreated.id);
    assert.equal(nativeQuestionAnswered.pipeline, "luna_native_file_v1");
    assert.ok(nativeQuestionAnswered.answer?.answer);
  }

  const quota = await request("Free plan quota", `${apiOrigin}/profile/ai-quota`, { headers: authHeaders(user.token) });
  const expectedGenerationUsage = expectLunaEnabled ? 5 : 3;
  assert.deepEqual({ plan: quota.plan, generation: quota.generation.consumed, grading: quota.grading.consumed },
    { plan: "free", generation: expectedGenerationUsage, grading: 1 });
  const trackedJobs = [created.id, graphCreated.id, questionCreated.id];
  const lunaJobIds = expectLunaEnabled ? [created.id] : [];
  if (nativeGraphCreated && nativeQuestionCreated) {
    trackedJobs.push(nativeGraphCreated.id, nativeQuestionCreated.id);
    lunaJobIds.push(nativeGraphCreated.id, nativeQuestionCreated.id);
  }
  const usageEvents = await providerFacts(
    trackedJobs,
    attempt.id,
    lunaJobIds,
    examPipeline === "luna_native_file_v1",
  );
  const cleared = await request("terminal AI history cleanup", `${apiOrigin}/ai-jobs/clear-history`, {
    method: "POST", headers: authHeaders(user.token), body: "{}",
  });
  assert.ok(cleared.requested >= 3 && cleared.cleaning >= 3);
  await request("transactional source and result deletion", `${apiOrigin}/material-courses/${source.course.id}?aiResults=delete`, {
    method: "DELETE", headers: authHeaders(user.token),
  });
  const noteAfterDelete = await request("deleted note verification", `${apiOrigin}/notes/${note.id}`, {
    headers: authHeaders(user.token),
  }, [404]);
  assert.equal(noteAfterDelete.code, "NOTE_NOT_FOUND");
  const graphAfterDelete = await request("deleted knowledge note verification", `${apiOrigin}/notes/${graphNote.id}`, {
    headers: authHeaders(user.token),
  }, [404]);
  assert.equal(graphAfterDelete.code, "NOTE_NOT_FOUND");
  if (nativeGraphNote) {
    const nativeGraphAfterDelete = await request("deleted native knowledge note verification", `${apiOrigin}/notes/${nativeGraphNote.id}`, {
      headers: authHeaders(user.token),
    }, [404]);
    assert.equal(nativeGraphAfterDelete.code, "NOTE_NOT_FOUND");
  }
  storagePaths.length = 0;
  console.log(JSON.stringify({
    ok: true,
    generationJob: "succeeded",
    grading: "completed",
    quota: { generation: expectedGenerationUsage, grading: 1 },
    luna: { enabled: expectLunaEnabled, reasonCode: expectLunaEnabled ? null : "OPENROUTER_ZDR_UNAVAILABLE" },
    knowledgeGraph: { renderedNodes: graphNote.graph.nodes.length, nativeNodes: nativeGraphNote?.graph.nodes.length || 0, groundedQuestion: "succeeded" },
    usageEvents,
    sourceAndResultsDeleted: true,
    deps: { supabase: coreHealth.deps.supabase, ai: aiHealth.deps.worker },
  }));
} finally {
  await cleanup();
}
