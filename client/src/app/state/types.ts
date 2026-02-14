import type {
  ChatMessage,
  GameState,
  PracticeDifficulty,
  PracticeModeState,
  ReplayAnalysisResult,
  RoomState,
  RoomSummary
} from "@shared/types";
import type {
  GameLogEntry,
  PendingPrivateRoomJoin,
  PendingResultAutoSubmit,
  PendingSharedLaunch,
  ReplaySource,
  WordHighlightKind
} from "../types";
import type { UserSettings } from "../../userSettings";

export type CopyStatus = "copied" | "failed" | null;

export type ConnectionState = {
  isConnected: boolean;
  selfPlayerId: string | null;
};

export type ServerState = {
  roomList: RoomSummary[];
  roomState: RoomState | null;
  gameState: GameState | null;
  practiceState: PracticeModeState;
};

export type IdentityState = {
  playerName: string;
  nameDraft: string;
  editNameDraft: string;
};

export type SettingsState = {
  isSettingsOpen: boolean;
  userSettings: UserSettings;
  userSettingsDraft: UserSettings;
};

export type LobbyCreateRoomFormState = {
  roomName: string;
  isPublic: boolean;
  maxPlayers: number;
  flipTimerEnabled: boolean;
  flipTimerSeconds: number;
  claimTimerSeconds: number;
  preStealEnabled: boolean;
};

export type PracticeStartPromptState = {
  isOpen: boolean;
  mode: "start" | "difficulty";
  difficulty: PracticeDifficulty | null;
  timerEnabled: boolean;
  timerSeconds: number;
};

export type EditorFormState = {
  difficulty: PracticeDifficulty;
  centerInput: string;
  existingWordsInput: string;
  validationMessageFromServer: string | null;
  shareStatus: CopyStatus;
  isShareValidationInFlight: boolean;
};

export type LobbyState = {
  view: "list" | "create" | "editor";
  error: string | null;
  createRoomForm: LobbyCreateRoomFormState;
  practiceStartPrompt: PracticeStartPromptState;
  editorForm: EditorFormState;
};

export type PracticeUiState = {
  practiceWord: string;
  submitError: string | null;
  shareStatus: CopyStatus;
  resultShareStatus: CopyStatus;
  showAllOptions: boolean;
  pendingSharedLaunch: PendingSharedLaunch | null;
  pendingResultAutoSubmit: PendingResultAutoSubmit | null;
};

export type GameUiState = {
  claimWord: string;
  queuedTileClaimLetters: string;
  preStealTriggerInput: string;
  preStealClaimWordInput: string;
  preStealDraggedEntryId: string | null;
  showLeaveGameConfirm: boolean;
  gameLogEntries: GameLogEntry[];
  chatMessages: ChatMessage[];
  chatDraft: string;
  claimedWordHighlights: Record<string, WordHighlightKind>;
};

export type ReplayUiState = {
  isReplayMode: boolean;
  replayStepIndex: number;
  replaySource: ReplaySource | null;
  importReplayError: string | null;
  replayPuzzleError: string | null;
  isReplayAnalysisOpen: boolean;
  analysisByStepIndex: Record<number, ReplayAnalysisResult>;
  importedAnalysisByStepIndex: Record<number, ReplayAnalysisResult>;
  analysisLoadingStepIndex: number | null;
  analysisError: string | null;
  showAllOptionsByStep: Record<number, boolean>;
};

export type ClockState = {
  now: number;
};

export type AppState = {
  connection: ConnectionState;
  server: ServerState;
  identity: IdentityState;
  settings: SettingsState;
  lobby: LobbyState;
  practiceUi: PracticeUiState;
  gameUi: GameUiState;
  replayUi: ReplayUiState;
  clock: ClockState;
  pendingPrivateRoomJoin: PendingPrivateRoomJoin | null;
  privateInviteCopyStatus: CopyStatus;
};

export type InitialAppStateOptions = {
  isConnected: boolean;
  playerName: string;
  userSettings: UserSettings;
  practiceState: PracticeModeState;
  pendingSharedLaunch: PendingSharedLaunch | null;
  pendingPrivateRoomJoin: PendingPrivateRoomJoin | null;
  defaultFlipTimerSeconds: number;
  defaultClaimTimerSeconds: number;
  defaultPracticeDifficulty: PracticeDifficulty;
  defaultPracticeTimerSeconds: number;
};
