/**
 * Where to send someone after signing in: only a path inside this app. Browsers ignore tabs and
 * newlines in URLs and read "\" as "/", so "/\evil.com" or "/<tab>/evil.com" would otherwise
 * leave the site.
 */
export function safeNext(next: unknown): string {
  const s = typeof next === "string" ? next : "";
  if (!s.startsWith("/") || s.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(s)) return "/";
  // Belt and braces: whatever the browser makes of it must stay on our origin.
  const base = "http://app.invalid";
  return new URL(s, base).origin === base ? s : "/";
}
