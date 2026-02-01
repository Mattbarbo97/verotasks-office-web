export function fmtDateTime(d) {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(d);
  } catch {
    return String(d);
  }
}
