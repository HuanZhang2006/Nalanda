import { Injectable, ServiceUnavailableException } from "@nestjs/common";

export class SupabaseRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "SupabaseRequestError";
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

function requestTimeoutSignal() {
  const configured = Number(process.env.SUPABASE_REQUEST_TIMEOUT_MS || 20_000);
  const milliseconds = Number.isFinite(configured)
    ? Math.max(1_000, Math.min(60_000, Math.round(configured)))
    : 20_000;
  return AbortSignal.timeout(milliseconds);
}

function upstreamUnavailable(error: unknown, dependency: "Database" | "Storage") {
  const name = error && typeof error === "object" && "name" in error
    ? String((error as { name: unknown }).name)
    : "";
  const timedOut = name === "TimeoutError" || name === "AbortError";
  return new ServiceUnavailableException({
    code: timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNREACHABLE",
    message: `${dependency} is temporarily unavailable`,
    retryAfterSeconds: 2,
  });
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
    let response: Response;
    let text: string;
    try {
      response = await fetch(`${url}/rest/v1/${path}`, {
        ...init,
        signal: init.signal || requestTimeoutSignal(),
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
      });
      // Keep response-body streaming inside the same timeout/error boundary.
      // A fetch promise resolves as soon as headers arrive, so reading the
      // body outside this try would let a late AbortSignal escape unmapped.
      text = await response.text();
    } catch (error) {
      throw upstreamUnavailable(error, "Database");
    }
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
    let response: Response;
    try {
      response = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
        signal: requestTimeoutSignal(),
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
    } catch (error) { throw upstreamUnavailable(error, "Storage"); }
    if (!response.ok) {
      let text: string;
      try { text = await response.text(); }
      catch (error) { throw upstreamUnavailable(error, "Storage"); }
      // Supabase Storage currently reports a missing private object as HTTP
      // 400 with a JSON statusCode of 404. Treat both wire shapes as a normal
      // cache miss; otherwise the first TTS request never reaches Azure.
      if (storageObjectMissing(response.status, text)) return null;
      throw new SupabaseRequestError("Storage read failed", response.status, text || null);
    }
    try { return new Uint8Array(await response.arrayBuffer()); }
    catch (error) { throw upstreamUnavailable(error, "Storage"); }
  }

  async storagePut(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const { url, key } = this.config();
    let response: Response;
    try {
      response = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
        method: "POST",
        signal: requestTimeoutSignal(),
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": contentType,
          "x-upsert": "true",
        },
        body: Buffer.from(bytes),
      });
    } catch (error) { throw upstreamUnavailable(error, "Storage"); }
    if (!response.ok) throw new SupabaseRequestError("Storage upload failed", response.status, null);
  }

  async storageCreateSignedUrl(bucket: string, path: string, expiresIn = 900): Promise<string> {
    const { url, key } = this.config();
    let response: Response;
    let text: string;
    try {
      response = await fetch(`${url}/storage/v1/object/sign/${bucket}/${path}`, {
        method: "POST",
        signal: requestTimeoutSignal(),
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expiresIn }),
      });
      text = await response.text();
    } catch (error) { throw upstreamUnavailable(error, "Storage"); }
    if (!response.ok) throw new SupabaseRequestError("Storage signing failed", response.status, null);
    let body: { signedURL?: string; signedUrl?: string };
    try { body = JSON.parse(text) as typeof body; }
    catch { throw new SupabaseRequestError("Storage returned an invalid signing response", 502, null); }
    const signed = body.signedURL || body.signedUrl;
    if (!signed) throw new SupabaseRequestError("Storage did not return a signed URL", 502, body);
    // The raw Storage REST endpoint returns `/object/sign/...`, relative to
    // the Storage API base (not the project origin). `new URL()` would treat
    // that leading slash as origin-relative and silently drop `/storage/v1`,
    // so the Materials AI worker would download a 404 page instead of the
    // private source object. A full URL is also accepted for compatibility
    // with hosted/local Storage versions that already expand the response.
    if (/^https?:\/\//i.test(signed)) return signed;
    return `${url}/storage/v1${signed.startsWith("/") ? signed : `/${signed}`}`;
  }

  async storageDelete(bucket: string, paths: string[]): Promise<void> {
    if (!paths.length) return;
    const { url, key } = this.config();
    let response: Response;
    try {
      response = await fetch(`${url}/storage/v1/object/${bucket}`, {
        method: "DELETE",
        signal: requestTimeoutSignal(),
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: paths }),
      });
    } catch (error) { throw upstreamUnavailable(error, "Storage"); }
    if (!response.ok) throw new SupabaseRequestError("Storage delete failed", response.status, null);
  }
}
