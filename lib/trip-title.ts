export function deriveTripTitle(originalRequest: string) {
  const firstLine =
    originalRequest
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "未命名旅行";
  const characters = Array.from(firstLine);

  return characters.length <= 30
    ? firstLine
    : `${characters.slice(0, 30).join("")}…`;
}
