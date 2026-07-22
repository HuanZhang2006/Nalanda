import {
  BadGatewayException, BadRequestException, Injectable, ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PronunciationAssessment, PronunciationPhoneme } from "@nalanda/types";
import { positiveEnvironmentNumber } from "./environment";
import { FeatureFlagsService } from "./feature-flags.service";
import { LearningService } from "./learning.service";
import { assertUuid, normalizeTerm } from "./learning.util";
import { SupabaseAdminService } from "./supabase-admin.service";

const xml = (value: string) => value.replace(/[<>&"']/g, (char) => ({
  "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
})[char]!);

function num(value: unknown): number | null {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function providerTimeoutSignal() {
  const configured = Number(process.env.AZURE_SPEECH_TIMEOUT_MS || 10_000);
  const milliseconds = Number.isFinite(configured) ? Math.max(1_000, Math.min(60_000, Math.round(configured))) : 10_000;
  return AbortSignal.timeout(milliseconds);
}

function fakeToneWav() {
  const samples = 3_200; const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(36 + samples * 2, 4); bytes.write("WAVE", 8); bytes.write("fmt ", 12);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16_000, 24);
  bytes.writeUInt32LE(32_000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) bytes.writeInt16LE(Math.round(Math.sin(index / 9) * 2_000), 44 + index * 2);
  return new Uint8Array(bytes);
}

export function validateAssessmentWav(bytes: Buffer) {
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new BadRequestException({ code: "INVALID_AUDIO", message: "录音必须是 WAV 文件" });
  }
  let offset = 12;
  let format: { codec: number; channels: number; sampleRate: number; bits: number } | null = null;
  let dataSize = 0;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > bytes.length) break;
    if (id === "fmt " && size >= 16) {
      format = { codec: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4), bits: bytes.readUInt16LE(start + 14) };
    }
    if (id === "data") dataSize += size;
    offset = start + size + (size % 2);
  }
  if (!format || format.codec !== 1 || format.channels !== 1 || format.sampleRate !== 16_000 || format.bits !== 16 || !dataSize) {
    throw new BadRequestException({ code: "INVALID_AUDIO_FORMAT", message: "录音必须是 16 kHz、16-bit、单声道 PCM WAV" });
  }
  if (dataSize / 32_000 > 8.05) {
    throw new BadRequestException({ code: "AUDIO_TOO_LONG", message: "录音不能超过 8 秒" });
  }
}

@Injectable()
export class PronunciationService {
  constructor(
    private readonly db: SupabaseAdminService,
    private readonly learning: LearningService,
    private readonly flags: FeatureFlagsService,
  ) {}

  private config() {
    const key = process.env.AZURE_SPEECH_KEY;
    const region = process.env.AZURE_SPEECH_REGION;
    if (!key || !region) throw new ServiceUnavailableException({ code: "PRONUNCIATION_UNAVAILABLE", message: "发音服务暂不可用" });
    return { key, region, voice: process.env.AZURE_SPEECH_VOICE || "en-US-JennyNeural" };
  }

  async audio(userId: string, wordId: string) {
    this.flags.pronunciation();
    const word = await this.ownedWord(userId, wordId);
    const normalized = normalizeTerm(word.term);
    const path = `${createHash("sha256").update(normalized).digest("hex")}.mp3`;
    const cached = await this.db.storageGet("vocabulary-audio", path);
    if (cached) return cached;

    if (process.env.AZURE_SPEECH_FAKE === "true") {
      await this.learning.reserveSpeechQuota(userId, "tts", 1);
      return fakeToneWav();
    }

    const { key, region, voice } = this.config();
    const perThousand = positiveEnvironmentNumber("AZURE_SPEECH_TTS_MICRO_USD_PER_1000_CHARS", 16_000);
    await this.learning.reserveSpeechQuota(userId, "tts", Math.max(1, normalized.length * perThousand / 1000));
    const body = `<speak version="1.0" xml:lang="en-US"><voice name="${xml(voice)}">${xml(word.term)}</voice></speak>`;
    const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      signal: providerTimeoutSignal(),
      headers: { "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3", "User-Agent": "Nalanda" },
      body,
    }).catch(() => null);
    if (!response) throw new BadGatewayException({ code: "SPEECH_PROVIDER_TIMEOUT", message: "发音服务连接超时" });
    if (!response.ok) throw new BadGatewayException({ code: "SPEECH_PROVIDER_ERROR", message: "发音服务暂不可用" });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) throw new BadGatewayException({ code: "SPEECH_PROVIDER_ERROR", message: "发音服务返回空音频" });
    await this.db.storagePut("vocabulary-audio", path, bytes, "audio/mpeg");
    return bytes;
  }

  async assess(userId: string, sessionId: string, wordId: string, file?: Express.Multer.File): Promise<PronunciationAssessment> {
    this.flags.pronunciation();
    if (!file?.buffer) throw new BadRequestException({ code: "AUDIO_REQUIRED", message: "请上传录音" });
    if (file.size > 2 * 1024 * 1024) throw new BadRequestException({ code: "AUDIO_TOO_LARGE", message: "录音不能超过 2 MB" });
    validateAssessmentWav(file.buffer);
    const word = await this.learning.ownedWordInSession(userId, sessionId, wordId);
    if (process.env.AZURE_SPEECH_FAKE === "true") {
      await this.learning.reserveSpeechQuota(userId, "assessment", 1);
      const result: PronunciationAssessment = { accuracyScore: 92, fluencyScore: 90, completenessScore: 100,
        pronunciationScore: 93, errorType: null, phonemes: [{ phoneme: word.term.slice(0, 1).toLowerCase(), accuracyScore: 92, needsPractice: false }] };
      await this.learning.recordSpeechAssessment(userId, sessionId, wordId, result);
      return result;
    }
    const { key, region } = this.config();
    await this.learning.reserveSpeechQuota(userId, "assessment",
      positiveEnvironmentNumber("AZURE_SPEECH_ASSESSMENT_MICRO_USD", 2_500));

    const pronunciation = Buffer.from(JSON.stringify({ ReferenceText: word.term,
      GradingSystem: "HundredMark", Granularity: "Phoneme", Dimension: "Comprehensive",
      EnableMiscue: true, PhonemeAlphabet: "IPA" })).toString("base64");
    const endpoint = new URL(`https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`);
    endpoint.searchParams.set("language", "en-US"); endpoint.searchParams.set("format", "detailed");
    const response = await fetch(endpoint, { method: "POST", signal: providerTimeoutSignal(), headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
      "Pronunciation-Assessment": pronunciation,
      Accept: "application/json",
    }, body: file.buffer as unknown as BodyInit }).catch(() => null);
    if (!response) throw new BadGatewayException({ code: "SPEECH_PROVIDER_TIMEOUT", message: "朗读评分服务连接超时" });
    const payload = await response.json().catch(() => null) as any;
    if (!response.ok || !payload) throw new BadGatewayException({ code: "SPEECH_PROVIDER_ERROR", message: "朗读评分服务暂不可用" });
    const best = payload.NBest?.[0];
    // Microsoft documents scores below `PronunciationAssessment`, while the
    // live REST response in some regions also returns the same fields directly
    // on NBest/Word/Phoneme. Accept both provider shapes explicitly.
    const assessment = best?.PronunciationAssessment || best;
    const accuracy = num(assessment?.AccuracyScore);
    const pronunciationScore = num(assessment?.PronScore);
    if (accuracy == null || pronunciationScore == null) {
      throw new BadGatewayException({ code: "SPEECH_PROVIDER_INVALID", message: "朗读评分结果无效" });
    }
    const phonemes: PronunciationPhoneme[] = (best.Words || []).flatMap((entry: any) => {
      const direct = Array.isArray(entry.Phonemes) ? entry.Phonemes : [];
      const nested = (entry.Syllables || []).flatMap((syllable: any) => syllable.Phonemes || []);
      return (direct.length ? direct : nested).map((phoneme: any) => {
        const phonemeAssessment = phoneme.PronunciationAssessment || phoneme;
        const score = num(phonemeAssessment.AccuracyScore) ?? 0;
        return { phoneme: String(phoneme.Phoneme || ""), accuracyScore: score, needsPractice: score < 70 };
      });
    }).filter((entry: PronunciationPhoneme) => entry.phoneme);
    const result: PronunciationAssessment = {
      accuracyScore: accuracy,
      fluencyScore: num(assessment.FluencyScore),
      completenessScore: num(assessment.CompletenessScore),
      pronunciationScore,
      errorType: (best.Words || []).map((entry: any) => (entry.PronunciationAssessment || entry).ErrorType)
        .find((value: unknown) => value && value !== "None") || null,
      phonemes,
    };
    await this.learning.recordSpeechAssessment(userId, sessionId, wordId, result);
    return result;
  }

  private async ownedWord(userId: string, wordId: string) {
    assertUuid(wordId, "wordId");
    const rows = await this.db.select<Record<string, any>>("learning_course_words", new URLSearchParams({
      select: "id,term", id: `eq.${wordId}`, user_id: `eq.${userId}`, limit: "1",
    }));
    if (!rows[0]) throw new BadRequestException({ code: "WORD_NOT_FOUND", message: "单词不存在" });
    return rows[0];
  }
}
