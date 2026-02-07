export type RoomStatus = "lobby" | "in-game" | "ended";

export interface FlipTimerSettings {
  enabled: boolean;
  seconds: number;
}

export interface ClaimTimerSettings {
  seconds: number;
}

export interface PreStealSettings {
  enabled: boolean;
}

export interface PreStealEntry {
  id: string;
  triggerLetters: string;
  claimWord: string;
  createdAt: number;
}

export interface Tile {
  id: string;
  letter: string;
}

export interface Word {
  id: string;
  text: string;
  tileIds: string[];
  ownerId: string;
  createdAt: number;
}

export interface Player {
  id: string;
  name: string;
  connected: boolean;
  words: Word[];
  preStealEntries: PreStealEntry[];
  score: number;
}

export interface RoomSpectator {
  id: string;
  name: string;
  connected: boolean;
}

export interface RoomSummary {
  id: string;
  name: string;
  isPublic: boolean;
  playerCount: number;
  maxPlayers: number;
  status: RoomStatus;
}

export interface RoomState {
  id: string;
  name: string;
  isPublic: boolean;
  code?: string;
  hostId: string;
  players: Player[];
  spectators: RoomSpectator[];
  status: RoomStatus;
  createdAt: number;
  flipTimer: FlipTimerSettings;
  claimTimer: ClaimTimerSettings;
  preSteal: PreStealSettings;
}

export interface ClaimWindowState {
  playerId: string;
  endsAt: number;
}

export interface PendingFlipState {
  playerId: string;
  startedAt: number;
  revealsAt: number;
}

export interface ClaimEventMeta {
  eventId: string;
  wordId: string;
  claimantId: string;
  replacedWordId: string | null;
  source: "manual" | "pre-steal";
  movedToBottomOfPreStealPrecedence: boolean;
}

export type ReplayStepKind =
  | "game-start"
  | "flip-started"
  | "flip-revealed"
  | "claim-window-opened"
  | "claim-window-expired"
  | "claim-succeeded"
  | "cooldown-started"
  | "cooldown-ended"
  | "pre-steal-entry-added"
  | "pre-steal-entry-removed"
  | "pre-steal-entry-reordered"
  | "end-countdown-started"
  | "game-ended";

export interface ReplayPlayerSnapshot {
  id: string;
  name: string;
  score: number;
  words: Word[];
  preStealEntries: PreStealEntry[];
}

export interface ReplayStateSnapshot {
  roomId: string;
  status: "in-game" | "ended";
  bagCount: number;
  centerTiles: Tile[];
  players: ReplayPlayerSnapshot[];
  turnPlayerId: string;
  claimWindow: ClaimWindowState | null;
  claimCooldowns: Record<string, number>;
  pendingFlip: PendingFlipState | null;
  preStealEnabled: boolean;
  preStealPrecedenceOrder: string[];
  lastClaimEvent: ClaimEventMeta | null;
  endTimerEndsAt?: number;
}

export interface ReplayStep {
  index: number;
  at: number;
  kind: ReplayStepKind;
  state: ReplayStateSnapshot;
}

export interface GameReplay {
  steps: ReplayStep[];
}

export type ReplayAnalysisBasis = "step" | "before-claim";

export interface ReplayAnalysisResult {
  requestedStepIndex: number;
  stepKind: ReplayStepKind;
  basis: ReplayAnalysisBasis;
  basisStepIndex: number;
  bestScore: number;
  allOptions: PracticeScoredWord[];
}

export type ReplayAnalysisResponse =
  | {
      ok: true;
      result: ReplayAnalysisResult;
    }
  | {
      ok: false;
      message: string;
    };

export type ReplayFileKind = "anagram-thief-replay";

export type ReplayFileVersion = 1;

export type ReplayAnalysisMap = Record<string, ReplayAnalysisResult>;

export interface ReplayFileV1 {
  kind: ReplayFileKind;
  v: ReplayFileVersion;
  exportedAt: number;
  replay: GameReplay;
  analysisByStepIndex?: ReplayAnalysisMap;
  meta: {
    source: "ended-room";
    sourceRoomId?: string;
    sourceStatus: "ended";
    app?: string;
  };
}

export type ReplayFileParseResult =
  | {
      ok: true;
      file: ReplayFileV1;
    }
  | {
      ok: false;
      message: string;
    };

export interface GameState {
  roomId: string;
  status: "in-game" | "ended";
  bagCount: number;
  centerTiles: Tile[];
  players: Player[];
  turnPlayerId: string;
  lastClaimAt: number | null;
  endTimerEndsAt?: number;
  claimWindow: ClaimWindowState | null;
  claimCooldowns: Record<string, number>;
  pendingFlip: PendingFlipState | null;
  preStealEnabled: boolean;
  preStealPrecedenceOrder: string[];
  lastClaimEvent: ClaimEventMeta | null;
  replay?: GameReplay | null;
}

export type PracticeDifficulty = 1 | 2 | 3 | 4 | 5;

export interface PracticeExistingWord {
  id: string;
  text: string;
}

export interface PracticePuzzle {
  id: string;
  centerTiles: Tile[];
  existingWords: PracticeExistingWord[];
}

export interface PracticeSharePayload {
  v: 2;
  d: PracticeDifficulty;
  c: string;
  w: string[];
}

export interface PracticeResultSharePayload {
  v: 1;
  p: PracticeSharePayload;
  a: string;
  n?: string;
}

export interface PracticeStartRequest {
  difficulty?: PracticeDifficulty;
  sharedPuzzle?: PracticeSharePayload;
  timerEnabled?: boolean;
  timerSeconds?: number;
}

export interface PracticeValidateCustomRequest {
  sharedPuzzle: PracticeSharePayload;
}

export interface PracticeValidateCustomResponse {
  ok: boolean;
  message?: string;
}

export interface PracticeScoredWord {
  word: string;
  score: number;
  baseScore: number;
  stolenLetters: number;
  source: "center" | "steal";
  stolenFrom?: string;
}

export interface PracticeResult {
  submittedWordRaw: string;
  submittedWordNormalized: string;
  isValid: boolean;
  isBestPlay: boolean;
  timedOut: boolean;
  score: number;
  invalidReason?: string;
  bestScore: number;
  allOptions: PracticeScoredWord[];
}

export interface PracticeModeState {
  active: boolean;
  phase: "puzzle" | "result";
  currentDifficulty: PracticeDifficulty;
  queuedDifficulty: PracticeDifficulty;
  timerEnabled: boolean;
  timerSeconds: number;
  puzzleTimerEndsAt: number | null;
  puzzle: PracticePuzzle | null;
  result: PracticeResult | null;
}
