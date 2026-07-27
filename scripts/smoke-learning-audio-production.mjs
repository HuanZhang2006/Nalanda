import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import {
  AUDIO_OUTPUT_FORMAT,
  learningAudioCacheKey,
  trimAssessmentFixture,
} from "./learning-audio-smoke-lib.mjs";

const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apiOrigin = String(process.env.SMOKE_API_ORIGIN || "http://127.0.0.1:8411/api").replace(/\/$/, "");
const azureKey = process.env.AZURE_SPEECH_KEY;
const azureRegion = process.env.AZURE_SPEECH_REGION;
const voice = process.env.AZURE_SPEECH_VOICE || "en-US-JennyNeural";
const locale = "en-US";
const synthesisVersion = process.env.LEARNING_AUDIO_SYNTHESIS_VERSION || "1";

assert.match(supabaseUrl, /^https:\/\/[a-z0-9-]+\.supabase\.co$/, "SUPABASE_URL is invalid");
assert.ok(serviceKey, "SUPABASE_SERVICE_ROLE_KEY is required");
assert.ok(azureKey, "AZURE_SPEECH_KEY is required");
assert.equal(azureRegion, "japaneast", "production Azure Speech region must be japaneast");
assert.notEqual(process.env.AZURE_SPEECH_FAKE, "true", "production smoke refuses the fake provider");
assert.equal(process.env.FEATURE_LEARNING_AUDIO_PREWARM_ENABLED, "true",
  "FEATURE_LEARNING_AUDIO_PREWARM_ENABLED must be true for the release gate");

const suffix = randomBytes(5).toString("hex").replace(/[0-9]/g, (digit) =>
  String.fromCharCode(97 + Number(digit)));
const terms = ["azure vocabulary release probe", ...["alpha", "bravo", "charlie"].map((part) =>
  `nalandaazure${part}${suffix}`)];
const cacheKeys = terms.map((term) => learningAudioCacheKey(
  term, locale, voice, AUDIO_OUTPUT_FORMAT, synthesisVersion,
));
const storagePaths = cacheKeys.map((key) => `${key}.mp3`);
const adminHeaders = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};
const users = [];
const startedAt = Date.now();

async function responseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function request(name, url, init = {}, expected = [200, 201]) {
  let response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    throw new Error(`${name} could not reach its target`, { cause: error });
  }
  const body = await responseBody(response);
  if (!expected.includes(response.status)) {
    const safe = typeof body === "object" && body
      ? JSON.stringify({ code: body.code, message: body.message })
      : String(body || "");
    throw new Error(`${name} returned HTTP ${response.status}: ${safe}`);
  }
  return { response, body };
}

async function requestRaw(name, url, init = {}, expected = [200, 201]) {
  let response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    throw new Error(`${name} could not reach its target`, { cause: error });
  }
  if (!expected.includes(response.status)) {
    const body = await responseBody(response);
    const safe = typeof body === "object" && body
      ? JSON.stringify({ code: body.code, message: body.message })
      : String(body || "");
    throw new Error(`${name} returned HTTP ${response.status}: ${safe}`);
  }
  return response;
}

async function cleanProbeAssets() {
  await request("probe Storage cleanup", `${supabaseUrl}/storage/v1/object/vocabulary-audio`, {
    method: "DELETE",
    headers: adminHeaders,
    body: JSON.stringify({ prefixes: storagePaths }),
  }, [200, 404]);
  await request(
    "probe metadata cleanup",
    `${supabaseUrl}/rest/v1/learning_audio_assets?cache_key=in.(${cacheKeys.join(",")})`,
    { method: "DELETE", headers: { ...adminHeaders, Prefer: "return=minimal" } },
    [200, 204],
  );
}

async function createUser(label) {
  const email = `nalanda-release-${label}-${Date.now()}-${randomBytes(3).toString("hex")}@example.invalid`;
  const password = `Nalanda-${randomBytes(18).toString("base64url")}!`;
  const created = await request("temporary user creation", `${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "Nalanda release smoke" },
    }),
  });
  users.push(created.body.id);
  const signedIn = await request("temporary user sign-in", `${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: serviceKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.ok(signedIn.body.access_token, "temporary sign-in returned no access token");
  return { id: created.body.id, token: signedIn.body.access_token };
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function createCourseAndSession(user, label) {
  const courseId = randomUUID();
  const unitId = randomUUID();
  const payload = {
    id: courseId,
    title: `Release audio smoke ${label}`,
    category: "english_vocabulary",
    hasUnits: false,
    locale,
    units: [{
      id: unitId,
      name: "Default unit",
      isSystem: true,
      words: terms.map((term, index) => ({
        id: randomUUID(),
        term,
        translations: [`probe-${index}`],
        ipa: null,
      })),
    }],
  };
  const saved = await request("temporary course creation", `${apiOrigin}/learning-courses`, {
    method: "POST",
    headers: authHeaders(user.token),
    body: JSON.stringify(payload),
  });
  const session = await request("temporary session start", `${apiOrigin}/learning-courses/${saved.body.id}/sessions`, {
    method: "POST",
    headers: authHeaders(user.token),
    body: JSON.stringify({
      unitId: saved.body.units[0].id,
      mode: "initial",
      scope: "all",
      skills: ["pronunciation", "translation", "spelling"],
    }),
  });
  return { course: saved.body, session: session.body, unitId: saved.body.units[0].id };
}

async function manifest(user, unitId, prepare = false) {
  return (await request(
    prepare ? "unit audio prewarm" : "unit audio manifest",
    `${apiOrigin}/learning-units/${unitId}/${prepare ? "audio-prewarm" : "audio-manifest"}`,
    {
      method: prepare ? "POST" : "GET",
      headers: authHeaders(user.token),
      ...(prepare ? { body: "{}" } : {}),
    },
  )).body;
}

async function waitUntilReady(user, unitId) {
  const deadline = Date.now() + 150_000;
  let current = await manifest(user, unitId, true);
  assert.equal(current.total, terms.length);
  assert.ok(current.pending > 0, "fresh probe unexpectedly had no queued audio");
  while (Date.now() < deadline) {
    if (current.failed) {
      throw new Error(`audio queue failed: ${JSON.stringify(current.assets.map((asset) => ({
        status: asset.status, error: asset.lastErrorCode,
      })))}`);
    }
    if (current.ready === current.total) return current;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    current = await manifest(user, unitId);
  }
  throw new Error(`audio queue did not become ready: ${JSON.stringify(current)}`);
}

async function assetAttempts() {
  const result = await request(
    "audio metadata inspection",
    `${supabaseUrl}/rest/v1/learning_audio_assets?cache_key=in.(${cacheKeys.join(",")})&select=cache_key,status,attempt_count,storage_path`,
    { headers: adminHeaders },
  );
  return new Map(result.body.map((row) => [row.cache_key, row]));
}

async function getAudio(user, asset) {
  const response = await requestRaw("private audio read", new URL(asset.audioUrl, apiOrigin).toString(), {
    headers: { Authorization: `Bearer ${user.token}` },
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.length > 44, "private audio response is unexpectedly small");
  assert.equal(response.headers.get("etag"), `"${asset.cacheKey}"`);
  return bytes;
}

async function synthesizeAssessmentWav() {
  const escapedVoice = voice.replace(/[<>&"']/g, (char) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
  })[char]);
  const body = `<speak version="1.0" xml:lang="en-US"><voice name="${escapedVoice}">${terms[0]}</voice></speak>`;
  const response = await requestRaw(
    "real Azure assessment fixture",
    `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": azureKey,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "riff-16khz-16bit-mono-pcm",
        "User-Agent": "Nalanda-Release-Smoke",
      },
      body,
    },
  );
  return trimAssessmentFixture(Buffer.from(await response.arrayBuffer()));
}

async function assess(user, session, firstWordId) {
  const wav = await synthesizeAssessmentWav();
  const form = new FormData();
  form.append("sessionId", session.id);
  form.append("wordId", firstWordId);
  form.append("audio", new Blob([wav], { type: "audio/wav" }), "trimmed-release-smoke.wav");
  const result = await request("real API pronunciation assessment", `${apiOrigin}/pronunciation/assess`, {
    method: "POST",
    headers: { Authorization: `Bearer ${user.token}` },
    body: form,
  });
  assert.ok(Number.isFinite(Number(result.body.pronunciationScore)));
  assert.equal(result.body.passThreshold, 70);
  assert.ok(Number.isSafeInteger(result.body.revision) && result.body.revision >= 1);
  assert.equal(result.body.sessionPatch.stage, "recognition");
  assert.ok(Array.isArray(result.body.phonemes) && result.body.phonemes.length > 0);
  return { bytes: wav.length, score: Number(result.body.pronunciationScore) };
}

try {
  await cleanProbeAssets();
  const firstUser = await createUser("a");
  const first = await createCourseAndSession(firstUser, "A");
  const firstManifest = await waitUntilReady(firstUser, first.unitId);
  const firstAttempts = await assetAttempts();
  assert.equal(firstAttempts.size, terms.length);
  for (const row of firstAttempts.values()) {
    assert.equal(row.status, "ready");
    assert.ok(row.attempt_count >= 1);
  }
  const firstBytes = await getAudio(firstUser, firstManifest.assets[0]);
  const assessment = await assess(firstUser, first.session, first.course.units[0].words[0].id);

  const secondUser = await createUser("b");
  const second = await createCourseAndSession(secondUser, "B");
  const secondManifest = await manifest(secondUser, second.unitId, true);
  assert.equal(secondManifest.ready, terms.length,
    "the second user did not immediately reuse the global Storage assets");
  assert.equal(secondManifest.pending, 0);
  await new Promise((resolve) => setTimeout(resolve, 4_000));
  const secondAttempts = await assetAttempts();
  for (const [key, row] of firstAttempts) {
    assert.equal(secondAttempts.get(key).attempt_count, row.attempt_count,
      "duplicate vocabulary triggered another Azure queue claim");
  }
  const secondBytes = await getAudio(secondUser, secondManifest.assets[0]);
  assert.deepEqual(secondBytes, firstBytes, "cross-user cache read returned different audio bytes");

  console.log(JSON.stringify({
    ok: true,
    provider: "azure-speech-through-nalanda",
    region: azureRegion,
    generatedAssets: firstManifest.ready,
    duplicateAssetsReused: secondManifest.ready,
    assessmentScore: assessment.score,
    trimmedAssessmentBytes: assessment.bytes,
    durationMs: Date.now() - startedAt,
  }));
} finally {
  for (const userId of users.reverse()) {
    await request("temporary user cleanup", `${supabaseUrl}/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
      headers: adminHeaders,
    }, [200, 204, 404]).catch(() => undefined);
  }
  await cleanProbeAssets().catch(() => undefined);
}
