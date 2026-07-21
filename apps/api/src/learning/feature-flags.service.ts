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
    if (!enabled("FEATURE_PRONUNCIATION_ENABLED", false) || process.env.AZURE_SPEECH_CIRCUIT_OPEN === "true") {
      throw new ServiceUnavailableException({ code: "PRONUNCIATION_UNAVAILABLE", message: "发音服务暂不可用" });
    }
  }
}
