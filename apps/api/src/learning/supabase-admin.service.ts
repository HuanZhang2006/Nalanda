import { Injectable, ServiceUnavailableException } from "@nestjs/common";

export class SupabaseRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

@Injectable()
export class SupabaseAdminService {
  private config() {
    const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new ServiceUnavailableException({
      code: "SERVER_MISCONFIG",
      message: "Learning service is not configured",
    });
    return { url, key };
  }

  async rest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const { url, key } = this.config();
    const response = await fetch(`${url}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    }).catch(() => {
      throw new ServiceUnavailableException({ code: "UPSTREAM_UNREACHABLE", message: "Database is unavailable" });
    });
    const text = await response.text();
    const body = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
    if (!response.ok) {
      const message = typeof body === "object" && body && "message" in body
        ? String((body as { message: unknown }).message)
        : `Supabase request failed (${response.status})`;
      throw new SupabaseRequestError(message, response.status, body);
    }
    return body as T;
  }

  rpc<T>(name: string, payload: Record<string, unknown>): Promise<T> {
    return this.rest<T>(`rpc/${name}`, { method: "POST", body: JSON.stringify(payload) });
  }

  select<T>(table: string, query: URLSearchParams): Promise<T[]> {
    return this.rest<T[]>(`${table}?${query.toString()}`);
  }

  insert<T>(table: string, payload: unknown): Promise<T[]> {
    return this.rest<T[]>(table, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(payload),
    });
  }

  update<T>(table: string, query: URLSearchParams, payload: unknown): Promise<T[]> {
    return this.rest<T[]>(`${table}?${query.toString()}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(payload),
    });
  }

  delete(table: string, query: URLSearchParams): Promise<unknown> {
    return this.rest(`${table}?${query.toString()}`, { method: "DELETE" });
  }

  async storageGet(bucket: string, path: string): Promise<Uint8Array | null> {
    const { url, key } = this.config();
    const response = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    }).catch(() => null);
    if (!response || response.status === 404) return null;
    if (!response.ok) throw new SupabaseRequestError("Storage read failed", response.status, null);
    return new Uint8Array(await response.arrayBuffer());
  }

  async storagePut(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const { url, key } = this.config();
    const response = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": contentType,
        "x-upsert": "true",
      },
      body: Buffer.from(bytes),
    }).catch(() => null);
    if (!response?.ok) throw new SupabaseRequestError("Storage upload failed", response?.status || 503, null);
  }
}
