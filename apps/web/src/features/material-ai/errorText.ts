import type { ApiClientError } from "../../lib/api";

type Localize = (english: string, chinese: string) => string;

const messages: Record<string, [string, string]> = {
  AI_PROCESSING_CONSENT_REQUIRED: ["Confirm AI processing consent to continue.", "请先确认 AI 处理同意。"],
  AI_GENERATION_DAILY_LIMIT: ["Today's 10 free AI generations have been used.", "今日 10 次免费 AI 生成额度已用完。"],
  AI_GRADING_DAILY_LIMIT: ["Today's 10 free subjective grading runs have been used.", "今日 10 次免费主观题评分额度已用完。"],
  AI_JOB_ACTIVE: ["Finish or cancel the active AI job first.", "请先完成或取消当前 AI 任务。"],
  AI_FILE_TYPE_UNSUPPORTED: ["Convert the file to a supported format before using AI.", "请先将文件转换为 AI 支持的格式。"],
  AI_FILE_SIZE_UNSUPPORTED: ["The file exceeds the AI processing size limit.", "文件超过 AI 处理大小限制。"],
  AI_FILE_CORRUPT: ["The file is damaged or invalid.", "文件已损坏或格式无效。"],
  AI_ARCHIVE_UNSAFE: ["The Office archive failed the safety limit.", "Office 压缩包未通过安全限制。"],
  AI_PDF_ENCRYPTED: ["Encrypted PDFs are not supported.", "暂不支持加密 PDF。"],
  AI_PAGE_LIMIT: ["The file exceeds 250 pages or slides.", "文件超过 250 页或幻灯片。"],
  AI_CHARACTER_LIMIT: ["The extracted document exceeds the text limit.", "解析出的文档超过文本长度限制。"],
  PROMPT_INJECTION_REJECTED: ["Unsafe embedded instructions were detected, so this job was refused.", "检测到不安全的嵌入指令，任务已拒绝执行。"],
  AI_PARTIAL_PARSE_UNRECOVERABLE: ["Some document regions could not be recovered.", "文档的部分区域无法可靠恢复。"],
  AI_VISUAL_UNREADABLE: ["Some visual content remains unreadable.", "部分视觉内容仍无法辨认。"],
  AI_TEMP_DISK_PRESSURE: ["AI processing is paused because temporary disk space is low.", "临时磁盘空间不足，AI 处理已暂停。"],
  AI_JOB_TEMP_LIMIT: ["The job exceeded its temporary disk limit.", "任务超过临时磁盘空间上限。"],
  OFFICE_RENDER_TIMEOUT: ["Office rendering timed out.", "Office 文件渲染超时。"],
  OFFICE_RENDER_FAILED: ["The Office file could not be rendered.", "Office 文件无法完成渲染。"],
  OPENROUTER_ZDR_UNAVAILABLE: ["No compliant Zero Data Retention endpoint is currently available.", "当前没有符合零数据保留要求的模型端点。"],
  OPENROUTER_RATE_LIMIT: ["The AI provider is temporarily rate limited.", "AI 供应商暂时触发限流。"],
  OPENROUTER_UNREACHABLE: ["The AI provider did not respond.", "AI 供应商暂未响应。"],
  AI_BAD_JSON: ["The AI response did not match the required structure.", "AI 响应不符合要求的结构。"],
  AI_EXAM_VALIDATION_FAILED: ["The generated paper did not pass quality validation.", "生成的试卷未通过质量验证。"],
  AI_MONTHLY_BUDGET_REACHED: ["The monthly AI safety budget is paused.", "本月 AI 安全预算已暂停。"],
  AI_COST_LIMIT_EXCEEDED: ["This request exceeded its AI cost safety limit.", "本次请求超过 AI 成本安全上限。"],
  AI_WORKER_RETRY_EXHAUSTED: ["AI processing could not recover after repeated worker restarts.", "AI 处理在多次工作进程重启后仍无法恢复。"],
  AI_WORKER_TIMEOUT: ["The AI worker timed out. Resume this job to continue from its latest saved checkpoint.", "AI 工作进程超时，可从最近检查点继续。"],
  AI_WORKER_UNREACHABLE: ["The AI worker is temporarily unreachable. Resume this job when service returns.", "AI 工作进程暂时不可达，可在服务恢复后继续。"],
  AI_CALLBACK_UNAVAILABLE: ["Progress could not be saved temporarily. The job will resume from its latest durable checkpoint.", "进度暂时无法保存，任务会从最近检查点继续。"],
  AI_JOB_NOT_RESUMABLE: ["This job no longer has resumable progress. Start a new AI job.", "该任务已无可恢复进度，请新建任务。"],
  AI_RESUME_EXPIRED: ["The saved progress expired. Start a new AI job.", "已保存进度已过期，请新建任务。"],
  AI_KNOWLEDGE_GRAPH_VALIDATION_FAILED: ["The knowledge map did not pass source and structure validation.", "知识图未通过来源和结构校验。"],
  AI_KNOWLEDGE_ANSWER_VALIDATION_FAILED: ["The grounded answer did not pass source validation.", "知识点回答未通过来源校验。"],
  EXAM_REVISION_CONFLICT: ["This exam changed elsewhere; the latest server version was restored.", "此答卷已在其他设备修改，现已恢复服务器版本。"],
  DATABASE_UNAVAILABLE: ["AI records are temporarily unavailable.", "AI 记录暂不可用。"],
  UPSTREAM_UNREACHABLE: ["The storage service is temporarily unavailable. Nothing was deleted.", "存储服务暂不可用，未删除任何内容。"],
};

export function materialAiErrorText(
  errorOrCode: unknown,
  fallback: string,
  l: Localize,
) {
  const value = errorOrCode as Partial<ApiClientError> | null;
  const code = typeof errorOrCode === "string" ? errorOrCode : value?.code;
  const translated = code ? messages[code] : undefined;
  if (translated) return l(translated[0], translated[1]);
  if (value instanceof Error && value.message) return value.message;
  return fallback;
}
