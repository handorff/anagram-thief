import type {
  ReplayAnalysisMap,
  ReplayAnalysisResult,
  ReplayFileV1
} from "@shared/types";

export const MAX_REPLAY_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

export function buildReplayExportFilename(exportedAt: number): string {
  const date = new Date(exportedAt);
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `anagram-thief-replay-${yyyy}${mm}${dd}-${hh}${min}${ss}.json`;
}

export function toReplayAnalysisMap(
  analysisByStepIndex: Record<number, ReplayAnalysisResult>
): ReplayAnalysisMap | undefined {
  const entries = Object.entries(analysisByStepIndex);
  if (entries.length === 0) return undefined;
  const mappedEntries = entries.map(([stepIndex, result]) => [String(stepIndex), result] as const);
  return Object.fromEntries(mappedEntries);
}

export function getImportedReplayAnalysis(
  replayFile: ReplayFileV1,
  stepIndex: number
): ReplayAnalysisResult | null {
  if (!Number.isInteger(stepIndex) || stepIndex < 0) return null;
  return replayFile.analysisByStepIndex?.[String(stepIndex)] ?? null;
}
