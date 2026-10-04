export type ImportErrorCode =
  | "gmail-not-connected"
  | "gmail-auth"
  | "gmail-api"
  | "gmail-rate-limit"
  | "network"
  | "unknown";

/** Import failure carrying a code the UI maps to a localized message. */
export class ImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    message?: string,
    readonly status?: number,
  ) {
    super(message ?? code);
    this.name = "ImportError";
  }
}

export function importErrorCode(error: unknown): ImportErrorCode {
  if (error instanceof ImportError) return error.code;
  if (error instanceof TypeError) return "network";
  return "unknown";
}
