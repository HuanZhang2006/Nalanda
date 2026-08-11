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

function storageObjectMissing(status: number, text: string) {
  if (status === 404) return true;
  if (status !== 400 || !text) return false;
  try {
    const body = JSON.parse(text) as { statusCode?: unknown; error?: unknown; message?: unknown };
    return String(body.statusCode || "") === "404"
      || String(body.error || "").toLowerCase() === "not_found"
      || /object not found/i.test(String(body.message || ""));
  } catch {
    return false;
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
    }).catch(() => {
      throw new ServiceUnavailableException({
        code: "UPSTREAM_UNREACHABLE",
        message: "Storage is unavailable",
      });
    });
    if (!response.ok) {
      const text = await response.text();
      // Supabase Storage currently reports a missing private object as HTTP
      // 400 with a JSON statusCode of 404. Treat both wire shapes as a normal
      // cache miss; otherwise the first TTS request never reaches Azure.
      if (storageObjectMissing(response.status, text)) return null;
      throw new SupabaseRequestError("Storage read failed", response.status, text || null);
    }
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

  async storageCreateSignedUrl(bucket: string, path: string, expiresIn = 900): Promise<string> {
    const { url, key } = this.config();
    const response = await fetch(`${url}/storage/v1/object/sign/${bucket}/${path}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn }),
    }).catch(() => null);
    if (!response?.ok) throw new SupabaseRequestError("Storage signing failed", response?.status || 503, null);
    const body = await response.json() as { signedURL?: string; signedUrl?: string };
    const signed = body.signedURL || body.signedUrl;
    if (!signed) throw new SupabaseRequestError("Storage did not return a signed URL", 502, body);
    return new URL(signed, `${url}/storage/v1/`).toString();
  }

  async storageDelete(bucket: string, paths: string[]): Promise<void> {
    if (!paths.length) return;
    const { url, key } = this.config();
    const response = await fetch(`${url}/storage/v1/object/${bucket}`, {
      method: "DELETE",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: paths }),
    }).catch(() => null);
    if (!response?.ok) throw new SupabaseRequestError("Storage delete failed", response?.status || 503, null);
  }
}
