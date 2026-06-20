// Nalanda 共享类型 —— 与原型 app/data.js 及 AI 微服务输出 schema 对齐

export type Language = "zh" | "en";
export type GenerationKind = "knowledge-list" | "quiz" | "graph" | "exam";
export type MaterialType = "pdf" | "ppt" | "doc" | "md" | "html" | "txt";

// ── AI 生成产物（= DB.knowledge / quiz / graph / exam）──
export interface KnowledgePoint {
  title: string;
  definition: string;
  tags: string[];
  order: number;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
  type?: "single" | "multiple" | "cloze" | "short";
}

export interface GraphNode {
  id: string;
  label: string;
  level: number;
}
export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: [string, string][];
}

export interface ExamQuestion {
  prompt: string;
  marks: number;
}
export interface ExamSection {
  name: string;
  questions: ExamQuestion[];
}
export interface MockExam {
  title: string;
  meta: string;
  sections: ExamSection[];
}

// ── 生成请求 ──
export interface GenerateRequest {
  materialId: string;
  text?: string;
  lang: Language;
}
