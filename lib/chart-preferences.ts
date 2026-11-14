export type CloseAverage = { period: number; color: string; visible: boolean };
export const averageStorageKey = "stock-insight.close-averages.v1";
export const maxAverageLines = 5;
export const maxAveragePeriod = 600;
export const averageColors = [
  { value: "#b78012", label: "황금색" },
  { value: "#7a58bc", label: "보라색" },
  { value: "#087d69", label: "초록색" },
  { value: "#3677c4", label: "파란색" },
  { value: "#cd4949", label: "빨간색" },
  { value: "#53655d", label: "회색" },
] as const;

export function defaultAverages(): CloseAverage[] {
  return [20, 60, 120].map((period, index) => ({ period, color: averageColors[index].value, visible: true }));
}

export function averageSettingsError(lines: CloseAverage[]) {
  if (lines.length < 1 || lines.length > maxAverageLines) return "이동평균선은 1~5개로 설정해 주세요.";
  if (lines.some(line => !Number.isInteger(line.period) || line.period < 1 || line.period > maxAveragePeriod)) return "기간은 1~600 사이의 정수로 입력해 주세요.";
  if (new Set(lines.map(line => line.period)).size !== lines.length) return "같은 기간의 이동평균선이 있습니다. 서로 다른 기간을 입력해 주세요.";
  if (lines.some(line => !averageColors.some(color => color.value === line.color) || typeof line.visible !== "boolean")) return "이동평균선의 색상과 표시 설정을 확인해 주세요.";
  return null;
}

export function readAverageSettings(raw: string | null): CloseAverage[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(line => line && typeof line === "object" &&
        typeof line.period === "number" && typeof line.color === "string" && typeof line.visible === "boolean")) return null;
    const lines = parsed as CloseAverage[];
    return averageSettingsError(lines) ? null : lines.map(({ period, color, visible }) => ({ period, color, visible }));
  } catch { return null; }
}
