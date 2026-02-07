import type {
  GameReplay,
  ReplayAnalysisBasis,
  ReplayAnalysisMap,
  ReplayAnalysisResult,
  ReplayFileKind,
  ReplayFileParseResult,
  ReplayFileV1,
  ReplayFileVersion,
  ReplayPlayerSnapshot,
  ReplayStateSnapshot,
  ReplayStep,
  ReplayStepKind
} from "./types.js";

export const REPLAY_FILE_KIND: ReplayFileKind = "anagram-thief-replay";
export const REPLAY_FILE_VERSION: ReplayFileVersion = 1;
export const MAX_REPLAY_FILE_STEPS = 5000;

const PLAYABLE_STEP_KINDS = new Set<ReplayStepKind>(["flip-revealed", "claim-succeeded"]);
const INVALID_REPLAY_FILE_MESSAGE = "Replay file is invalid or corrupted.";

type BuildReplayFileInput = {
  replay: GameReplay;
  analysisByStepIndex?: ReplayAnalysisMap;
  sourceRoomId?: string;
  exportedAt?: number;
  app?: string;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isReplayStepKind(value: unknown): value is ReplayStepKind {
  switch (value) {
    case "game-start":
    case "flip-started":
    case "flip-revealed":
    case "claim-window-opened":
    case "claim-window-expired":
    case "claim-succeeded":
    case "cooldown-started":
    case "cooldown-ended":
    case "pre-steal-entry-added":
    case "pre-steal-entry-removed":
    case "pre-steal-entry-reordered":
    case "end-countdown-started":
    case "game-ended":
      return true;
    default:
      return false;
  }
}

function isReplayAnalysisBasis(value: unknown): value is ReplayAnalysisBasis {
  return value === "step" || value === "before-claim";
}

function validateWordLike(value: unknown): boolean {
  if (!isObjectRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.text !== "string") return false;
  if (!isStringArray(value.tileIds)) return false;
  if (typeof value.ownerId !== "string") return false;
  if (!isFiniteNumber(value.createdAt)) return false;
  return true;
}

function validatePreStealEntryLike(value: unknown): boolean {
  if (!isObjectRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.triggerLetters !== "string") return false;
  if (typeof value.claimWord !== "string") return false;
  if (!isFiniteNumber(value.createdAt)) return false;
  return true;
}

function validateReplayPlayerSnapshot(value: unknown): value is ReplayPlayerSnapshot {
  if (!isObjectRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.name !== "string") return false;
  if (!isFiniteNumber(value.score)) return false;
  if (!Array.isArray(value.words) || !value.words.every((word) => validateWordLike(word))) return false;
  if (
    !Array.isArray(value.preStealEntries) ||
    !value.preStealEntries.every((entry) => validatePreStealEntryLike(entry))
  ) {
    return false;
  }
  return true;
}

function validateReplayStateSnapshot(value: unknown): value is ReplayStateSnapshot {
  if (!isObjectRecord(value)) return false;
  if (typeof value.roomId !== "string") return false;
  if (value.status !== "in-game" && value.status !== "ended") return false;
  if (typeof value.bagCount !== "number" || !Number.isInteger(value.bagCount) || value.bagCount < 0) {
    return false;
  }
  if (!Array.isArray(value.centerTiles)) return false;
  for (const tile of value.centerTiles) {
    if (!isObjectRecord(tile)) return false;
    if (typeof tile.id !== "string" || typeof tile.letter !== "string") return false;
  }
  if (!Array.isArray(value.players) || !value.players.every((player) => validateReplayPlayerSnapshot(player))) {
    return false;
  }
  if (typeof value.turnPlayerId !== "string") return false;

  if (value.claimWindow !== null) {
    if (!isObjectRecord(value.claimWindow)) return false;
    if (typeof value.claimWindow.playerId !== "string") return false;
    if (!isFiniteNumber(value.claimWindow.endsAt)) return false;
  }

  if (!isObjectRecord(value.claimCooldowns)) return false;
  for (const endsAt of Object.values(value.claimCooldowns)) {
    if (!isFiniteNumber(endsAt)) return false;
  }

  if (value.pendingFlip !== null) {
    if (!isObjectRecord(value.pendingFlip)) return false;
    if (typeof value.pendingFlip.playerId !== "string") return false;
    if (!isFiniteNumber(value.pendingFlip.startedAt)) return false;
    if (!isFiniteNumber(value.pendingFlip.revealsAt)) return false;
  }

  if (typeof value.preStealEnabled !== "boolean") return false;
  if (!isStringArray(value.preStealPrecedenceOrder)) return false;

  if (value.lastClaimEvent !== null) {
    if (!isObjectRecord(value.lastClaimEvent)) return false;
    if (typeof value.lastClaimEvent.eventId !== "string") return false;
    if (typeof value.lastClaimEvent.wordId !== "string") return false;
    if (typeof value.lastClaimEvent.claimantId !== "string") return false;
    if (
      value.lastClaimEvent.replacedWordId !== null &&
      typeof value.lastClaimEvent.replacedWordId !== "string"
    ) {
      return false;
    }
    if (value.lastClaimEvent.source !== "manual" && value.lastClaimEvent.source !== "pre-steal") {
      return false;
    }
    if (typeof value.lastClaimEvent.movedToBottomOfPreStealPrecedence !== "boolean") return false;
  }

  if (value.endTimerEndsAt !== undefined && !isFiniteNumber(value.endTimerEndsAt)) return false;
  return true;
}

function validateReplayStep(step: unknown, expectedIndex: number): step is ReplayStep {
  if (!isObjectRecord(step)) return false;
  if (!Number.isInteger(step.index) || step.index !== expectedIndex) return false;
  if (!isFiniteNumber(step.at)) return false;
  if (!isReplayStepKind(step.kind)) return false;
  if (!validateReplayStateSnapshot(step.state)) return false;
  return true;
}

function validatePracticeScoredWord(value: unknown): boolean {
  if (!isObjectRecord(value)) return false;
  if (typeof value.word !== "string") return false;
  if (!isFiniteNumber(value.score)) return false;
  if (!isFiniteNumber(value.baseScore)) return false;
  if (!isFiniteNumber(value.stolenLetters)) return false;
  if (value.source !== "center" && value.source !== "steal") return false;
  if (value.stolenFrom !== undefined && typeof value.stolenFrom !== "string") return false;
  return true;
}

function validateReplayAnalysisResult(
  value: unknown,
  mapStepIndex: number,
  maxStepIndex: number
): value is ReplayAnalysisResult {
  if (!isObjectRecord(value)) return false;
  if (!Number.isInteger(value.requestedStepIndex) || value.requestedStepIndex !== mapStepIndex) return false;
  if (value.requestedStepIndex < 0 || value.requestedStepIndex > maxStepIndex) return false;
  if (!isReplayStepKind(value.stepKind)) return false;
  if (!isReplayAnalysisBasis(value.basis)) return false;
  if (typeof value.basisStepIndex !== "number" || !Number.isInteger(value.basisStepIndex)) return false;
  if (value.basisStepIndex < 0 || value.basisStepIndex > maxStepIndex) return false;
  if (!isFiniteNumber(value.bestScore)) return false;
  if (!Array.isArray(value.allOptions) || !value.allOptions.every((option) => validatePracticeScoredWord(option))) {
    return false;
  }
  return true;
}

function validateReplayAnalysisMap(value: unknown, maxStepIndex: number): value is ReplayAnalysisMap {
  if (!isObjectRecord(value)) return false;
  for (const [key, entry] of Object.entries(value)) {
    if (!/^\d+$/.test(key)) return false;
    const stepIndex = Number(key);
    if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex > maxStepIndex) return false;
    if (!validateReplayAnalysisResult(entry, stepIndex, maxStepIndex)) return false;
  }
  return true;
}

function validateReplayObject(value: unknown): value is GameReplay {
  if (!isObjectRecord(value)) return false;
  if (!Array.isArray(value.steps)) return false;
  if (value.steps.length > MAX_REPLAY_FILE_STEPS) return false;
  for (let index = 0; index < value.steps.length; index += 1) {
    if (!validateReplayStep(value.steps[index], index)) return false;
  }
  return true;
}

export function buildReplayFileV1(input: BuildReplayFileInput): ReplayFileV1 {
  const file: ReplayFileV1 = {
    kind: REPLAY_FILE_KIND,
    v: REPLAY_FILE_VERSION,
    exportedAt: input.exportedAt ?? Date.now(),
    replay: input.replay,
    meta: {
      source: "ended-room",
      sourceStatus: "ended",
      ...(input.sourceRoomId ? { sourceRoomId: input.sourceRoomId } : {}),
      ...(input.app ? { app: input.app } : {})
    }
  };
  if (input.analysisByStepIndex && Object.keys(input.analysisByStepIndex).length > 0) {
    file.analysisByStepIndex = input.analysisByStepIndex;
  }
  return file;
}

export function serializeReplayFile(file: ReplayFileV1): string {
  const validation = validateReplayFile(file);
  if (!validation.ok) {
    throw new Error(validation.message);
  }
  return JSON.stringify(validation.file, null, 2);
}

export function validateReplayFile(value: unknown): ReplayFileParseResult {
  if (!isObjectRecord(value)) {
    return { ok: false, message: INVALID_REPLAY_FILE_MESSAGE };
  }

  const kind = value.kind;
  const version = value.v;

  if (kind !== REPLAY_FILE_KIND) {
    return { ok: false, message: INVALID_REPLAY_FILE_MESSAGE };
  }

  if (version !== REPLAY_FILE_VERSION) {
    return { ok: false, message: "Unsupported replay file version." };
  }

  if (!isFiniteNumber(value.exportedAt)) {
    return { ok: false, message: INVALID_REPLAY_FILE_MESSAGE };
  }

  if (!validateReplayObject(value.replay)) {
    return { ok: false, message: INVALID_REPLAY_FILE_MESSAGE };
  }

  const steps = value.replay.steps;
  const hasPlayableStep = steps.some((step) => PLAYABLE_STEP_KINDS.has(step.kind));
  if (!hasPlayableStep) {
    return { ok: false, message: "Replay contains no playable steps." };
  }

  if (!isObjectRecord(value.meta)) {
    return { ok: false, message: INVALID_REPLAY_FILE_MESSAGE };
  }
  if (value.meta.source !== "ended-room") {
    return { ok: false, message: INVALID_REPLAY_FILE_MESSAGE };
  }
  if (value.meta.sourceStatus !== "ended") {
    return { ok: false, message: INVALID_REPLAY_FILE_MESSAGE };
  }
  if (value.meta.sourceRoomId !== undefined && typeof value.meta.sourceRoomId !== "string") {
    return { ok: false, message: INVALID_REPLAY_FILE_MESSAGE };
  }
  if (value.meta.app !== undefined && typeof value.meta.app !== "string") {
    return { ok: false, message: INVALID_REPLAY_FILE_MESSAGE };
  }

  if (value.analysisByStepIndex !== undefined) {
    const maxStepIndex = Math.max(0, steps.length - 1);
    if (!validateReplayAnalysisMap(value.analysisByStepIndex, maxStepIndex)) {
      return { ok: false, message: INVALID_REPLAY_FILE_MESSAGE };
    }
  }

  return {
    ok: true,
    file: value as unknown as ReplayFileV1
  };
}

export function parseReplayFile(jsonText: string): ReplayFileParseResult {
  if (typeof jsonText !== "string" || !jsonText.trim()) {
    return { ok: false, message: INVALID_REPLAY_FILE_MESSAGE };
  }
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    return validateReplayFile(parsed);
  } catch {
    return { ok: false, message: INVALID_REPLAY_FILE_MESSAGE };
  }
}
