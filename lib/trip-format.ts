export function formatTripDateTime(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function summarizeRequest(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const characters = Array.from(normalized);

  return characters.length <= 72
    ? normalized
    : `${characters.slice(0, 72).join("")}…`;
}
