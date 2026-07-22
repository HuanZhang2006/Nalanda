import { ServiceUnavailableException } from "@nestjs/common";

export function positiveEnvironmentNumber(name: string, fallback: number, integer = false) {
  const raw = process.env[name];
  const value = raw == null || raw === "" ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isSafeInteger(value))) {
    throw new ServiceUnavailableException({
      code: "SERVER_MISCONFIG",
      message: `Invalid positive ${integer ? "integer " : ""}configuration: ${name}`,
    });
  }
  return value;
}
