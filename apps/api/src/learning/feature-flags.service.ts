import { Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";

function enabled(name: string, developmentDefault = true) {
  const value = process.env[name];
  if (value == null || value === "") return developmentDefault && process.env.NODE_ENV !== "production";
  return value.toLowerCase() === "true";
}

@Injectable()
export class FeatureFlagsService {
  courses() {
    if (!enabled("FEATURE_LEARNING_COURSES_ENABLED")) {
      throw new ServiceUnavailableException({ code: "COURSES_DISABLED", message: "课程功能暂未开放" });
    }
  }

  shares() {
    this.courses();
    if (!enabled("FEATURE_COURSE_SHARING_ENABLED")) {
      throw new NotFoundException({ code: "SHARING_DISABLED", message: "课程分享暂未开放" });
    }
  }

  market() {
    this.courses();
    if (!enabled("FEATURE_COURSE_MARKET_ENABLED")) {
      throw new NotFoundException({ code: "MARKET_DISABLED", message: "课程市场暂未开放" });
    }
  }

  pronunciation() {
    this.courses();
    if (process.env.NODE_ENV === "production" && process.env.AZURE_SPEECH_FAKE === "true") {
      throw new ServiceUnavailableException({
        code: "PRONUNCIATION_UNAVAILABLE",
        message: "生产环境禁止使用模拟发音供应商",
      });
    }
    if (!enabled("FEATURE_PRONUNCIATION_ENABLED", false) || process.env.AZURE_SPEECH_CIRCUIT_OPEN === "true") {
      throw new ServiceUnavailableException({ code: "PRONUNCIATION_UNAVAILABLE", message: "发音服务暂不可用" });
    }
  }

  audioPrewarm() {
    this.pronunciation();
    if (!enabled("FEATURE_LEARNING_AUDIO_PREWARM_ENABLED")) {
      throw new ServiceUnavailableException({ code: "AUDIO_PREWARM_DISABLED", message: "离线音频准备暂未开放" });
    }
  }

  audioPrewarmEnabled() {
    try { this.audioPrewarm(); return true; }
    catch { return false; }
  }

  spellingTranslation() {
    this.courses();
    if (process.env.NODE_ENV === "production" && process.env.OPENROUTER_FAKE === "true") {
      throw new ServiceUnavailableException({
        code: "TRANSLATION_ASSESSMENT_UNAVAILABLE",
        message: "生产环境禁止使用模拟翻译判分供应商",
      });
    }
    if (!enabled("FEATURE_SPELLING_TRANSLATION_ASSESSMENT_ENABLED")) {
      throw new ServiceUnavailableException({
        code: "TRANSLATION_ASSESSMENT_UNAVAILABLE",
        message: "翻译语义判分暂不可用",
      });
    }
  }

  materialAi() {
    if (process.env.NODE_ENV === "production" && process.env.MATERIAL_AI_FAKE_PROVIDER === "true") {
      throw new ServiceUnavailableException({
        code: "MATERIAL_AI_UNAVAILABLE",
        message: "Production cannot use the fake Materials AI provider",
      });
    }
    if (!enabled("FEATURE_MATERIAL_AI", false)) {
      throw new ServiceUnavailableException({ code: "MATERIAL_AI_DISABLED", message: "Materials AI is not enabled" });
    }
    if (!process.env.REDIS_URL || !process.env.AI_SERVICE_URL || !process.env.AI_INTERNAL_TOKEN) {
      throw new ServiceUnavailableException({ code: "MATERIAL_AI_UNAVAILABLE", message: "Materials AI dependencies are not configured" });
    }
  }

  materialAiEnabled() {
    try { this.materialAi(); return true; } catch { return false; }
  }

  materialAiLunaEnabled() {
    return this.materialAiEnabled() && enabled("FEATURE_MATERIAL_AI_LUNA", false);
  }
}
