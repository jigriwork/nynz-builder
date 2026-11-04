/** Only same-site relative paths are accepted as post-login destinations. */
export function safeNext(raw: string | null | undefined, fallback = "/dashboard") {
  const value = String(raw || "");
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.startsWith("/api/")) return fallback;
  return value.slice(0, 500);
}
