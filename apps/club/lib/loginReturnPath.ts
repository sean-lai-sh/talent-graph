export const LOGIN_PATH = "/login";
export const DEFAULT_AFTER_LOGIN = "/club";
export const SIGN_OUT_HREF = LOGIN_PATH;

export function clubLoginHref(next: string = DEFAULT_AFTER_LOGIN): string {
  return `${LOGIN_PATH}?next=${encodeURIComponent(safeReturnPath(next))}`;
}

export function safeReturnPath(raw: unknown): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.length === 0) {
    return DEFAULT_AFTER_LOGIN;
  }
  if (!value.startsWith("/")) {
    return DEFAULT_AFTER_LOGIN;
  }
  if (value.startsWith("//") || value.startsWith("/\\")) {
    return DEFAULT_AFTER_LOGIN;
  }
  if (value.includes("://") || value.includes("\\") || value.includes("\0")) {
    return DEFAULT_AFTER_LOGIN;
  }
  if (value !== "/club" && !value.startsWith("/club/")) {
    return DEFAULT_AFTER_LOGIN;
  }
  return value;
}
