import { supabase } from "./supabase";
import { getLocale, localize, localeTag } from "../i18n";

const API_ERROR_TEXT: Record<string, readonly [string, string]> = {
  REQUEST_FAILED: ["Request failed. Please try again.", "请求失败，请重试"],
  DATABASE_ERROR: ["The course database is temporarily unavailable.", "课程数据库暂不可用"],
  UPSTREAM_UNREACHABLE: ["The service is temporarily unavailable.", "服务暂不可用"],
  RATE_LIMITED: ["Too many requests. Please wait and try again.", "请求过于频繁，请稍后重试"],
  RATE_LIMIT_UNAVAILABLE: ["Request protection is temporarily unavailable. Please retry shortly.", "请求保护服务暂不可用，请稍后重试"],
  COURSES_DISABLED: ["Courses are not available yet.", "课程功能暂未开放"],
  SHARING_DISABLED: ["Course sharing is not available yet.", "课程分享暂未开放"],
  MARKET_DISABLED: ["Course Market is not available yet.", "课程市场暂未开放"],
  PRONUNCIATION_UNAVAILABLE: ["Pronunciation services are temporarily unavailable.", "发音服务暂不可用"],
  PUBLISH_LIMIT: ["You have reached today's publishing limit.", "今日上架次数已达上限"],
  REPORT_LIMIT: ["You have reached today's reporting limit.", "今日举报次数已达上限"],
  SPEECH_QUOTA_EXCEEDED: ["The speech quota has been used. Please try again later.", "发音服务配额已用完，请稍后再试"],
  CONFLICT: ["This action conflicts with a newer change. Refresh and try again.", "操作与较新的变更冲突，请刷新后重试"],
  FORBIDDEN: ["You do not have permission to perform this action.", "你没有权限执行此操作"],
  INVALID_REQUEST: ["The request is invalid.", "请求无效"],
  INVALID_ID: ["The requested identifier is invalid.", "请求标识无效"],
  INVALID_COURSE: ["The course content is invalid. Review the highlighted fields.", "课程内容校验失败，请检查标红字段"],
  INVALID_TITLE: ["The course name must be 1–80 characters.", "课程名称需为 1–80 个字符"],
  INVALID_MODE: ["The learning mode is invalid.", "学习模式无效"],
  INVALID_EXAM: ["The exam settings are invalid.", "考试设置无效"],
  INVALID_EXAM_PASS_PERCENT: ["Set the required exam accuracy between 1% and 100%.", "考试正确率要求需为 1%–100%。"],
  INVALID_SCOPE: ["The review scope is invalid.", "复习范围无效"],
  INVALID_SKILLS: ["Choose 1–3 distinct review skills.", "请选择 1–3 个不重复的复习项目"],
  INVALID_SKILL: ["The test type is invalid.", "测试类型无效"],
  INVALID_OFFSETS: ["Review dates can only be 3, 7, 15, or 30 days away.", "复习日期只能选择 3、7、15、30 天"],
  SESSION_NOT_FOUND: ["The learning session was not found.", "学习会话不存在"],
  SESSION_INACTIVE: ["The learning session has ended.", "学习会话已经结束"],
  WORD_NOT_IN_SESSION: ["This word is not part of the current session.", "该词不属于当前学习会话"],
  WORD_NOT_FOUND: ["The word was not found.", "单词不存在"],
  COURSE_NOT_FOUND: ["The course was not found.", "课程不存在"],
  REPUBLISH_FORBIDDEN: ["Cloned courses cannot be shared or published again.", "克隆课程不能再次分享或上架"],
  SHARE_NOT_FOUND: ["The share link does not exist or has been revoked.", "分享链接不存在或已撤销"],
  RIGHTS_REQUIRED: ["Confirm your content rights before publishing.", "上架前必须确认拥有内容权利"],
  DESCRIPTION_TOO_LONG: ["The course description cannot exceed 500 characters.", "课程简介不能超过 500 字"],
  PUBLICATION_NOT_FOUND: ["The market course was not found.", "市场课程不存在"],
  INVALID_REPORT_TARGET: ["Choose one item to report.", "请选择一个举报对象"],
  INVALID_REPORT_CATEGORY: ["The report category is invalid.", "举报类别无效"],
  REPORT_DETAILS_TOO_LONG: ["Report details cannot exceed 1,000 characters.", "举报说明不能超过 1000 个字符"],
  INVALID_AUDIO: ["The recording must be a WAV file.", "录音必须是 WAV 文件"],
  INVALID_AUDIO_FORMAT: ["Use a 16 kHz, 16-bit, mono PCM WAV recording.", "录音必须是 16 kHz、16-bit、单声道 PCM WAV"],
  AUDIO_REQUIRED: ["Add a recording first.", "请上传录音"],
  AUDIO_TOO_LARGE: ["The recording cannot exceed 2 MB.", "录音不能超过 2 MB"],
  AUDIO_TOO_LONG: ["The recording cannot exceed 8 seconds.", "录音不能超过 8 秒"],
  SPEECH_PROVIDER_TIMEOUT: ["The speech service timed out. Please try again.", "发音服务连接超时，请重试"],
  SPEECH_PROVIDER_ERROR: ["The speech service is temporarily unavailable.", "发音服务暂不可用"],
  SPEECH_PROVIDER_INVALID: ["The pronunciation result was invalid. Please try again.", "朗读评分结果无效，请重试"],
  AUDIO_PENDING: ["Audio is being prepared. Browser speech is available now.", "音频正在准备中，当前可使用浏览器朗读"],
  AUDIO_PREWARM_DISABLED: ["Offline audio preparation is not available yet.", "离线音频准备暂未开放"],
  AUDIO_ASSET_MISSING: ["The audio task could not be found.", "音频任务不存在"],
  SESSION_REVISION_CONFLICT: ["Progress changed on another device. Restoring the latest version.", "学习进度已在其它设备更新，正在恢复最新版本"],
  INVALID_REVISION: ["The learning-session version is invalid.", "学习会话版本无效"],
  INVALID_SPELLING_OPTIONS: ["Use a spelling time limit between 3 and 300 seconds.", "拼写限时需设置为 3–300 秒"],
  INVALID_TRANSLATION_ANSWER: ["Enter a translation between 1 and 500 characters.", "请输入 1–500 个字符的翻译"],
  TRANSLATION_ASSESSMENT_UNAVAILABLE: ["Semantic translation checking is temporarily unavailable.", "翻译语义判分暂不可用"],
  TRANSLATION_ASSESSMENT_PENDING: ["The translation is still being checked. Please retry in a moment.", "翻译仍在判分，请稍后重试"],
  TRANSLATION_ASSESSMENT_RATE_LIMIT: ["Translation checks are temporarily rate-limited. Please try again later.", "翻译判分请求过于频繁，请稍后重试"],
  TRANSLATION_ASSESSMENT_MINUTE_LIMIT: ["Too many translation checks in one minute. Please retry shortly.", "一分钟内翻译判分次数过多，请稍后重试"],
  TRANSLATION_ASSESSMENT_DAILY_LIMIT: ["The 24-hour translation-check allowance has been used. Please retry after it refreshes.", "24 小时翻译判分额度已用完，请在额度恢复后重试"],
  TRANSLATION_PROVIDER_RATE_LIMIT: ["The translation checker is busy. Please try again shortly.", "翻译判分服务繁忙，请稍后重试"],
  TRANSLATION_PROVIDER_TIMEOUT: ["The translation checker timed out. Your answer was not counted as wrong.", "翻译判分超时，本次不会记为错误"],
  TRANSLATION_PROVIDER_ERROR: ["The translation checker is temporarily unavailable. Your answer was not counted as wrong.", "翻译判分服务暂不可用，本次不会记为错误"],
  TRANSLATION_PROVIDER_INVALID: ["The translation checker returned an invalid result. Please try again.", "翻译判分结果无效，请重试"],
  TRANSLATION_STT_MINUTE_LIMIT: ["Too many voice transcriptions in one minute. Please retry shortly.", "一分钟内语音识别次数过多，请稍后重试"],
  TRANSLATION_STT_DAILY_LIMIT: ["Today's voice-input allowance has been used. Please retry after it refreshes.", "今日语音识别额度已用完，请在额度恢复后重试"],
  TRANSLATION_STT_MONTHLY_LIMIT: ["This month's voice-input budget has been used.", "本月语音识别额度已用完"],
  TRANSLATION_STT_PROVIDER_RATE_LIMIT: ["The voice-input service is busy. Please try again shortly.", "语音识别服务繁忙，请稍后重试"],
  TRANSLATION_STT_PROVIDER_TIMEOUT: ["Voice recognition timed out. Nothing was submitted.", "语音识别超时，未提交任何答案"],
  TRANSLATION_STT_PROVIDER_ERROR: ["Voice recognition is temporarily unavailable. Nothing was submitted.", "语音识别服务暂不可用，未提交任何答案"],
  TRANSLATION_STT_PROVIDER_INVALID: ["Voice recognition returned an invalid result. Please try again.", "语音识别结果无效，请重试"],
  TRANSLATION_STT_PROVIDER_CREDIT_REQUIRED: ["Voice input is temporarily unavailable. You can continue by typing.", "语音输入暂不可用，可继续使用键盘输入"],
  MATERIAL_AI_DISABLED: ["Materials AI is not enabled yet.", "Materials AI 尚未开放"],
  MATERIAL_AI_UNAVAILABLE: ["Materials AI is temporarily unavailable.", "Materials AI 暂不可用"],
  AI_FILE_TYPE_UNSUPPORTED: ["This file type is not supported for AI processing.", "AI 处理不支持此文件类型"],
  AI_FILE_SIZE_UNSUPPORTED: ["This file exceeds the AI processing size limit.", "文件超过 AI 处理大小限制"],
  AI_PROCESSING_CONSENT_REQUIRED: ["Confirm AI processing consent to continue.", "请确认 AI 处理同意后继续"],
  AI_GENERATION_DAILY_LIMIT: ["Today's 10 free test paper generations have been used.", "今日 10 次免费试卷生成额度已用完"],
  AI_GRADING_DAILY_LIMIT: ["Today's 10 free subjective grading runs have been used.", "今日 10 次免费主观题评分额度已用完"],
  AI_JOB_ACTIVE: ["Finish or cancel your active AI job first.", "请先完成或取消当前 AI 任务"],
  IDEMPOTENCY_CONFLICT: ["This request key was already used for different settings.", "此请求标识已用于其他设置"],
  PROMPT_INJECTION_REJECTED: ["The file contains unsafe embedded instructions and was not processed.", "文件含有不安全的嵌入指令，已拒绝处理"],
  AI_TEMP_DISK_PRESSURE: ["AI processing is paused because server disk space is low.", "服务器磁盘空间不足，AI 处理已暂停"],
  AI_MONTHLY_BUDGET_REACHED: ["AI processing is paused at the monthly budget limit.", "AI 处理已达到月度预算上限"],
  AI_EXAM_VALIDATION_FAILED: ["The generated paper did not pass validation; your allowance was returned.", "生成试卷未通过验证，额度已返还"],
  EXAM_REVISION_CONFLICT: ["This exam changed on another device. The latest version will be restored.", "答卷已在其他设备修改，将恢复最新版本"],
  EXAM_ATTEMPT_EXPIRED: ["The exam time has ended and the paper is being submitted.", "考试时间已结束，正在自动交卷"],
  EXAM_ATTEMPT_CLOSED: ["This exam attempt is already closed.", "本次答卷已结束"],
};

function localizedApiError(code: string, source?: unknown) {
  const pair = API_ERROR_TEXT[code];
  if (pair) return localize(pair[0], pair[1], getLocale());
  const fallback = typeof source === "string" ? source : "";
  if (getLocale() === "zh" && fallback) return fallback;
  if (fallback && !/[\p{Script=Han}]/u.test(fallback)) return fallback;
  return localize("Request failed. Please try again.", "请求失败，请重试", getLocale());
}

export async function apiErrorMessage(response: Response) {
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  return localizedApiError(String(body?.code || "REQUEST_FAILED"), body?.message);
}

function localizedHeaders(init: RequestInit, token?: string) {
  const headers = new Headers(init.headers);
  headers.set("Accept-Language", localeTag());
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

// Call the backend with the Supabase access token
export async function authedFetch(path: string, init: RequestInit = {}) {
  const sessionResult = await supabase?.auth.getSession();
  if (sessionResult?.error) throw sessionResult.error;
  const token = sessionResult?.data.session?.access_token;
  return fetch(path, {
    ...init,
    headers: localizedHeaders(init, token),
  });
}

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors?: Record<string, string>,
    readonly currentRevision?: number,
    readonly retryAfterSeconds?: number,
  ) { super(message); }
}

export async function apiJson<T>(path: string, init: RequestInit = {}, authenticated = true, localizeErrors = true): Promise<T> {
  const response = authenticated ? await authedFetch(path, init) : await fetch(path, { ...init, headers: localizedHeaders(init) });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const code = String(body?.code || "REQUEST_FAILED");
    throw new ApiClientError(response.status, code,
      localizeErrors ? localizedApiError(code, body?.message) : String(body?.message || localize("Request failed. Please try again.", "请求失败，请重试", getLocale())),
      body?.fieldErrors as Record<string, string> | undefined,
      typeof body?.currentRevision === "number" ? body.currentRevision : undefined,
      typeof body?.retryAfterSeconds === "number" ? body.retryAfterSeconds : undefined);
  }
  return body as T;
}
