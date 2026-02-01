export function safeStr(v) {
  if (v == null) return "";
  return String(v);
}
