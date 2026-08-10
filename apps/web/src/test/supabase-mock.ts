import { vi } from "vitest";

export type Row = Record<string, any>;
export type Seed = Record<string, Row[]>;

type Filter = (row: Row) => boolean;

export type RecordedOperation = {
  table: string;
  action: "select" | "insert" | "update" | "delete";
  payload?: unknown;
};
type Action = RecordedOperation["action"];

export type SupabaseMockOptions = {
  errors?: Record<string, Partial<Record<Action, string>>>;
  storageErrors?: Partial<Record<"upload" | "remove" | "createSignedUrl", string>>;
  rpcResults?: Record<string, { data?: unknown; error?: string }>;
};

class Query implements PromiseLike<any> {
  private action: RecordedOperation["action"] = "select";
  private payload: any;
  private filters: Filter[] = [];
  private wantsSingle = false;
  private countOnly = false;
  private maxRows: number | null = null;

  constructor(
    private readonly table: string,
    private readonly tables: Seed,
    private readonly operations: RecordedOperation[],
    private readonly userId: string,
    private readonly errors: SupabaseMockOptions["errors"],
  ) {}

  select(_columns = "*", options?: { count?: string; head?: boolean }) {
    if (this.action === "select") this.payload = _columns;
    this.countOnly = Boolean(options?.head);
    return this;
  }

  insert(payload: Row | Row[]) {
    this.action = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: Row) {
    this.action = "update";
    this.payload = payload;
    return this;
  }

  delete() {
    this.action = "delete";
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  not(column: string, operator: string, value: unknown) {
    if (operator === "is") this.filters.push((row) => row[column] !== value);
    return this;
  }

  contains(column: string, values: unknown[]) {
    this.filters.push((row) => values.every((value) => (row[column] || []).includes(value)));
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  gte(column: string, value: unknown) {
    this.filters.push((row) => row[column] >= (value as any));
    return this;
  }

  order(_column: string, _options?: unknown) {
    return this;
  }

  limit(value: number) {
    this.maxRows = value;
    return this;
  }

  single() {
    this.wantsSingle = true;
    return this;
  }

  private matchingRows() {
    const rows = this.tables[this.table] || (this.tables[this.table] = []);
    let matches = rows.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.maxRows != null) matches = matches.slice(0, this.maxRows);
    return { rows, matches };
  }

  private execute() {
    const { rows, matches } = this.matchingRows();
    this.operations.push({ table: this.table, action: this.action, payload: this.payload });
    const configuredError = this.errors?.[this.table]?.[this.action];
    if (configuredError) return { data: null, count: null, error: new Error(configuredError) };

    if (this.action === "select") {
      if (this.countOnly) return { data: null, count: matches.length, error: null };
      return { data: this.wantsSingle ? (matches[0] || null) : matches.map((row) => ({ ...row })), error: null };
    }

    if (this.action === "insert") {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload];
      const created = incoming.map((row, index) => ({
        id: row.id || `${this.table}-${rows.length + index + 1}`,
        user_id: row.user_id || this.userId,
        created_at: row.created_at || new Date().toISOString(),
        ...row,
      }));
      rows.push(...created);
      return { data: this.wantsSingle ? created[0] : created, error: null };
    }

    if (this.action === "update") {
      for (const row of matches) Object.assign(row, this.payload);
      return { data: matches.map((row) => ({ ...row })), error: null };
    }

    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (this.filters.every((filter) => filter(rows[index]))) rows.splice(index, 1);
    }
    return { data: matches, error: null };
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}

function localDate(daysFromToday = 0) {
  const value = new Date();
  value.setDate(value.getDate() + daysFromToday);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export function defaultSeed(): Seed {
  const now = new Date().toISOString();
  return {
    profiles: [{
      id: "u1", username: "Alice", email: "alice@example.edu", university: "Nalanda University",
      major: "Cognitive Science", year: "Sophomore", language: "zh", points: 160, credits: 25,
      level: 3, level_name: "Scholar", streak: 2, vip_until: null,
    }],
    courses: [{ id: "c1", user_id: "u1", code: "COGS 210", name: "Foundations of Cognition", color: "#4f7d52", created_at: now }],
    materials: [{ id: "m1", user_id: "u1", course_id: "c1", name: "Week 1.pdf", type: "pdf", size_bytes: 2048, storage_path: "u1/week1.pdf", created_at: now }],
    notifications: [{ id: "n1", user_id: "u1", title: "欢迎回来", body: "今天也继续学习吧", type: "system", read: false, created_at: now }],
    feedback: [{ id: "f1", user_id: "u1", category: "Bug", summary: "已有反馈", body: "详情", status: "open", created_at: now }],
    tags: [
      { kind: "university", value: "Nalanda University", created_at: now },
      { kind: "major", value: "Cognitive Science", created_at: now },
      { kind: "subject", value: "COGS 210", created_at: now },
      { kind: "tag", value: "复习", created_at: now },
    ],
    follows: [{ follower_id: "u1", following_id: "u2", created_at: now }],
    posts: [
      { id: "p1", user_id: "u1", author_name: "Alice", author_university: "Nalanda University", title: "我的学习方法", body: "间隔重复很有效。", kind: "experience", tags: ["复习"], repost_of: null, like_count: 1, comment_count: 1, favorite_count: 0, repost_count: 0, created_at: now },
      { id: "p2", user_id: "u2", author_name: "Bob", author_university: "Westlake", title: "工作记忆是什么？", body: "请大家帮忙解释。", kind: "question", tags: ["COGS 210"], repost_of: null, like_count: 2, comment_count: 0, favorite_count: 1, repost_count: 0, created_at: now },
    ],
    comments: [{ id: "cm1", post_id: "p1", user_id: "u2", author_name: "Bob", body: "很有帮助", created_at: now }],
    post_likes: [{ post_id: "p2", user_id: "u1", created_at: now }],
    post_favorites: [{ post_id: "p2", user_id: "u1", created_at: now }],
    study_tasks: [
      { id: "t1", user_id: "u1", title: "复习工作记忆", due_date: localDate(), done: false, done_at: null, course_id: "c1", material_id: "m1", goal_id: null, created_at: now },
      { id: "t2", user_id: "u1", title: "完成练习题", due_date: localDate(1), done: false, done_at: null, course_id: "c1", material_id: null, goal_id: null, created_at: now },
    ],
    study_goals: [{ id: "g1", user_id: "u1", title: "COGS 210 期末", exam_date: localDate(3), course_id: "c1", created_at: now }],
  };
}

export function createSupabaseMock(seed: Seed = defaultSeed(), userId = "u1", options: SupabaseMockOptions = {}) {
  const tables = Object.fromEntries(Object.entries(seed).map(([table, rows]) => [table, rows.map((row) => ({ ...row }))]));
  const operations: RecordedOperation[] = [];
  const upload = vi.fn(async (_path: string, _file: File) => ({
    data: options.storageErrors?.upload ? null : { path: _path },
    error: options.storageErrors?.upload ? new Error(options.storageErrors.upload) : null,
  }));
  const remove = vi.fn(async () => ({ error: options.storageErrors?.remove ? new Error(options.storageErrors.remove) : null }));
  const createSignedUrl = vi.fn(async (path: string) => ({
    data: options.storageErrors?.createSignedUrl ? null : { signedUrl: `https://signed.example/${path}` },
    error: options.storageErrors?.createSignedUrl ? new Error(options.storageErrors.createSignedUrl) : null,
  }));
  const getPublicUrl = vi.fn((path: string) => ({ data: { publicUrl: `https://cdn.example/${path}` } }));
  const rpc = vi.fn(async (name: string) => {
    const configured = options.rpcResults?.[name];
    return {
      data: configured?.data ?? {
        awardedAmount: 1, dailyUsed: 1, dailyLimit: 20,
        localDate: "2026-08-10", suppressedReason: null,
      },
      error: configured?.error ? new Error(configured.error) : null,
    };
  });

  return {
    tables,
    operations,
    from: vi.fn((table: string) => new Query(table, tables, operations, userId, options.errors)),
    rpc,
    storage: { from: vi.fn(() => ({ upload, getPublicUrl, remove, createSignedUrl })) },
    upload,
    remove,
    createSignedUrl,
    getPublicUrl,
  };
}

export async function flush(times = 8) {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

export function click(element: Element | null) {
  if (!element) throw new Error("Expected a clickable element");
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}
