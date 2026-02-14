import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ChangeEvent,
  type SetStateAction
} from "react";
import type {
  ChatMessage,
  GameState,
  Player,
  PracticeDifficulty,
  PracticeModeState,
  PracticeScoredWord,
  PracticeValidateCustomResponse,
  ReplayAnalysisResponse,
  ReplayAnalysisResult,
  ReplayPlayerSnapshot,
  ReplayStateSnapshot,
  RoomState,
  RoomSummary
} from "@shared/types";
import {
  buildPracticeSharePayload,
  encodePracticeSharePayload
} from "@shared/practiceShare";
import {
  buildPracticeResultSharePayload,
  encodePracticeResultSharePayload
} from "@shared/practiceResultShare";
import {
  buildReplayFileV1,
  parseReplayFile,
  serializeReplayFile
} from "@shared/replayFile";
import {
  MAX_REPLAY_IMPORT_FILE_BYTES,
  buildReplayExportFilename,
  getImportedReplayAnalysis
} from "../../replayImportExport";
import {
  buildUserSettingsContextValue,
  persistUserSettings,
  readStoredUserSettings,
  UserSettingsContext,
  type UserSettings
} from "../../userSettings";
import {
  CLAIM_FAILURE_MESSAGES,
  CLAIM_FAILURE_WINDOW_MS,
  CLAIM_WORD_ANIMATION_MS,
  CUSTOM_PUZZLE_CENTER_LETTER_MAX,
  CUSTOM_PUZZLE_CENTER_LETTER_MIN,
  CUSTOM_PUZZLE_EXISTING_WORD_COUNT_MAX,
  CUSTOM_PUZZLE_EXISTING_WORD_LENGTH_MAX,
  CUSTOM_PUZZLE_EXISTING_WORD_LENGTH_MIN,
  CUSTOM_PUZZLE_TOTAL_CHARACTERS_MAX,
  CUSTOM_PUZZLE_VALIDATION_TIMEOUT_MS,
  DEFAULT_CLAIM_TIMER_SECONDS,
  DEFAULT_FLIP_REVEAL_MS,
  DEFAULT_FLIP_TIMER_SECONDS,
  DEFAULT_PRACTICE_DIFFICULTY,
  DEFAULT_PRACTICE_TIMER_SECONDS,
  LETTER_PATTERN,
  MAX_CLAIM_TIMER_SECONDS,
  MAX_CHAT_ENTRIES,
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_FLIP_TIMER_SECONDS,
  MAX_LOG_ENTRIES,
  MAX_PRACTICE_TIMER_SECONDS,
  MIN_CLAIM_TIMER_SECONDS,
  MIN_FLIP_TIMER_SECONDS,
  MIN_PRACTICE_TIMER_SECONDS,
  PENDING_RESULT_AUTO_SUBMIT_TTL_MS,
  PRACTICE_RESULT_SHARE_QUERY_PARAM,
  PRACTICE_SHARE_QUERY_PARAM,
  PRACTICE_TIMER_WARNING_SECONDS,
  REPLAY_ANALYSIS_DEFAULT_VISIBLE_OPTIONS,
  REPLAY_ANALYSIS_TIMEOUT_MS,
  REPLAY_FILE_INPUT_ACCEPT
} from "../constants";
import {
  socket,
  generateId,
  setSocketSessionToken
} from "../network/socketClient";
import {
  persistPlayerName,
  readStoredPlayerName,
  sanitizeClientName
} from "../storage/playerIdentity";
import {
  buildPracticePuzzleFingerprintFromState,
  buildPrivateRoomInviteUrl,
  readPendingPrivateRoomJoinFromUrl,
  readPendingSharedLaunchFromUrl,
  removePracticeShareFromUrl,
  removePrivateRoomJoinFromUrl
} from "../share/shareUrl";
import {
  buildPracticeSharePayloadFromReplayState,
  clampClaimTimerSeconds,
  clampFlipTimerSeconds,
  clampPracticeDifficulty,
  clampPracticeTimerSeconds,
  createInactivePracticeState,
  getPracticeResultCategory,
  normalizeEditorText
} from "../practice/practiceUtils";
import {
  buildReplayActionText,
  getReplayClaimWordDiff
} from "../replay/replayUtils";
import {
  appendPreStealLogContext,
  findReplacedWord,
  formatLogTime,
  formatTime,
  getPlayerName,
  getWordSnapshots,
  reorderEntriesById
} from "../game/gameUtils";
import type {
  ClaimFailureContext,
  EditorPuzzleDraft,
  GameLogEntry,
  PendingGameLogEntry,
  PendingPrivateRoomJoin,
  PendingResultAutoSubmit,
  PendingSharedLaunch,
  ReplaySource,
  WordHighlightKind
} from "../types";
import { appReducer, createInitialAppState } from "./appReducer";
import { resolveSetStateValue } from "./actions";
import {
  selectCurrentPlayers,
  selectInProgressLobbyRooms,
  selectOpenLobbyRooms
} from "./selectors";
import { useSocketSubscriptions } from "./useSocketSubscriptions";
import { useTimedStatus } from "./useTimedStatus";
import { NameGateView } from "../views/NameGateView";
import { LobbyListView } from "../views/LobbyListView";
import { LobbyCreateView } from "../views/LobbyCreateView";
import { PracticeEditorView } from "../views/PracticeEditorView";
import { PracticeView } from "../views/PracticeView";
import { GameView } from "../views/GameView";
import { ReplayPanelView } from "../views/ReplayPanelView";
import { EndedGameView } from "../views/EndedGameView";
import { PracticeStartModal } from "../views/modals/PracticeStartModal";
import { SettingsModal } from "../views/modals/SettingsModal";
import { LeaveGameModal } from "../views/modals/LeaveGameModal";
import HowToPlay from "../components/HowToPlay";

export function useAppController() {
  const [state, dispatch] = useReducer(
    appReducer,
    createInitialAppState({
      isConnected: socket.connected,
      playerName: readStoredPlayerName(),
      userSettings: readStoredUserSettings(),
      practiceState: createInactivePracticeState(),
      pendingSharedLaunch: readPendingSharedLaunchFromUrl(),
      pendingPrivateRoomJoin: readPendingPrivateRoomJoinFromUrl(),
      defaultFlipTimerSeconds: DEFAULT_FLIP_TIMER_SECONDS,
      defaultClaimTimerSeconds: DEFAULT_CLAIM_TIMER_SECONDS,
      defaultPracticeDifficulty: DEFAULT_PRACTICE_DIFFICULTY,
      defaultPracticeTimerSeconds: DEFAULT_PRACTICE_TIMER_SECONDS
    })
  );

  const isConnected = state.connection.isConnected;
  const selfPlayerId = state.connection.selfPlayerId;
  const roomList = state.server.roomList;
  const roomState = state.server.roomState;
  const gameState = state.server.gameState;
  const practiceState = state.server.practiceState;
  const playerName = state.identity.playerName;
  const nameDraft = state.identity.nameDraft;
  const editNameDraft = state.identity.editNameDraft;
  const userSettings = state.settings.userSettings;
  const userSettingsDraft = state.settings.userSettingsDraft;
  const isSettingsOpen = state.settings.isSettingsOpen;
  const lobbyView = state.lobby.view;
  const lobbyError = state.lobby.error;
  const createRoomName = state.lobby.createRoomForm.roomName;
  const createPublic = state.lobby.createRoomForm.isPublic;
  const createMaxPlayers = state.lobby.createRoomForm.maxPlayers;
  const createFlipTimerEnabled = state.lobby.createRoomForm.flipTimerEnabled;
  const createFlipTimerSeconds = state.lobby.createRoomForm.flipTimerSeconds;
  const createClaimTimerSeconds = state.lobby.createRoomForm.claimTimerSeconds;
  const createPreStealEnabled = state.lobby.createRoomForm.preStealEnabled;
  const showPracticeStartPrompt = state.lobby.practiceStartPrompt.isOpen;
  const practiceStartPromptMode = state.lobby.practiceStartPrompt.mode;
  const practiceStartDifficulty = state.lobby.practiceStartPrompt.difficulty;
  const practiceStartTimerEnabled = state.lobby.practiceStartPrompt.timerEnabled;
  const practiceStartTimerSeconds = state.lobby.practiceStartPrompt.timerSeconds;
  const editorDifficulty = state.lobby.editorForm.difficulty;
  const editorCenterInput = state.lobby.editorForm.centerInput;
  const editorExistingWordsInput = state.lobby.editorForm.existingWordsInput;
  const editorValidationMessageFromServer = state.lobby.editorForm.validationMessageFromServer;
  const editorShareStatus = state.lobby.editorForm.shareStatus;
  const isEditorShareValidationInFlight = state.lobby.editorForm.isShareValidationInFlight;
  const practiceWord = state.practiceUi.practiceWord;
  const practiceSubmitError = state.practiceUi.submitError;
  const practiceShareStatus = state.practiceUi.shareStatus;
  const practiceResultShareStatus = state.practiceUi.resultShareStatus;
  const showAllPracticeOptions = state.practiceUi.showAllOptions;
  const pendingSharedLaunch = state.practiceUi.pendingSharedLaunch;
  const pendingResultAutoSubmit = state.practiceUi.pendingResultAutoSubmit;
  const claimWord = state.gameUi.claimWord;
  const queuedTileClaimLetters = state.gameUi.queuedTileClaimLetters;
  const preStealTriggerInput = state.gameUi.preStealTriggerInput;
  const preStealClaimWordInput = state.gameUi.preStealClaimWordInput;
  const preStealDraggedEntryId = state.gameUi.preStealDraggedEntryId;
  const showLeaveGameConfirm = state.gameUi.showLeaveGameConfirm;
  const gameLogEntries = state.gameUi.gameLogEntries;
  const chatMessages = state.gameUi.chatMessages;
  const chatDraft = state.gameUi.chatDraft;
  const claimedWordHighlights = state.gameUi.claimedWordHighlights;
  const isReplayMode = state.replayUi.isReplayMode;
  const replayStepIndex = state.replayUi.replayStepIndex;
  const replaySource = state.replayUi.replaySource;
  const importReplayError = state.replayUi.importReplayError;
  const replayPuzzleError = state.replayUi.replayPuzzleError;
  const isReplayAnalysisOpen = state.replayUi.isReplayAnalysisOpen;
  const replayAnalysisByStepIndex = state.replayUi.analysisByStepIndex;
  const importedReplayAnalysisByStepIndex = state.replayUi.importedAnalysisByStepIndex;
  const replayAnalysisLoadingStepIndex = state.replayUi.analysisLoadingStepIndex;
  const replayAnalysisError = state.replayUi.analysisError;
  const showAllReplayOptionsByStep = state.replayUi.showAllOptionsByStep;
  const pendingPrivateRoomJoin = state.pendingPrivateRoomJoin;
  const privateInviteCopyStatus = state.privateInviteCopyStatus;
  const now = state.clock.now;

  const setIsConnected = useCallback((value: SetStateAction<boolean>) => {
    dispatch({
      type: "connection/patch",
      updater: (current) => ({ ...current, isConnected: resolveSetStateValue(current.isConnected, value) })
    });
  }, []);
  const setSelfPlayerId = useCallback((value: SetStateAction<string | null>) => {
    dispatch({
      type: "connection/patch",
      updater: (current) => ({ ...current, selfPlayerId: resolveSetStateValue(current.selfPlayerId, value) })
    });
  }, []);
  const setRoomList = useCallback((value: SetStateAction<RoomSummary[]>) => {
    dispatch({
      type: "server/patch",
      updater: (current) => ({ ...current, roomList: resolveSetStateValue(current.roomList, value) })
    });
  }, []);
  const setRoomState = useCallback((value: SetStateAction<RoomState | null>) => {
    dispatch({
      type: "server/patch",
      updater: (current) => ({ ...current, roomState: resolveSetStateValue(current.roomState, value) })
    });
  }, []);
  const setGameState = useCallback((value: SetStateAction<GameState | null>) => {
    dispatch({
      type: "server/patch",
      updater: (current) => ({ ...current, gameState: resolveSetStateValue(current.gameState, value) })
    });
  }, []);
  const setPracticeState = useCallback((value: SetStateAction<PracticeModeState>) => {
    dispatch({
      type: "server/patch",
      updater: (current) => ({ ...current, practiceState: resolveSetStateValue(current.practiceState, value) })
    });
  }, []);
  const setPlayerName = useCallback((value: SetStateAction<string>) => {
    dispatch({
      type: "identity/patch",
      updater: (current) => ({ ...current, playerName: resolveSetStateValue(current.playerName, value) })
    });
  }, []);
  const setNameDraft = useCallback((value: SetStateAction<string>) => {
    dispatch({
      type: "identity/patch",
      updater: (current) => ({ ...current, nameDraft: resolveSetStateValue(current.nameDraft, value) })
    });
  }, []);
  const setEditNameDraft = useCallback((value: SetStateAction<string>) => {
    dispatch({
      type: "identity/patch",
      updater: (current) => ({ ...current, editNameDraft: resolveSetStateValue(current.editNameDraft, value) })
    });
  }, []);
  const setIsSettingsOpen = useCallback((value: SetStateAction<boolean>) => {
    dispatch({
      type: "settings/patch",
      updater: (current) => ({ ...current, isSettingsOpen: resolveSetStateValue(current.isSettingsOpen, value) })
    });
  }, []);
  const setUserSettings = useCallback((value: SetStateAction<UserSettings>) => {
    dispatch({
      type: "settings/patch",
      updater: (current) => ({ ...current, userSettings: resolveSetStateValue(current.userSettings, value) })
    });
  }, []);
  const setUserSettingsDraft = useCallback((value: SetStateAction<UserSettings>) => {
    dispatch({
      type: "settings/patch",
      updater: (current) => ({ ...current, userSettingsDraft: resolveSetStateValue(current.userSettingsDraft, value) })
    });
  }, []);
  const patchLobby = useCallback((updater: SetStateAction<typeof state.lobby>) => {
    dispatch({
      type: "lobby/patch",
      updater: (current) => resolveSetStateValue(current, updater)
    });
  }, []);
  const patchPracticeUi = useCallback((updater: SetStateAction<typeof state.practiceUi>) => {
    dispatch({
      type: "practice/patch",
      updater: (current) => resolveSetStateValue(current, updater)
    });
  }, []);
  const patchGameUi = useCallback((updater: SetStateAction<typeof state.gameUi>) => {
    dispatch({
      type: "game/patch",
      updater: (current) => resolveSetStateValue(current, updater)
    });
  }, []);
  const patchReplayUi = useCallback((updater: SetStateAction<typeof state.replayUi>) => {
    dispatch({
      type: "replay/patch",
      updater: (current) => resolveSetStateValue(current, updater)
    });
  }, []);
  const setLobbyView = useCallback((value: SetStateAction<"list" | "create" | "editor">) => {
    patchLobby((current) => ({ ...current, view: resolveSetStateValue(current.view, value) }));
  }, [patchLobby]);
  const setLobbyError = useCallback((value: SetStateAction<string | null>) => {
    patchLobby((current) => ({ ...current, error: resolveSetStateValue(current.error, value) }));
  }, [patchLobby]);
  const setCreateRoomName = useCallback((value: SetStateAction<string>) => {
    patchLobby((current) => ({
      ...current,
      createRoomForm: {
        ...current.createRoomForm,
        roomName: resolveSetStateValue(current.createRoomForm.roomName, value)
      }
    }));
  }, [patchLobby]);
  const setCreatePublic = useCallback((value: SetStateAction<boolean>) => {
    patchLobby((current) => ({
      ...current,
      createRoomForm: {
        ...current.createRoomForm,
        isPublic: resolveSetStateValue(current.createRoomForm.isPublic, value)
      }
    }));
  }, [patchLobby]);
  const setCreateMaxPlayers = useCallback((value: SetStateAction<number>) => {
    patchLobby((current) => ({
      ...current,
      createRoomForm: {
        ...current.createRoomForm,
        maxPlayers: resolveSetStateValue(current.createRoomForm.maxPlayers, value)
      }
    }));
  }, [patchLobby]);
  const setCreateFlipTimerEnabled = useCallback((value: SetStateAction<boolean>) => {
    patchLobby((current) => ({
      ...current,
      createRoomForm: {
        ...current.createRoomForm,
        flipTimerEnabled: resolveSetStateValue(current.createRoomForm.flipTimerEnabled, value)
      }
    }));
  }, [patchLobby]);
  const setCreateFlipTimerSeconds = useCallback((value: SetStateAction<number>) => {
    patchLobby((current) => ({
      ...current,
      createRoomForm: {
        ...current.createRoomForm,
        flipTimerSeconds: resolveSetStateValue(current.createRoomForm.flipTimerSeconds, value)
      }
    }));
  }, [patchLobby]);
  const setCreateClaimTimerSeconds = useCallback((value: SetStateAction<number>) => {
    patchLobby((current) => ({
      ...current,
      createRoomForm: {
        ...current.createRoomForm,
        claimTimerSeconds: resolveSetStateValue(current.createRoomForm.claimTimerSeconds, value)
      }
    }));
  }, [patchLobby]);
  const setCreatePreStealEnabled = useCallback((value: SetStateAction<boolean>) => {
    patchLobby((current) => ({
      ...current,
      createRoomForm: {
        ...current.createRoomForm,
        preStealEnabled: resolveSetStateValue(current.createRoomForm.preStealEnabled, value)
      }
    }));
  }, [patchLobby]);
  const setShowPracticeStartPrompt = useCallback((value: SetStateAction<boolean>) => {
    patchLobby((current) => ({
      ...current,
      practiceStartPrompt: {
        ...current.practiceStartPrompt,
        isOpen: resolveSetStateValue(current.practiceStartPrompt.isOpen, value)
      }
    }));
  }, [patchLobby]);
  const setPracticeStartPromptMode = useCallback((value: SetStateAction<"start" | "difficulty">) => {
    patchLobby((current) => ({
      ...current,
      practiceStartPrompt: {
        ...current.practiceStartPrompt,
        mode: resolveSetStateValue(current.practiceStartPrompt.mode, value)
      }
    }));
  }, [patchLobby]);
  const setPracticeStartDifficulty = useCallback((value: SetStateAction<PracticeDifficulty | null>) => {
    patchLobby((current) => ({
      ...current,
      practiceStartPrompt: {
        ...current.practiceStartPrompt,
        difficulty: resolveSetStateValue(current.practiceStartPrompt.difficulty, value)
      }
    }));
  }, [patchLobby]);
  const setPracticeStartTimerEnabled = useCallback((value: SetStateAction<boolean>) => {
    patchLobby((current) => ({
      ...current,
      practiceStartPrompt: {
        ...current.practiceStartPrompt,
        timerEnabled: resolveSetStateValue(current.practiceStartPrompt.timerEnabled, value)
      }
    }));
  }, [patchLobby]);
  const setPracticeStartTimerSeconds = useCallback((value: SetStateAction<number>) => {
    patchLobby((current) => ({
      ...current,
      practiceStartPrompt: {
        ...current.practiceStartPrompt,
        timerSeconds: resolveSetStateValue(current.practiceStartPrompt.timerSeconds, value)
      }
    }));
  }, [patchLobby]);
  const setEditorDifficulty = useCallback((value: SetStateAction<PracticeDifficulty>) => {
    patchLobby((current) => ({
      ...current,
      editorForm: {
        ...current.editorForm,
        difficulty: resolveSetStateValue(current.editorForm.difficulty, value)
      }
    }));
  }, [patchLobby]);
  const setEditorCenterInput = useCallback((value: SetStateAction<string>) => {
    patchLobby((current) => ({
      ...current,
      editorForm: {
        ...current.editorForm,
        centerInput: resolveSetStateValue(current.editorForm.centerInput, value)
      }
    }));
  }, [patchLobby]);
  const setEditorExistingWordsInput = useCallback((value: SetStateAction<string>) => {
    patchLobby((current) => ({
      ...current,
      editorForm: {
        ...current.editorForm,
        existingWordsInput: resolveSetStateValue(current.editorForm.existingWordsInput, value)
      }
    }));
  }, [patchLobby]);
  const setEditorValidationMessageFromServer = useCallback((value: SetStateAction<string | null>) => {
    patchLobby((current) => ({
      ...current,
      editorForm: {
        ...current.editorForm,
        validationMessageFromServer: resolveSetStateValue(current.editorForm.validationMessageFromServer, value)
      }
    }));
  }, [patchLobby]);
  const setEditorShareStatus = useCallback((value: SetStateAction<"copied" | "failed" | null>) => {
    patchLobby((current) => ({
      ...current,
      editorForm: {
        ...current.editorForm,
        shareStatus: resolveSetStateValue(current.editorForm.shareStatus, value)
      }
    }));
  }, [patchLobby]);
  const setIsEditorShareValidationInFlight = useCallback((value: SetStateAction<boolean>) => {
    patchLobby((current) => ({
      ...current,
      editorForm: {
        ...current.editorForm,
        isShareValidationInFlight: resolveSetStateValue(current.editorForm.isShareValidationInFlight, value)
      }
    }));
  }, [patchLobby]);
  const setPracticeWord = useCallback((value: SetStateAction<string>) => {
    patchPracticeUi((current) => ({ ...current, practiceWord: resolveSetStateValue(current.practiceWord, value) }));
  }, [patchPracticeUi]);
  const setPracticeSubmitError = useCallback((value: SetStateAction<string | null>) => {
    patchPracticeUi((current) => ({ ...current, submitError: resolveSetStateValue(current.submitError, value) }));
  }, [patchPracticeUi]);
  const setPracticeShareStatus = useCallback((value: SetStateAction<"copied" | "failed" | null>) => {
    patchPracticeUi((current) => ({ ...current, shareStatus: resolveSetStateValue(current.shareStatus, value) }));
  }, [patchPracticeUi]);
  const setPracticeResultShareStatus = useCallback((value: SetStateAction<"copied" | "failed" | null>) => {
    patchPracticeUi((current) => ({ ...current, resultShareStatus: resolveSetStateValue(current.resultShareStatus, value) }));
  }, [patchPracticeUi]);
  const setShowAllPracticeOptions = useCallback((value: SetStateAction<boolean>) => {
    patchPracticeUi((current) => ({ ...current, showAllOptions: resolveSetStateValue(current.showAllOptions, value) }));
  }, [patchPracticeUi]);
  const setPendingSharedLaunch = useCallback((value: SetStateAction<PendingSharedLaunch | null>) => {
    patchPracticeUi((current) => ({
      ...current,
      pendingSharedLaunch: resolveSetStateValue(current.pendingSharedLaunch, value)
    }));
  }, [patchPracticeUi]);
  const setPendingResultAutoSubmit = useCallback((value: SetStateAction<PendingResultAutoSubmit | null>) => {
    patchPracticeUi((current) => ({
      ...current,
      pendingResultAutoSubmit: resolveSetStateValue(current.pendingResultAutoSubmit, value)
    }));
  }, [patchPracticeUi]);
  const setClaimWord = useCallback((value: SetStateAction<string>) => {
    patchGameUi((current) => ({ ...current, claimWord: resolveSetStateValue(current.claimWord, value) }));
  }, [patchGameUi]);
  const setQueuedTileClaimLetters = useCallback((value: SetStateAction<string>) => {
    patchGameUi((current) => ({
      ...current,
      queuedTileClaimLetters: resolveSetStateValue(current.queuedTileClaimLetters, value)
    }));
  }, [patchGameUi]);
  const setPreStealTriggerInput = useCallback((value: SetStateAction<string>) => {
    patchGameUi((current) => ({
      ...current,
      preStealTriggerInput: resolveSetStateValue(current.preStealTriggerInput, value)
    }));
  }, [patchGameUi]);
  const setPreStealClaimWordInput = useCallback((value: SetStateAction<string>) => {
    patchGameUi((current) => ({
      ...current,
      preStealClaimWordInput: resolveSetStateValue(current.preStealClaimWordInput, value)
    }));
  }, [patchGameUi]);
  const setPreStealDraggedEntryId = useCallback((value: SetStateAction<string | null>) => {
    patchGameUi((current) => ({
      ...current,
      preStealDraggedEntryId: resolveSetStateValue(current.preStealDraggedEntryId, value)
    }));
  }, [patchGameUi]);
  const setShowLeaveGameConfirm = useCallback((value: SetStateAction<boolean>) => {
    patchGameUi((current) => ({
      ...current,
      showLeaveGameConfirm: resolveSetStateValue(current.showLeaveGameConfirm, value)
    }));
  }, [patchGameUi]);
  const setGameLogEntries = useCallback((value: SetStateAction<GameLogEntry[]>) => {
    patchGameUi((current) => ({ ...current, gameLogEntries: resolveSetStateValue(current.gameLogEntries, value) }));
  }, [patchGameUi]);
  const setChatMessages = useCallback((value: SetStateAction<ChatMessage[]>) => {
    patchGameUi((current) => ({ ...current, chatMessages: resolveSetStateValue(current.chatMessages, value) }));
  }, [patchGameUi]);
  const setChatDraft = useCallback((value: SetStateAction<string>) => {
    patchGameUi((current) => ({ ...current, chatDraft: resolveSetStateValue(current.chatDraft, value) }));
  }, [patchGameUi]);
  const setClaimedWordHighlights = useCallback((value: SetStateAction<Record<string, WordHighlightKind>>) => {
    patchGameUi((current) => ({
      ...current,
      claimedWordHighlights: resolveSetStateValue(current.claimedWordHighlights, value)
    }));
  }, [patchGameUi]);
  const setIsReplayMode = useCallback((value: SetStateAction<boolean>) => {
    patchReplayUi((current) => ({ ...current, isReplayMode: resolveSetStateValue(current.isReplayMode, value) }));
  }, [patchReplayUi]);
  const setReplayStepIndex = useCallback((value: SetStateAction<number>) => {
    patchReplayUi((current) => ({ ...current, replayStepIndex: resolveSetStateValue(current.replayStepIndex, value) }));
  }, [patchReplayUi]);
  const setReplaySource = useCallback((value: SetStateAction<ReplaySource | null>) => {
    patchReplayUi((current) => ({ ...current, replaySource: resolveSetStateValue(current.replaySource, value) }));
  }, [patchReplayUi]);
  const setImportReplayError = useCallback((value: SetStateAction<string | null>) => {
    patchReplayUi((current) => ({ ...current, importReplayError: resolveSetStateValue(current.importReplayError, value) }));
  }, [patchReplayUi]);
  const setReplayPuzzleError = useCallback((value: SetStateAction<string | null>) => {
    patchReplayUi((current) => ({ ...current, replayPuzzleError: resolveSetStateValue(current.replayPuzzleError, value) }));
  }, [patchReplayUi]);
  const setIsReplayAnalysisOpen = useCallback((value: SetStateAction<boolean>) => {
    patchReplayUi((current) => ({
      ...current,
      isReplayAnalysisOpen: resolveSetStateValue(current.isReplayAnalysisOpen, value)
    }));
  }, [patchReplayUi]);
  const setReplayAnalysisByStepIndex = useCallback((value: SetStateAction<Record<number, ReplayAnalysisResult>>) => {
    patchReplayUi((current) => ({
      ...current,
      analysisByStepIndex: resolveSetStateValue(current.analysisByStepIndex, value)
    }));
  }, [patchReplayUi]);
  const setImportedReplayAnalysisByStepIndex = useCallback((value: SetStateAction<Record<number, ReplayAnalysisResult>>) => {
    patchReplayUi((current) => ({
      ...current,
      importedAnalysisByStepIndex: resolveSetStateValue(current.importedAnalysisByStepIndex, value)
    }));
  }, [patchReplayUi]);
  const setReplayAnalysisLoadingStepIndex = useCallback((value: SetStateAction<number | null>) => {
    patchReplayUi((current) => ({
      ...current,
      analysisLoadingStepIndex: resolveSetStateValue(current.analysisLoadingStepIndex, value)
    }));
  }, [patchReplayUi]);
  const setReplayAnalysisError = useCallback((value: SetStateAction<string | null>) => {
    patchReplayUi((current) => ({ ...current, analysisError: resolveSetStateValue(current.analysisError, value) }));
  }, [patchReplayUi]);
  const setShowAllReplayOptionsByStep = useCallback((value: SetStateAction<Record<number, boolean>>) => {
    patchReplayUi((current) => ({
      ...current,
      showAllOptionsByStep: resolveSetStateValue(current.showAllOptionsByStep, value)
    }));
  }, [patchReplayUi]);
  const setPendingPrivateRoomJoin = useCallback((value: SetStateAction<PendingPrivateRoomJoin | null>) => {
    dispatch({
      type: "app/set-pending-private-room-join",
      value: resolveSetStateValue(pendingPrivateRoomJoin, value)
    });
  }, [pendingPrivateRoomJoin]);
  const setPrivateInviteCopyStatus = useCallback((value: SetStateAction<"copied" | "failed" | null>) => {
    dispatch({
      type: "app/set-private-invite-copy-status",
      value: resolveSetStateValue(privateInviteCopyStatus, value)
    });
  }, [privateInviteCopyStatus]);
  const setNow = useCallback((value: SetStateAction<number>) => {
    dispatch({
      type: "clock/tick",
      now: resolveSetStateValue(now, value)
    });
  }, [now]);
  const claimInputRef = useRef<HTMLInputElement>(null);
  const practiceInputRef = useRef<HTMLInputElement>(null);
  const replayImportInputRef = useRef<HTMLInputElement>(null);
  const gameLogListRef = useRef<HTMLDivElement>(null);
  const chatListRef = useRef<HTMLDivElement>(null);
  const previousGameStateRef = useRef<GameState | null>(null);
  const lastClaimFailureRef = useRef<ClaimFailureContext | null>(null);
  const roomStatusRef = useRef<RoomState["status"] | null>(null);
  const hasGameStateRef = useRef(false);
  const practiceModeRef = useRef<{ active: boolean; phase: PracticeModeState["phase"] }>({
    active: false,
    phase: "puzzle"
  });
  const previousRoomIdRef = useRef<string | null>(null);
  const claimAnimationTimeoutsRef = useRef<Map<string, number>>(new Map());

  const appendGameLogEntries = useCallback((entries: PendingGameLogEntry[]) => {
    if (entries.length === 0) return;
    setGameLogEntries((current) => {
      const nextEntries = entries.map((entry) => ({
        id: generateId(),
        timestamp: entry.timestamp ?? Date.now(),
        text: entry.text,
        kind: entry.kind
      }));
      const next = [...current, ...nextEntries];
      if (next.length <= MAX_LOG_ENTRIES) return next;
      return next.slice(next.length - MAX_LOG_ENTRIES);
    });
  }, []);

  const clearClaimWordHighlights = useCallback(() => {
    claimAnimationTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    claimAnimationTimeoutsRef.current.clear();
    setClaimedWordHighlights({});
  }, []);

  const markClaimedWordForAnimation = useCallback((wordId: string, kind: WordHighlightKind = "claim") => {
    setClaimedWordHighlights((current) => ({ ...current, [wordId]: kind }));
    const existingTimeoutId = claimAnimationTimeoutsRef.current.get(wordId);
    if (existingTimeoutId !== undefined) {
      window.clearTimeout(existingTimeoutId);
    }

    const timeoutId = window.setTimeout(() => {
      setClaimedWordHighlights((current) => {
        if (!(wordId in current)) {
          return current;
        }
        const next = { ...current };
        delete next[wordId];
        return next;
      });
      claimAnimationTimeoutsRef.current.delete(wordId);
    }, CLAIM_WORD_ANIMATION_MS);

    claimAnimationTimeoutsRef.current.set(wordId, timeoutId);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      claimAnimationTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      claimAnimationTimeoutsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    roomStatusRef.current = roomState?.status ?? null;
    hasGameStateRef.current = Boolean(gameState);
  }, [roomState?.status, gameState]);

  useEffect(() => {
    practiceModeRef.current = {
      active: practiceState.active,
      phase: practiceState.phase
    };
  }, [practiceState.active, practiceState.phase]);

  const onSocketConnect = useCallback(() => {
    setIsConnected(true);
    socket.emit("room:list");
  }, [setIsConnected]);
  const onSocketDisconnect = useCallback(() => setIsConnected(false), [setIsConnected]);
  const onSocketRoomList = useCallback((rooms: RoomSummary[]) => setRoomList(rooms), [setRoomList]);
  const onSocketRoomState = useCallback((nextState: RoomState) => setRoomState(nextState), [setRoomState]);
  const onSocketGameState = useCallback((nextState: GameState) => setGameState(nextState), [setGameState]);
  const onSocketPracticeState = useCallback(
    (nextState: PracticeModeState) => setPracticeState(nextState),
    [setPracticeState]
  );
  const onSocketChatHistory = useCallback((messages: ChatMessage[]) => {
    if (!userSettings.chatEnabled) {
      setChatMessages([]);
      return;
    }
    if (!Array.isArray(messages)) {
      setChatMessages([]);
      return;
    }
    if (messages.length <= MAX_CHAT_ENTRIES) {
      setChatMessages(messages);
      return;
    }
    setChatMessages(messages.slice(messages.length - MAX_CHAT_ENTRIES));
  }, [setChatMessages, userSettings.chatEnabled]);
  const onSocketChatMessage = useCallback((message: ChatMessage) => {
    if (!userSettings.chatEnabled) return;
    if (!message || typeof message !== "object") return;
    setChatMessages((current) => {
      const next = [...current, message];
      if (next.length <= MAX_CHAT_ENTRIES) return next;
      return next.slice(next.length - MAX_CHAT_ENTRIES);
    });
  }, [setChatMessages, userSettings.chatEnabled]);
  const onSocketError = useCallback((payload: { message: string }) => {
    const { message } = payload;
    if (practiceModeRef.current.active && practiceModeRef.current.phase === "puzzle") {
      setPracticeSubmitError(message);
      return;
    }

    if (roomStatusRef.current !== "in-game" || !hasGameStateRef.current) {
      setPendingResultAutoSubmit(null);
      setLobbyError(message);
      return;
    }

    const timestamp = Date.now();
    if (CLAIM_FAILURE_MESSAGES.has(message)) {
      lastClaimFailureRef.current = { message, at: timestamp };
    }

    appendGameLogEntries([{ text: message, kind: "error", timestamp }]);
  }, [appendGameLogEntries, setLobbyError, setPendingResultAutoSubmit, setPracticeSubmitError]);
  const onSocketSessionSelf = useCallback(({
    playerId,
    name,
    sessionToken
  }: {
    playerId: string;
    name: string;
    roomId: string | null;
    sessionToken?: string;
  }) => {
    if (typeof sessionToken === "string" && sessionToken.trim()) {
      setSocketSessionToken(sessionToken);
    }
    setSelfPlayerId(playerId);
    if (playerName.trim()) {
      const sanitizedLocalName = sanitizeClientName(playerName);
      if (sanitizedLocalName !== playerName) {
        setPlayerName(sanitizedLocalName);
        setNameDraft(sanitizedLocalName);
        setEditNameDraft(sanitizedLocalName);
        persistPlayerName(sanitizedLocalName);
      }
      if (sanitizedLocalName !== name) {
        socket.emit("session:update-name", { name: sanitizedLocalName });
      }
      return;
    }
    const resolvedName = sanitizeClientName(name);
    if (resolvedName === "Player") return;
    setPlayerName(resolvedName);
    setNameDraft(resolvedName);
    setEditNameDraft(resolvedName);
    persistPlayerName(resolvedName);
  }, [playerName, setEditNameDraft, setNameDraft, setPlayerName, setSelfPlayerId]);

  useSocketSubscriptions({
    onConnect: onSocketConnect,
    onDisconnect: onSocketDisconnect,
    onRoomList: onSocketRoomList,
    onRoomState: onSocketRoomState,
    onGameState: onSocketGameState,
    onPracticeState: onSocketPracticeState,
    onChatHistory: onSocketChatHistory,
    onChatMessage: onSocketChatMessage,
    onSessionSelf: onSocketSessionSelf,
    onError: onSocketError
  });

  const currentPlayers: Player[] = useMemo(() => selectCurrentPlayers(state), [state]);
  const myPreStealEntries = useMemo(() => {
    if (!gameState || !selfPlayerId) return [];
    return gameState.players.find((player) => player.id === selfPlayerId)?.preStealEntries ?? [];
  }, [gameState, selfPlayerId]);
  const orderedGamePlayers = useMemo(() => {
    if (!gameState) return [];

    const playersById = new Map(gameState.players.map((player) => [player.id, player]));
    const precedenceOrderedPlayers = gameState.preStealPrecedenceOrder
      .map((playerId) => playersById.get(playerId))
      .filter((player): player is Player => Boolean(player));

    if (precedenceOrderedPlayers.length === 0) {
      return gameState.players;
    }

    const includedIds = new Set(precedenceOrderedPlayers.map((player) => player.id));
    const remainingPlayers = gameState.players.filter((player) => !includedIds.has(player.id));
    return [...precedenceOrderedPlayers, ...remainingPlayers];
  }, [gameState]);
  const spectatorPreStealPlayers = useMemo(() => {
    return orderedGamePlayers.map((player) => ({
      id: player.id,
      name: player.name,
      connected: player.connected,
      preStealEntries: player.preStealEntries
    }));
  }, [orderedGamePlayers]);

  const openLobbyRooms = useMemo(() => selectOpenLobbyRooms(state), [state]);
  const inProgressLobbyRooms = useMemo(() => selectInProgressLobbyRooms(state), [state]);
  const userSettingsContextValue = useMemo(
    () => buildUserSettingsContextValue(userSettings),
    [userSettings]
  );
  const isTileInputMethodEnabled = userSettingsContextValue.isTileInputMethodEnabled;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", userSettings.theme);
    document.documentElement.style.colorScheme = userSettings.theme;
  }, [userSettings.theme]);

  const endTimerRemaining = useMemo(() => {
    if (!gameState?.endTimerEndsAt) return null;
    const remaining = Math.max(0, Math.ceil((gameState.endTimerEndsAt - now) / 1000));
    return remaining;
  }, [gameState?.endTimerEndsAt, now]);

  const isHost = roomState?.hostId === selfPlayerId;
  const isInGame = roomState?.status === "in-game" && gameState;
  const isSpectator = useMemo(() => {
    if (!roomState || !gameState || !selfPlayerId) return false;
    return !gameState.players.some((player) => player.id === selfPlayerId);
  }, [roomState, gameState, selfPlayerId]);
  const pendingFlip = gameState?.pendingFlip ?? null;
  const isFlipRevealActive = pendingFlip !== null;
  const flipRevealDurationMs = pendingFlip
    ? Math.max(1, pendingFlip.revealsAt - pendingFlip.startedAt)
    : DEFAULT_FLIP_REVEAL_MS;
  const flipRevealElapsedMs = pendingFlip
    ? Math.max(0, Math.min(flipRevealDurationMs, now - pendingFlip.startedAt))
    : 0;
  const flipRevealPlayerName = useMemo(() => {
    if (!pendingFlip || !gameState) return "Unknown";
    return getPlayerName(gameState.players, pendingFlip.playerId);
  }, [pendingFlip, gameState]);
  const claimWindow = gameState?.claimWindow ?? null;
  const isMyClaimWindow = claimWindow?.playerId === selfPlayerId;
  const claimTimerSeconds = roomState?.claimTimer.seconds ?? DEFAULT_CLAIM_TIMER_SECONDS;
  const claimWindowRemainingMs = useMemo(() => {
    if (!claimWindow) return null;
    return Math.max(0, claimWindow.endsAt - now);
  }, [claimWindow, now]);
  const claimWindowRemainingSeconds =
    claimWindowRemainingMs === null ? null : Math.max(0, Math.ceil(claimWindowRemainingMs / 1000));
  const claimProgress =
    claimWindowRemainingMs === null
      ? 0
      : Math.max(
          0,
          Math.min(1, claimWindowRemainingMs / (claimTimerSeconds * 1000))
        );
  const claimCooldownEndsAt = selfPlayerId ? gameState?.claimCooldowns?.[selfPlayerId] : null;
  const claimCooldownRemainingMs =
    claimCooldownEndsAt && claimCooldownEndsAt > now ? claimCooldownEndsAt - now : null;
  const claimCooldownRemainingSeconds =
    claimCooldownRemainingMs === null ? null : Math.max(0, Math.ceil(claimCooldownRemainingMs / 1000));
  const isClaimCooldownActive = claimCooldownRemainingMs !== null;
  const claimWindowPlayerName = useMemo(() => {
    if (!claimWindow || !gameState) return "Unknown";
    return gameState.players.find((player) => player.id === claimWindow.playerId)?.name ?? "Unknown";
  }, [claimWindow, gameState]);
  const claimStatus = useMemo(() => {
    if (isSpectator) {
      return "Spectating (read-only)";
    }
    if (isFlipRevealActive) {
      return `${flipRevealPlayerName} is revealing a tile...`;
    }
    if (claimWindow && claimWindowRemainingSeconds !== null) {
      if (isMyClaimWindow) {
        return `Your claim window: ${claimWindowRemainingSeconds}s`;
      }
      return `${claimWindowPlayerName} is claiming (${claimWindowRemainingSeconds}s)`;
    }
    if (isClaimCooldownActive && claimCooldownRemainingSeconds !== null) {
      return `Cooldown: ${claimCooldownRemainingSeconds}s or next flip.`;
    }
    return isTileInputMethodEnabled
      ? "Click or tap tiles to build a claim"
      : "Press enter to claim a word";
  }, [
    isSpectator,
    isFlipRevealActive,
    flipRevealPlayerName,
    claimWindow,
    claimWindowRemainingSeconds,
    isMyClaimWindow,
    claimWindowPlayerName,
    isClaimCooldownActive,
    claimCooldownRemainingSeconds,
    isTileInputMethodEnabled
  ]);
  const claimPlaceholder = claimStatus;
  const claimButtonLabel = isSpectator ? "Spectating" : isMyClaimWindow ? "Submit Claim" : "Start Claim";
  const isClaimButtonDisabled = isMyClaimWindow
    ? !claimWord.trim() || isFlipRevealActive
    : Boolean(claimWindow) || isClaimCooldownActive || isFlipRevealActive || isSpectator;
  const isClaimInputDisabled = !isMyClaimWindow || isClaimCooldownActive || isFlipRevealActive || isSpectator;
  const isTileSelectionEnabled = isTileInputMethodEnabled && !isSpectator;
  const shouldShowClaimUndoButton = isTileInputMethodEnabled && !isSpectator;
  const isClaimUndoButtonDisabled = isMyClaimWindow
    ? claimWord.length === 0
    : queuedTileClaimLetters.length === 0;
  const shouldShowGameLog = Boolean(gameState) && roomState?.status === "in-game";
  const isBottomPanelChatEnabled = userSettings.chatEnabled;
  const isBottomPanelChatMode = isBottomPanelChatEnabled && userSettings.bottomPanelMode === "chat";
  const roomReplay = gameState?.replay ?? null;
  const roomReplaySteps = useMemo(
    () =>
      (roomReplay?.steps ?? []).filter(
        (step) => step.kind === "flip-revealed" || step.kind === "claim-succeeded"
      ),
    [roomReplay?.steps]
  );
  const activeReplay =
    replaySource?.kind === "imported"
      ? replaySource.file.replay
      : replaySource?.kind === "room"
        ? replaySource.replay
        : null;
  const replaySteps = useMemo(
    () =>
      (activeReplay?.steps ?? []).filter(
        (step) => step.kind === "flip-revealed" || step.kind === "claim-succeeded"
      ),
    [activeReplay?.steps]
  );
  const maxReplayStepIndex = replaySteps.length > 0 ? replaySteps.length - 1 : 0;
  const clampedReplayStepIndex = Math.min(Math.max(replayStepIndex, 0), maxReplayStepIndex);
  const activeReplayStep = replaySteps[clampedReplayStepIndex] ?? null;
  const activeReplayState: ReplayStateSnapshot | null = activeReplayStep?.state ?? null;
  const activeReplayActionText = useMemo(
    () => buildReplayActionText(replaySteps, clampedReplayStepIndex),
    [replaySteps, clampedReplayStepIndex]
  );
  const activeReplayRequestedStepIndex = activeReplayStep?.index ?? null;
  const activeImportedReplayAnalysis =
    replaySource?.kind === "imported" && activeReplayRequestedStepIndex !== null
      ? importedReplayAnalysisByStepIndex[activeReplayRequestedStepIndex] ??
        getImportedReplayAnalysis(replaySource.file, activeReplayRequestedStepIndex)
      : null;
  const activeReplayAnalysis =
    activeReplayRequestedStepIndex === null
      ? null
      : replaySource?.kind === "imported"
        ? activeImportedReplayAnalysis
        : replayAnalysisByStepIndex[activeReplayRequestedStepIndex] ?? null;
  const isActiveReplayAnalysisLoading =
    activeReplayRequestedStepIndex !== null &&
    replayAnalysisLoadingStepIndex === activeReplayRequestedStepIndex;
  const {
    visibleReplayAnalysisOptions,
    hiddenReplayAnalysisOptionCount
  } = useMemo(() => {
    if (!activeReplayAnalysis) {
      return {
        visibleReplayAnalysisOptions: [] as PracticeScoredWord[],
        hiddenReplayAnalysisOptionCount: 0
      };
    }

    const requestedStepIndex = activeReplayAnalysis.requestedStepIndex;
    const showAll = Boolean(showAllReplayOptionsByStep[requestedStepIndex]);
    if (showAll) {
      return {
        visibleReplayAnalysisOptions: activeReplayAnalysis.allOptions,
        hiddenReplayAnalysisOptionCount: 0
      };
    }

    const visibleCount = Math.min(
      REPLAY_ANALYSIS_DEFAULT_VISIBLE_OPTIONS,
      activeReplayAnalysis.allOptions.length
    );
    return {
      visibleReplayAnalysisOptions: activeReplayAnalysis.allOptions.slice(0, visibleCount),
      hiddenReplayAnalysisOptionCount: Math.max(0, activeReplayAnalysis.allOptions.length - visibleCount)
    };
  }, [activeReplayAnalysis, showAllReplayOptionsByStep]);
  const activeReplayClaimedWords = useMemo(() => {
    const claimWordDiff = getReplayClaimWordDiff(replaySteps, clampedReplayStepIndex);
    if (!claimWordDiff) return new Set<string>();
    return new Set(claimWordDiff.addedWords.map((word) => normalizeEditorText(word.text)));
  }, [replaySteps, clampedReplayStepIndex]);
  const canExportReplay = Boolean(
    roomState?.status === "ended" && replaySource?.kind === "room" && roomReplay
  );
  const replayTurnPlayerName = activeReplayState
    ? getPlayerName(activeReplayState.players, activeReplayState.turnPlayerId)
    : "Unknown";
  const orderedReplayPlayers = useMemo(() => {
    if (!activeReplayState) return [];

    const playersById = new Map(activeReplayState.players.map((player) => [player.id, player]));
    const precedenceOrderedPlayers = activeReplayState.preStealPrecedenceOrder
      .map((playerId) => playersById.get(playerId))
      .filter((player): player is ReplayPlayerSnapshot => Boolean(player));

    if (precedenceOrderedPlayers.length === 0) {
      return activeReplayState.players;
    }

    const includedIds = new Set(precedenceOrderedPlayers.map((player) => player.id));
    const remainingPlayers = activeReplayState.players.filter((player) => !includedIds.has(player.id));
    return [...precedenceOrderedPlayers, ...remainingPlayers];
  }, [activeReplayState]);
  const replayPreStealPlayers = useMemo(() => {
    return orderedReplayPlayers.map((player) => ({
      id: player.id,
      name: player.name,
      preStealEntries: player.preStealEntries
    }));
  }, [orderedReplayPlayers]);
  const gameOverStandings = useMemo(() => {
    if (!gameState) {
      return { players: [] as Player[], winningScore: null as number | null };
    }

    const players = gameState.players.slice().sort((a, b) => b.score - a.score);
    const winningScore = players.length > 0 ? players[0].score : null;
    return { players, winningScore };
  }, [gameState]);
  const isInPractice = !roomState && practiceState.active;
  const practicePuzzle = practiceState.puzzle;
  const practiceResult = practiceState.result;
  const practiceTimerRemainingMs = useMemo(() => {
    if (!practiceState.active) return null;
    if (practiceState.phase !== "puzzle") return null;
    if (!practiceState.timerEnabled) return null;
    if (!practiceState.puzzleTimerEndsAt) return null;
    return Math.max(0, practiceState.puzzleTimerEndsAt - now);
  }, [
    practiceState.active,
    practiceState.phase,
    practiceState.timerEnabled,
    practiceState.puzzleTimerEndsAt,
    now
  ]);
  const practiceTimerRemainingSeconds =
    practiceTimerRemainingMs === null ? null : Math.max(0, Math.ceil(practiceTimerRemainingMs / 1000));
  const practiceTimerProgress =
    practiceTimerRemainingMs === null
      ? 0
      : Math.max(0, Math.min(1, practiceTimerRemainingMs / (practiceState.timerSeconds * 1000)));
  const isPracticeTimerWarning =
    practiceTimerRemainingSeconds !== null && practiceTimerRemainingSeconds <= PRACTICE_TIMER_WARNING_SECONDS;
  const practiceResultCategory = useMemo(
    () => (practiceResult ? getPracticeResultCategory(practiceResult) : null),
    [practiceResult]
  );
  const {
    visiblePracticeOptions,
    hiddenPracticeOptionCount
  } = useMemo(() => {
    if (!practiceResult) {
      return {
        visiblePracticeOptions: [] as PracticeScoredWord[],
        hiddenPracticeOptionCount: 0
      };
    }

    const allOptions = practiceResult.allOptions;
    if (showAllPracticeOptions) {
      return {
        visiblePracticeOptions: allOptions,
        hiddenPracticeOptionCount: 0
      };
    }

    const submittedScore = practiceResult.score;
    const firstLowerScoringIndex = allOptions.findIndex((option) => option.score < submittedScore);
    const minimumVisibleCount = Math.min(3, allOptions.length);
    const visibleCount = Math.min(
      allOptions.length,
      Math.max(minimumVisibleCount, firstLowerScoringIndex === -1 ? allOptions.length : firstLowerScoringIndex)
    );

    return {
      visiblePracticeOptions: allOptions.slice(0, visibleCount),
      hiddenPracticeOptionCount: allOptions.length - visibleCount
    };
  }, [practiceResult, showAllPracticeOptions]);

  const editorPuzzleDraft: EditorPuzzleDraft = useMemo(() => {
    const normalizedCenter = normalizeEditorText(editorCenterInput);
    const normalizedExistingWords = editorExistingWordsInput
      .split(/\r?\n/)
      .map((line) => normalizeEditorText(line))
      .filter((line) => line.length > 0);

    if (!normalizedCenter) {
      return {
        payload: null,
        validationMessage: "Enter at least one center tile letter.",
        normalizedCenter,
        normalizedExistingWords
      };
    }

    if (!LETTER_PATTERN.test(normalizedCenter)) {
      return {
        payload: null,
        validationMessage: "Center tiles must contain only letters A-Z.",
        normalizedCenter,
        normalizedExistingWords
      };
    }

    if (
      normalizedCenter.length < CUSTOM_PUZZLE_CENTER_LETTER_MIN ||
      normalizedCenter.length > CUSTOM_PUZZLE_CENTER_LETTER_MAX
    ) {
      return {
        payload: null,
        validationMessage: `Center tiles must be ${CUSTOM_PUZZLE_CENTER_LETTER_MIN}-${CUSTOM_PUZZLE_CENTER_LETTER_MAX} letters.`,
        normalizedCenter,
        normalizedExistingWords
      };
    }

    if (normalizedExistingWords.length > CUSTOM_PUZZLE_EXISTING_WORD_COUNT_MAX) {
      return {
        payload: null,
        validationMessage: `Use at most ${CUSTOM_PUZZLE_EXISTING_WORD_COUNT_MAX} existing words.`,
        normalizedCenter,
        normalizedExistingWords
      };
    }

    let totalCharacters = normalizedCenter.length;
    for (const word of normalizedExistingWords) {
      if (!LETTER_PATTERN.test(word)) {
        return {
          payload: null,
          validationMessage: "Existing words must contain only letters A-Z.",
          normalizedCenter,
          normalizedExistingWords
        };
      }
      if (
        word.length < CUSTOM_PUZZLE_EXISTING_WORD_LENGTH_MIN ||
        word.length > CUSTOM_PUZZLE_EXISTING_WORD_LENGTH_MAX
      ) {
        return {
          payload: null,
          validationMessage: `Each existing word must be ${CUSTOM_PUZZLE_EXISTING_WORD_LENGTH_MIN}-${CUSTOM_PUZZLE_EXISTING_WORD_LENGTH_MAX} letters.`,
          normalizedCenter,
          normalizedExistingWords
        };
      }
      totalCharacters += word.length;
      if (totalCharacters > CUSTOM_PUZZLE_TOTAL_CHARACTERS_MAX) {
        return {
          payload: null,
          validationMessage: `Total characters across center tiles and existing words must be at most ${CUSTOM_PUZZLE_TOTAL_CHARACTERS_MAX}.`,
          normalizedCenter,
          normalizedExistingWords
        };
      }
    }

    return {
      payload: {
        v: 2,
        d: editorDifficulty,
        c: normalizedCenter,
        w: normalizedExistingWords
      },
      validationMessage: null,
      normalizedCenter,
      normalizedExistingWords
    };
  }, [editorCenterInput, editorDifficulty, editorExistingWordsInput]);

  const showEditorShareStatus = useTimedStatus(setEditorShareStatus);
  const showPracticeShareStatus = useTimedStatus(setPracticeShareStatus);
  const showPracticeResultShareStatus = useTimedStatus(setPracticeResultShareStatus);
  const showPrivateInviteCopyStatus = useTimedStatus(setPrivateInviteCopyStatus);

  const editorValidationMessage = editorPuzzleDraft.validationMessage ?? editorValidationMessageFromServer;
  const isEditorPuzzleReady = editorPuzzleDraft.payload !== null;
  const editorTotalCharacters = useMemo(() => {
    return (
      editorPuzzleDraft.normalizedCenter.length +
      editorPuzzleDraft.normalizedExistingWords.reduce((sum, word) => sum + word.length, 0)
    );
  }, [editorPuzzleDraft.normalizedCenter.length, editorPuzzleDraft.normalizedExistingWords]);

  const handleCreate = () => {
    if (!playerName) return;
    if (practiceState.active) return;
    setLobbyError(null);
    const flipTimerSeconds = clampFlipTimerSeconds(createFlipTimerSeconds);
    const claimTimerSeconds = clampClaimTimerSeconds(createClaimTimerSeconds);
    socket.emit("room:create", {
      roomName: createRoomName,
      playerName,
      isPublic: createPublic,
      maxPlayers: createMaxPlayers,
      flipTimerEnabled: createFlipTimerEnabled,
      flipTimerSeconds,
      claimTimerSeconds,
      preStealEnabled: createPreStealEnabled
    });
  };

  const handleJoinRoom = (room: RoomSummary) => {
    if (!playerName) return;
    if (practiceState.active) return;
    if (room.status !== "lobby") return;
    if (!room.isPublic) return;
    if (room.playerCount >= room.maxPlayers) return;
    setLobbyError(null);
    socket.emit("room:join", {
      roomId: room.id,
      name: playerName
    });
  };

  const handleSpectateRoom = (room: RoomSummary) => {
    if (!playerName) return;
    if (practiceState.active) return;
    if (room.status !== "in-game") return;
    if (!room.isPublic) return;
    setLobbyError(null);
    socket.emit("room:spectate", { roomId: room.id });
  };

  const handleStart = () => {
    if (!roomState) return;
    socket.emit("room:start", { roomId: roomState.id });
  };

  const handleStartPractice = () => {
    if (roomState) return;
    setLobbyError(null);
    setPracticeStartPromptMode("start");
    setPracticeStartDifficulty(null);
    setPracticeStartTimerEnabled(false);
    setPracticeStartTimerSeconds(DEFAULT_PRACTICE_TIMER_SECONDS);
    setShowPracticeStartPrompt(true);
    setLobbyView("list");
  };

  const handleOpenPracticeDifficultyPicker = () => {
    if (!practiceState.active) return;
    if (roomState) return;
    setPracticeStartPromptMode("difficulty");
    setPracticeStartDifficulty(clampPracticeDifficulty(practiceState.currentDifficulty));
    setPracticeStartTimerEnabled(false);
    setPracticeStartTimerSeconds(DEFAULT_PRACTICE_TIMER_SECONDS);
    setShowPracticeStartPrompt(true);
  };

  const handleConfirmPracticeStart = () => {
    if (practiceStartDifficulty === null) return;
    setLobbyError(null);
    if (practiceStartPromptMode === "difficulty" && practiceState.active) {
      socket.emit("practice:set-difficulty", {
        difficulty: clampPracticeDifficulty(practiceStartDifficulty)
      });
      socket.emit("practice:skip");
      setPracticeWord("");
      setPracticeSubmitError(null);
      setPendingResultAutoSubmit(null);
    } else {
      socket.emit("practice:start", {
        difficulty: practiceStartDifficulty,
        timerEnabled: practiceStartTimerEnabled,
        timerSeconds: clampPracticeTimerSeconds(practiceStartTimerSeconds)
      });
    }
    setShowPracticeStartPrompt(false);
    setPracticeStartPromptMode("start");
    setPracticeStartDifficulty(null);
    setPracticeStartTimerEnabled(false);
    setPracticeStartTimerSeconds(DEFAULT_PRACTICE_TIMER_SECONDS);
  };

  const handleCancelPracticeStart = () => {
    setShowPracticeStartPrompt(false);
    setPracticeStartPromptMode("start");
    setPracticeStartDifficulty(null);
    setPracticeStartTimerEnabled(false);
    setPracticeStartTimerSeconds(DEFAULT_PRACTICE_TIMER_SECONDS);
  };

  const handleOpenPracticeEditor = () => {
    setLobbyError(null);
    setEditorValidationMessageFromServer(null);
    setEditorShareStatus(null);
    setIsEditorShareValidationInFlight(false);
    setLobbyView("editor");
  };

  const handlePlayEditorPuzzle = () => {
    if (!editorPuzzleDraft.payload) return;
    setLobbyError(null);
    setEditorValidationMessageFromServer(null);
    socket.emit("practice:start", {
      difficulty: editorPuzzleDraft.payload.d,
      sharedPuzzle: editorPuzzleDraft.payload,
      timerEnabled: false
    });
  };

  const handleShareEditorPuzzle = async () => {
    if (!editorPuzzleDraft.payload) return;

    setLobbyError(null);
    setEditorValidationMessageFromServer(null);
    setIsEditorShareValidationInFlight(true);

    const validationResponse = await new Promise<PracticeValidateCustomResponse>((resolve) => {
      let isSettled = false;
      const timeoutId = window.setTimeout(() => {
        if (isSettled) return;
        isSettled = true;
        resolve({
          ok: false,
          message: "Validation timed out. Please try again."
        });
      }, CUSTOM_PUZZLE_VALIDATION_TIMEOUT_MS);

      socket.emit(
        "practice:validate-custom",
        { sharedPuzzle: editorPuzzleDraft.payload },
        (response: PracticeValidateCustomResponse) => {
          if (isSettled) return;
          isSettled = true;
          window.clearTimeout(timeoutId);
          if (!response || typeof response.ok !== "boolean") {
            resolve({
              ok: false,
              message: "Validation failed."
            });
            return;
          }
          resolve(response);
        }
      );
    });

    setIsEditorShareValidationInFlight(false);

    if (!validationResponse.ok) {
      setEditorValidationMessageFromServer(validationResponse.message ?? "Custom puzzle validation failed.");
      showEditorShareStatus("failed");
      return;
    }

    const token = encodePracticeSharePayload(editorPuzzleDraft.payload);
    const shareUrl = new URL(window.location.href);
    shareUrl.searchParams.set(PRACTICE_SHARE_QUERY_PARAM, token);

    try {
      await navigator.clipboard.writeText(shareUrl.toString());
      showEditorShareStatus("copied");
    } catch {
      setEditorValidationMessageFromServer("Could not copy link. Please try again.");
      showEditorShareStatus("failed");
    }
  };

  const handlePracticeSubmit = () => {
    if (!isInPractice || practiceState.phase !== "puzzle" || !practiceWord.trim()) return;
    setPracticeSubmitError(null);
    socket.emit("practice:submit", { word: practiceWord });
  };

  const handlePracticeSkip = () => {
    if (!isInPractice) return;
    socket.emit("practice:skip");
    setPracticeWord("");
    setPracticeSubmitError(null);
  };

  const handlePracticeNext = () => {
    if (!isInPractice || practiceState.phase !== "result") return;
    socket.emit("practice:next");
    setPracticeWord("");
    setPracticeSubmitError(null);
  };

  const handlePracticeExit = () => {
    socket.emit("practice:exit");
    setPracticeWord("");
    setPracticeSubmitError(null);
    setPendingResultAutoSubmit(null);
  };

  const handleSharePracticePuzzle = async () => {
    if (!practicePuzzle) return;

    const payload = buildPracticeSharePayload(practiceState.currentDifficulty, practicePuzzle);
    const token = encodePracticeSharePayload(payload);
    const shareUrl = new URL(window.location.href);
    shareUrl.searchParams.set(PRACTICE_SHARE_QUERY_PARAM, token);

    try {
      await navigator.clipboard.writeText(shareUrl.toString());
      showPracticeShareStatus("copied");
    } catch {
      showPracticeShareStatus("failed");
    }
  };

  const handleSharePracticeResult = async () => {
    if (!practicePuzzle || !practiceResult || practiceState.phase !== "result") return;
    if (practiceResult.timedOut || !practiceResult.submittedWordNormalized) return;

    try {
      const payload = buildPracticeResultSharePayload(
        practiceState.currentDifficulty,
        practicePuzzle,
        practiceResult.submittedWordNormalized,
        playerName
      );
      const token = encodePracticeResultSharePayload(payload);
      const shareUrl = new URL(window.location.href);
      shareUrl.searchParams.set(PRACTICE_RESULT_SHARE_QUERY_PARAM, token);
      await navigator.clipboard.writeText(shareUrl.toString());
      showPracticeResultShareStatus("copied");
    } catch {
      showPracticeResultShareStatus("failed");
    }
  };

  const handleCopyPrivateInviteUrl = async () => {
    if (!roomState || roomState.isPublic || !roomState.code) return;
    const inviteUrl = buildPrivateRoomInviteUrl(roomState.id, roomState.code);
    try {
      await navigator.clipboard.writeText(inviteUrl);
      showPrivateInviteCopyStatus("copied");
    } catch {
      showPrivateInviteCopyStatus("failed");
    }
  };

  const handleLeaveRoom = () => {
    if (!roomState) return;
    socket.emit("room:leave");
    setRoomState(null);
    setGameState(null);
    setIsReplayMode(false);
    setReplayStepIndex(0);
    setReplaySource(null);
    setImportReplayError(null);
    setReplayPuzzleError(null);
    setIsReplayAnalysisOpen(false);
    setReplayAnalysisByStepIndex({});
    setImportedReplayAnalysisByStepIndex({});
    setReplayAnalysisLoadingStepIndex(null);
    setReplayAnalysisError(null);
    setShowAllReplayOptionsByStep({});
    setGameLogEntries([]);
    setChatMessages([]);
    setChatDraft("");
    setQueuedTileClaimLetters("");
    clearClaimWordHighlights();
    previousGameStateRef.current = null;
    lastClaimFailureRef.current = null;
  };

  const handleOpenReplayImport = useCallback(() => {
    setImportReplayError(null);
    replayImportInputRef.current?.click();
  }, []);

  const handleReplayFileInputChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (file.size > MAX_REPLAY_IMPORT_FILE_BYTES) {
      setImportReplayError("File is too large.");
      return;
    }

    try {
      const fileText = await file.text();
      const parsed = parseReplayFile(fileText);
      if (!parsed.ok) {
        setImportReplayError(parsed.message);
        return;
      }

      setReplaySource({
        kind: "imported",
        file: parsed.file
      });
      setImportReplayError(null);
      setReplayPuzzleError(null);
      setIsReplayMode(true);
      setReplayStepIndex(0);
      setIsReplayAnalysisOpen(false);
      setImportedReplayAnalysisByStepIndex({});
      setReplayAnalysisLoadingStepIndex(null);
      setReplayAnalysisError(null);
      setShowAllReplayOptionsByStep({});
    } catch {
      setImportReplayError("Replay file is invalid or corrupted.");
    }
  }, []);

  const handleExportReplay = useCallback(() => {
    if (!roomReplay || roomState?.status !== "ended") return;

    const replayFile = buildReplayFileV1({
      replay: roomReplay,
      sourceRoomId: roomState.id,
      app: "anagram-thief-web"
    });
    const payload = serializeReplayFile(replayFile);
    const blob = new Blob([payload], { type: "application/json" });
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = buildReplayExportFilename(replayFile.exportedAt);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(downloadUrl);
  }, [roomReplay, roomState?.id, roomState?.status]);

  const handleViewReplayAsPuzzle = useCallback(async () => {
    if (!activeReplayState) return;

    const sharedPuzzle = buildPracticeSharePayloadFromReplayState(activeReplayState);
    setReplayPuzzleError(null);

    const validationResponse = await new Promise<PracticeValidateCustomResponse>((resolve) => {
      let isSettled = false;
      const timeoutId = window.setTimeout(() => {
        if (isSettled) return;
        isSettled = true;
        resolve({
          ok: false,
          message: "Validation timed out. Please try again."
        });
      }, CUSTOM_PUZZLE_VALIDATION_TIMEOUT_MS);

      socket.emit(
        "practice:validate-custom",
        { sharedPuzzle },
        (response: PracticeValidateCustomResponse) => {
          if (isSettled) return;
          isSettled = true;
          window.clearTimeout(timeoutId);
          if (!response || typeof response.ok !== "boolean") {
            resolve({
              ok: false,
              message: "Custom puzzle is invalid or has no valid plays."
            });
            return;
          }
          resolve(response);
        }
      );
    });

    if (!validationResponse.ok) {
      setReplayPuzzleError(validationResponse.message ?? "Custom puzzle is invalid or has no valid plays.");
      return;
    }

    setPendingSharedLaunch({
      kind: "puzzle",
      payload: sharedPuzzle
    });
    setReplayPuzzleError(null);
    setIsReplayMode(false);
    setReplaySource(null);
    setIsReplayAnalysisOpen(false);
    setReplayAnalysisError(null);
    setReplayAnalysisLoadingStepIndex(null);
    if (roomState) {
      handleLeaveRoom();
    }
  }, [activeReplayState, roomState, handleLeaveRoom]);

  const handleExitReplayView = useCallback(() => {
    setIsReplayMode(false);
    setReplayStepIndex(0);
    setReplaySource(null);
    setReplayPuzzleError(null);
    setIsReplayAnalysisOpen(false);
    setImportedReplayAnalysisByStepIndex({});
    setReplayAnalysisLoadingStepIndex(null);
    setReplayAnalysisError(null);
    setShowAllReplayOptionsByStep({});
  }, []);

  const fetchReplayAnalysisForStep = useCallback(
    (requestedStepIndex: number) => {
      if (!Number.isInteger(requestedStepIndex) || requestedStepIndex < 0) return;

      setReplayAnalysisError(null);
      setReplayAnalysisLoadingStepIndex(requestedStepIndex);

      let isSettled = false;
      const timeoutId = window.setTimeout(() => {
        if (isSettled) return;
        isSettled = true;
        setReplayAnalysisLoadingStepIndex((current) =>
          current === requestedStepIndex ? null : current
        );
        setReplayAnalysisError("Replay analysis timed out. Please try again.");
      }, REPLAY_ANALYSIS_TIMEOUT_MS);

      const handleResponse = (response: ReplayAnalysisResponse, source: "room" | "imported") => {
        if (isSettled) return;
        isSettled = true;
        window.clearTimeout(timeoutId);
        setReplayAnalysisLoadingStepIndex((current) =>
          current === requestedStepIndex ? null : current
        );

        if (!response || typeof response.ok !== "boolean") {
          setReplayAnalysisError("Replay analysis failed.");
          return;
        }

        if (!response.ok) {
          setReplayAnalysisError(response.message || "Replay analysis failed.");
          return;
        }

        if (source === "imported") {
          setImportedReplayAnalysisByStepIndex((current) => ({
            ...current,
            [response.result.requestedStepIndex]: response.result
          }));
        } else {
          setReplayAnalysisByStepIndex((current) => ({
            ...current,
            [response.result.requestedStepIndex]: response.result
          }));
        }
        setReplayAnalysisError(null);
      };

      if (replaySource?.kind === "imported") {
        socket.emit(
          "replay:analyze-imported-step",
          { replayFile: replaySource.file, stepIndex: requestedStepIndex },
          (response: ReplayAnalysisResponse) => handleResponse(response, "imported")
        );
        return;
      }

      if (!roomState || roomState.status !== "ended") {
        window.clearTimeout(timeoutId);
        setReplayAnalysisLoadingStepIndex((current) =>
          current === requestedStepIndex ? null : current
        );
        return;
      }

      socket.emit(
        "replay:analyze-step",
        { roomId: roomState.id, stepIndex: requestedStepIndex },
        (response: ReplayAnalysisResponse) => handleResponse(response, "room")
      );
    },
    [roomState, replaySource]
  );

  const handleEnterReplay = useCallback(() => {
    if (!roomReplay || roomReplaySteps.length === 0) return;
    setReplaySource({
      kind: "room",
      replay: roomReplay
    });
    setImportReplayError(null);
    setReplayPuzzleError(null);
    setReplayStepIndex(0);
    setIsReplayAnalysisOpen(false);
    setReplayAnalysisError(null);
    setReplayAnalysisLoadingStepIndex(null);
    setIsReplayMode(true);
  }, [roomReplay, roomReplaySteps.length]);

  const handleConfirmLeaveGame = () => {
    setShowLeaveGameConfirm(false);
    handleLeaveRoom();
  };

  const handleConfirmName = () => {
    const resolvedName = sanitizeClientName(nameDraft);
    setPlayerName(resolvedName);
    setNameDraft(resolvedName);
    setEditNameDraft(resolvedName);
    persistPlayerName(resolvedName);
    socket.emit("session:update-name", { name: resolvedName });
  };

  const roomId = roomState?.id ?? null;

  const handleOpenSettings = useCallback(() => {
    setEditNameDraft(playerName);
    setUserSettingsDraft(userSettings);
    setIsSettingsOpen(true);
  }, [playerName, userSettings]);

  const handleCloseSettings = useCallback(() => {
    setEditNameDraft(playerName);
    setUserSettingsDraft(userSettings);
    setIsSettingsOpen(false);
  }, [playerName, userSettings]);

  const handleSaveSettings = useCallback(() => {
    const resolvedName = sanitizeClientName(editNameDraft);
    setPlayerName(resolvedName);
    setNameDraft(resolvedName);
    setEditNameDraft(resolvedName);
    persistPlayerName(resolvedName);
    socket.emit("session:update-name", { name: resolvedName });
    if (roomId) {
      socket.emit("player:update-name", { name: resolvedName });
    }
    const normalizedSettings = userSettingsDraft.chatEnabled
      ? userSettingsDraft
      : { ...userSettingsDraft, bottomPanelMode: "log" as const };
    setUserSettings(normalizedSettings);
    persistUserSettings(normalizedSettings);
    setUserSettingsDraft(normalizedSettings);
    setIsSettingsOpen(false);
  }, [editNameDraft, roomId, userSettingsDraft]);

  const handleBottomPanelModeChange = useCallback((mode: "log" | "chat") => {
    if (mode === "chat" && !userSettings.chatEnabled) {
      return;
    }
    setUserSettings((current) => {
      if (current.bottomPanelMode === mode) {
        return current;
      }
      const next = { ...current, bottomPanelMode: mode };
      persistUserSettings(next);
      return next;
    });
    setUserSettingsDraft((current) => ({ ...current, bottomPanelMode: mode }));
  }, [userSettings.chatEnabled]);

  const handleChatSubmit = useCallback(() => {
    if (!roomId) return;
    if (isSpectator) return;
    if (!userSettings.chatEnabled) return;
    const text = chatDraft.trim();
    if (!text) return;
    socket.emit("chat:send", { roomId, text });
    setChatDraft("");
  }, [roomId, isSpectator, chatDraft, userSettings.chatEnabled]);

  const handleFlip = useCallback(() => {
    if (!roomId) return;
    if (isSpectator) return;
    if (isFlipRevealActive) return;
    if (claimWindow) return;
    socket.emit("game:flip", { roomId });
  }, [roomId, isSpectator, isFlipRevealActive, claimWindow]);

  const handleClaimIntent = useCallback(() => {
    if (!roomId) return;
    if (isSpectator) return;
    if (isFlipRevealActive) return;
    if (claimWindow || isClaimCooldownActive) return;
    claimInputRef.current?.focus();
    socket.emit("game:claim-intent", { roomId });
  }, [roomId, isSpectator, isFlipRevealActive, claimWindow, isClaimCooldownActive]);

  const handleClaimTileSelect = useCallback(
    (letter: string) => {
      if (!roomId) return;
      if (isSpectator) return;
      if (!isTileInputMethodEnabled) return;
      const normalizedLetter = normalizeEditorText(letter).slice(0, 1);
      if (!normalizedLetter) return;

      if (isMyClaimWindow) {
        setClaimWord((current) => `${current}${normalizedLetter}`);
        requestAnimationFrame(() => claimInputRef.current?.focus());
        return;
      }

      if (claimWindow || isClaimCooldownActive || isFlipRevealActive) return;
      setQueuedTileClaimLetters((current) => `${current}${normalizedLetter}`);
      handleClaimIntent();
    },
    [
      roomId,
      isSpectator,
      isTileInputMethodEnabled,
      isMyClaimWindow,
      claimWindow,
      isClaimCooldownActive,
      isFlipRevealActive,
      handleClaimIntent
    ]
  );

  const handleClaimUndoTap = useCallback(() => {
    if (isSpectator) return;
    if (!isTileInputMethodEnabled) return;

    if (isMyClaimWindow) {
      setClaimWord((current) => current.slice(0, -1));
      requestAnimationFrame(() => claimInputRef.current?.focus());
      return;
    }

    setQueuedTileClaimLetters((current) => current.slice(0, -1));
  }, [isSpectator, isTileInputMethodEnabled, isMyClaimWindow]);

  const handleClaimSubmit = useCallback(() => {
    if (!roomState) return;
    if (isSpectator) return;
    if (!isMyClaimWindow) return;
    if (!claimWord.trim()) return;
    socket.emit("game:claim", {
      roomId: roomState.id,
      word: claimWord
    });
    setClaimWord("");
    requestAnimationFrame(() => claimInputRef.current?.focus());
  }, [roomState, isSpectator, isMyClaimWindow, claimWord]);

  const handleAddPreStealEntry = useCallback(() => {
    if (isSpectator) return;
    if (!roomState || !gameState?.preStealEnabled) return;
    const triggerLetters = preStealTriggerInput.trim();
    const claimWord = preStealClaimWordInput.trim();
    if (!triggerLetters || !claimWord) return;

    socket.emit("game:pre-steal:add", {
      roomId: roomState.id,
      triggerLetters,
      claimWord
    });
    setPreStealTriggerInput("");
    setPreStealClaimWordInput("");
  }, [isSpectator, roomState, gameState?.preStealEnabled, preStealTriggerInput, preStealClaimWordInput]);

  const handleRemovePreStealEntry = useCallback(
    (entryId: string) => {
      if (isSpectator) return;
      if (!roomState || !gameState?.preStealEnabled) return;
      socket.emit("game:pre-steal:remove", {
        roomId: roomState.id,
        entryId
      });
    },
    [isSpectator, roomState, gameState?.preStealEnabled]
  );

  const handleReorderPreStealEntries = useCallback(
    (orderedEntryIds: string[]) => {
      if (isSpectator) return;
      if (!roomState || !gameState?.preStealEnabled) return;
      socket.emit("game:pre-steal:reorder", {
        roomId: roomState.id,
        orderedEntryIds
      });
    },
    [isSpectator, roomState, gameState?.preStealEnabled]
  );

  const handlePreStealEntryDrop = useCallback(
    (targetEntryId: string) => {
      if (isSpectator) return;
      if (!preStealDraggedEntryId) return;
      const nextEntries = reorderEntriesById(myPreStealEntries, preStealDraggedEntryId, targetEntryId);
      const nextOrder = nextEntries.map((entry) => entry.id);
      const currentOrder = myPreStealEntries.map((entry) => entry.id);
      if (nextOrder.join(",") !== currentOrder.join(",")) {
        handleReorderPreStealEntries(nextOrder);
      }
      setPreStealDraggedEntryId(null);
    },
    [isSpectator, preStealDraggedEntryId, myPreStealEntries, handleReorderPreStealEntries]
  );

  useEffect(() => {
    if (!isMyClaimWindow) {
      setClaimWord("");
      return;
    }
    requestAnimationFrame(() => claimInputRef.current?.focus());
  }, [isMyClaimWindow]);

  useEffect(() => {
    if (!isMyClaimWindow) return;
    if (!queuedTileClaimLetters) return;
    setClaimWord((current) => `${current}${queuedTileClaimLetters}`);
    setQueuedTileClaimLetters("");
    requestAnimationFrame(() => claimInputRef.current?.focus());
  }, [isMyClaimWindow, queuedTileClaimLetters]);

  useEffect(() => {
    if (isMyClaimWindow) return;
    if (!queuedTileClaimLetters) return;
    if (claimWindow || isClaimCooldownActive || isFlipRevealActive) {
      setQueuedTileClaimLetters("");
    }
  }, [
    isMyClaimWindow,
    queuedTileClaimLetters,
    claimWindow,
    isClaimCooldownActive,
    isFlipRevealActive
  ]);

  useEffect(() => {
    if (!isSettingsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      handleCloseSettings();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isSettingsOpen, handleCloseSettings]);

  useEffect(() => {
    if (!practiceState.active) {
      setPracticeWord("");
      setPracticeSubmitError(null);
      return;
    }
    if (practiceState.phase !== "puzzle") return;
    setPracticeWord("");
    setPracticeSubmitError(null);
    requestAnimationFrame(() => practiceInputRef.current?.focus());
  }, [practiceState.active, practiceState.phase, practiceState.puzzle?.id]);

  useEffect(() => {
    if (userSettings.chatEnabled) return;
    setChatMessages([]);
    setChatDraft("");
    if (userSettings.bottomPanelMode !== "log") {
      setUserSettings((current) => {
        if (current.bottomPanelMode === "log") return current;
        const next = { ...current, bottomPanelMode: "log" as const };
        persistUserSettings(next);
        return next;
      });
      setUserSettingsDraft((current) => ({ ...current, bottomPanelMode: "log" }));
    }
  }, [userSettings.chatEnabled, userSettings.bottomPanelMode]);

  useEffect(() => {
    setShowAllPracticeOptions(false);
  }, [practiceState.puzzle?.id, practiceResult?.submittedWordNormalized, practiceResult?.score]);

  useEffect(() => {
    setPracticeShareStatus(null);
  }, [practiceState.puzzle?.id]);

  useEffect(() => {
    setPracticeResultShareStatus(null);
  }, [practiceState.puzzle?.id, practiceResult?.submittedWordNormalized]);

  useEffect(() => {
    setEditorValidationMessageFromServer(null);
    setEditorShareStatus(null);
  }, [editorCenterInput, editorExistingWordsInput, editorDifficulty]);

  useEffect(() => {
    if (!pendingSharedLaunch) return;
    if (!isConnected) return;
    if (roomState) return;

    setLobbyError(null);
    if (pendingSharedLaunch.kind === "result") {
      setPendingResultAutoSubmit({
        submittedWord: pendingSharedLaunch.submittedWord,
        expectedPuzzleFingerprint: pendingSharedLaunch.expectedPuzzleFingerprint,
        expiresAt: Date.now() + PENDING_RESULT_AUTO_SUBMIT_TTL_MS
      });
    } else {
      setPendingResultAutoSubmit(null);
    }
    socket.emit("practice:start", {
      sharedPuzzle: pendingSharedLaunch.payload,
      timerEnabled: false
    });
    setPendingSharedLaunch(null);
    removePracticeShareFromUrl();
  }, [pendingSharedLaunch, isConnected, roomState]);

  useEffect(() => {
    if (!pendingPrivateRoomJoin) return;
    if (!isConnected) return;
    if (!playerName.trim()) return;
    if (roomState) return;
    if (practiceState.active) return;
    if (pendingSharedLaunch) return;

    setLobbyError(null);
    socket.emit("room:join", {
      roomId: pendingPrivateRoomJoin.roomId,
      name: playerName,
      code: pendingPrivateRoomJoin.code
    });
    setPendingPrivateRoomJoin(null);
    removePrivateRoomJoinFromUrl();
  }, [
    pendingPrivateRoomJoin,
    isConnected,
    playerName,
    roomState,
    practiceState.active,
    pendingSharedLaunch
  ]);

  useEffect(() => {
    if (!pendingResultAutoSubmit) return;
    if (pendingResultAutoSubmit.expiresAt <= now) {
      setPendingResultAutoSubmit(null);
      return;
    }
    if (!isConnected) return;
    if (roomState) return;
    if (!practiceState.active || practiceState.phase !== "puzzle") return;

    const puzzleFingerprint = buildPracticePuzzleFingerprintFromState(practiceState.puzzle);
    if (!puzzleFingerprint) return;
    if (puzzleFingerprint !== pendingResultAutoSubmit.expectedPuzzleFingerprint) return;

    setLobbyError(null);
    setPracticeSubmitError(null);
    socket.emit("practice:submit", { word: pendingResultAutoSubmit.submittedWord });
    setPendingResultAutoSubmit(null);
  }, [
    pendingResultAutoSubmit,
    now,
    isConnected,
    roomState,
    practiceState.active,
    practiceState.phase,
    practiceState.puzzle
  ]);

  useEffect(() => {
    if (roomState) {
      setPendingPrivateRoomJoin(null);
      removePrivateRoomJoinFromUrl();
      setLobbyError(null);
      setPendingResultAutoSubmit(null);
      setReplaySource((current) => (current?.kind === "imported" ? null : current));
      setImportReplayError(null);
      return;
    }
    setLobbyView("list");
  }, [roomState]);

  useEffect(() => {
    if (roomState || replaySource?.kind === "imported") return;
    setQueuedTileClaimLetters("");
    setPreStealTriggerInput("");
    setPreStealClaimWordInput("");
    setPreStealDraggedEntryId(null);
    setIsReplayMode(false);
    setReplayStepIndex(0);
    setIsReplayAnalysisOpen(false);
    setReplayAnalysisByStepIndex({});
    setReplayAnalysisLoadingStepIndex(null);
    setReplayAnalysisError(null);
    setShowAllReplayOptionsByStep({});
  }, [roomState, replaySource?.kind]);

  useEffect(() => {
    if (!isReplayMode) return;
    if (replaySource) return;
    if (roomState?.status !== "ended" || !roomReplay) return;
    setReplaySource({
      kind: "room",
      replay: roomReplay
    });
  }, [isReplayMode, replaySource, roomState?.status, roomReplay]);

  useEffect(() => {
    if (replaySource?.kind !== "room") return;
    if (!roomReplay) return;
    setReplaySource((current) => {
      if (!current || current.kind !== "room") return current;
      if (current.replay === roomReplay) return current;
      return {
        kind: "room",
        replay: roomReplay
      };
    });
  }, [replaySource?.kind, roomReplay]);

  useEffect(() => {
    setReplayStepIndex((current) => Math.min(Math.max(current, 0), maxReplayStepIndex));
  }, [maxReplayStepIndex]);

  useEffect(() => {
    if (replaySource?.kind === "imported") {
      if (replaySteps.length === 0) {
        setIsReplayMode(false);
        setReplayStepIndex(0);
        setReplaySource(null);
        setIsReplayAnalysisOpen(false);
        setReplayAnalysisLoadingStepIndex(null);
        setReplayAnalysisError(null);
      }
      return;
    }
    if (!roomState || roomState.status !== "ended") {
      setIsReplayMode(false);
      setReplayStepIndex(0);
      setReplaySource(null);
      setIsReplayAnalysisOpen(false);
      setReplayAnalysisLoadingStepIndex(null);
      setReplayAnalysisError(null);
      return;
    }
    if (replaySteps.length === 0) {
      setIsReplayMode(false);
      setReplayStepIndex(0);
      setReplaySource(null);
      setIsReplayAnalysisOpen(false);
      setReplayAnalysisLoadingStepIndex(null);
      setReplayAnalysisError(null);
    }
  }, [roomState, replaySource?.kind, replaySteps.length]);

  useEffect(() => {
    setReplayAnalysisError(null);
    setReplayPuzzleError(null);
  }, [activeReplayRequestedStepIndex]);

  useEffect(() => {
    if (!isReplayMode || !isReplayAnalysisOpen) return;
    if (!activeReplayStep) return;
    const requestedStepIndex = activeReplayStep.index;
    if (replaySource?.kind === "imported") {
      const importedCached =
        importedReplayAnalysisByStepIndex[requestedStepIndex] ??
        getImportedReplayAnalysis(replaySource.file, requestedStepIndex);
      if (importedCached) return;
    } else if (replayAnalysisByStepIndex[requestedStepIndex]) {
      return;
    }
    if (replayAnalysisLoadingStepIndex === requestedStepIndex) return;
    fetchReplayAnalysisForStep(requestedStepIndex);
  }, [
    isReplayMode,
    isReplayAnalysisOpen,
    replaySource?.kind,
    replaySource,
    roomState,
    activeReplayStep,
    importedReplayAnalysisByStepIndex,
    replayAnalysisByStepIndex,
    replayAnalysisLoadingStepIndex,
    fetchReplayAnalysisForStep
  ]);

  useEffect(() => {
    if (!practiceState.active) return;
    setLobbyView("list");
    setLobbyError(null);
  }, [practiceState.active]);

  useEffect(() => {
    if (!practiceState.active) return;
    setShowPracticeStartPrompt(false);
    setPracticeStartPromptMode("start");
    setPracticeStartDifficulty(null);
    setPracticeStartTimerEnabled(false);
    setPracticeStartTimerSeconds(DEFAULT_PRACTICE_TIMER_SECONDS);
  }, [practiceState.active]);

  useEffect(() => {
    if (isInGame) return;
    setShowLeaveGameConfirm(false);
  }, [isInGame]);

  useEffect(() => {
    if (!isInGame || isSpectator) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat) return;
      const target = event.target as HTMLElement | null;
      const isEditableTarget =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (isEditableTarget) return;
      const isSpace = event.code === "Space" || event.key === " " || event.key === "Spacebar";
      if (isSpace) {
        if (isFlipRevealActive) return;
        if (claimWindow) return;
        if (gameState?.turnPlayerId !== selfPlayerId) return;
        event.preventDefault();
        handleFlip();
        return;
      }

      if (event.key === "Enter" && !isEditableTarget) {
        if (isMyClaimWindow) {
          claimInputRef.current?.focus();
          return;
        }
        if (claimWindow || isClaimCooldownActive) {
          return;
        }
        if (isFlipRevealActive) {
          return;
        }
        event.preventDefault();
        handleClaimIntent();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    handleFlip,
    handleClaimIntent,
    isInGame,
    isSpectator,
    gameState?.turnPlayerId,
    selfPlayerId,
    isMyClaimWindow,
    claimWindow,
    isClaimCooldownActive,
    isFlipRevealActive
  ]);

  useEffect(() => {
    const roomId = roomState?.id ?? null;
    const previousRoomId = previousRoomIdRef.current;
    const shouldReset =
      !roomId ||
      roomState?.status === "lobby" ||
      (previousRoomId !== null && previousRoomId !== roomId);

    if (shouldReset) {
      setGameLogEntries([]);
      setChatMessages([]);
      setChatDraft("");
      clearClaimWordHighlights();
      previousGameStateRef.current = null;
      lastClaimFailureRef.current = null;
    }

    previousRoomIdRef.current = roomId;
  }, [clearClaimWordHighlights, roomState?.id, roomState?.status]);

  useEffect(() => {
    if (isBottomPanelChatMode) return;
    if (!shouldShowGameLog) return;
    const logListElement = gameLogListRef.current;
    if (!logListElement) return;
    logListElement.scrollTop = logListElement.scrollHeight;
  }, [gameLogEntries.length, isBottomPanelChatMode, shouldShowGameLog]);

  useEffect(() => {
    if (!isBottomPanelChatMode) return;
    if (!shouldShowGameLog) return;
    const chatListElement = chatListRef.current;
    if (!chatListElement) return;
    chatListElement.scrollTop = chatListElement.scrollHeight;
  }, [chatMessages.length, isBottomPanelChatMode, shouldShowGameLog]);

  useEffect(() => {
    if (!gameState || !roomState || (roomState.status !== "in-game" && roomState.status !== "ended")) {
      previousGameStateRef.current = null;
      return;
    }

    const previousState = previousGameStateRef.current;
    const pendingEntries: PendingGameLogEntry[] = [];

    if (!previousState) {
      if (roomState.status === "in-game") {
        pendingEntries.push({ text: "Game started.", kind: "event" });
      }
      previousGameStateRef.current = gameState;
      appendGameLogEntries(pendingEntries);
      return;
    }

    const previousCenterTileIds = new Set(previousState.centerTiles.map((tile) => tile.id));
    const addedTiles = gameState.centerTiles.filter((tile) => !previousCenterTileIds.has(tile.id));
    if (addedTiles.length > 0 && gameState.bagCount < previousState.bagCount) {
      const flipperId = previousState.pendingFlip?.playerId ?? previousState.turnPlayerId;
      const flipperName = getPlayerName(previousState.players, flipperId);
      for (const tile of addedTiles) {
        pendingEntries.push({ text: `${flipperName} flipped ${tile.letter}.`, kind: "event" });
      }
    }

    if (!previousState.claimWindow && gameState.claimWindow) {
      const claimantName = getPlayerName(gameState.players, gameState.claimWindow.playerId);
      pendingEntries.push({
        text: `${claimantName} started a claim window (${roomState.claimTimer.seconds}s).`,
        kind: "event"
      });
    }

    const previousWords = getWordSnapshots(previousState.players);
    const currentWords = getWordSnapshots(gameState.players);
    const previousWordMap = new Map(previousWords.map((word) => [word.id, word]));
    const removedWords = previousWords.filter(
      (word) => !currentWords.some((currentWord) => currentWord.id === word.id)
    );
    const addedWords = currentWords
      .filter((word) => !previousWordMap.has(word.id))
      .sort((a, b) => a.createdAt - b.createdAt);

    for (const addedWord of addedWords) {
      const claimantName = getPlayerName(gameState.players, addedWord.ownerId);
      const replacedWord = findReplacedWord(addedWord, removedWords);
      if (!replacedWord) {
        markClaimedWordForAnimation(addedWord.id, "claim");
        pendingEntries.push({
          text: appendPreStealLogContext(`${claimantName} claimed ${addedWord.text}.`, gameState, addedWord.id),
          kind: "event"
        });
        continue;
      }

      const removedWordIndex = removedWords.findIndex((word) => word.id === replacedWord.id);
      if (removedWordIndex !== -1) {
        removedWords.splice(removedWordIndex, 1);
      }

      if (replacedWord.ownerId === addedWord.ownerId) {
        markClaimedWordForAnimation(addedWord.id, "claim");
        pendingEntries.push({
          text: appendPreStealLogContext(
            `${claimantName} extended ${replacedWord.text} to ${addedWord.text}.`,
            gameState,
            addedWord.id
          ),
          kind: "event"
        });
      } else {
        markClaimedWordForAnimation(addedWord.id, "steal");
        const stolenFromName = getPlayerName(gameState.players, replacedWord.ownerId);
        pendingEntries.push({
          text: appendPreStealLogContext(
            `${claimantName} stole ${replacedWord.text} from ${stolenFromName} with ${addedWord.text}.`,
            gameState,
            addedWord.id
          ),
          kind: "event"
        });
      }
    }

    const previousCooldowns = previousState.claimCooldowns;
    const currentCooldowns = gameState.claimCooldowns;
    const startedCooldownPlayerIds = Object.keys(currentCooldowns).filter((playerId) => {
      const previousEndsAt = previousCooldowns[playerId];
      const currentEndsAt = currentCooldowns[playerId];
      return typeof currentEndsAt === "number" && previousEndsAt !== currentEndsAt;
    });
    const endedCooldownPlayerIds = Object.keys(previousCooldowns).filter(
      (playerId) => !(playerId in currentCooldowns)
    );

    const previousClaimWindow = previousState.claimWindow;
    let isClaimWindowExpired = false;
    if (previousClaimWindow && !gameState.claimWindow) {
      isClaimWindowExpired =
        previousClaimWindow.endsAt <= Date.now() &&
        previousClaimWindow.playerId in currentCooldowns;
    }
    if (isClaimWindowExpired && previousClaimWindow) {
      const claimantName = getPlayerName(gameState.players, previousClaimWindow.playerId);
      pendingEntries.push({ text: `${claimantName}'s claim window expired.`, kind: "event" });
    }

    for (const playerId of startedCooldownPlayerIds) {
      if (playerId === selfPlayerId && lastClaimFailureRef.current) {
        const elapsed = Date.now() - lastClaimFailureRef.current.at;
        if (elapsed <= CLAIM_FAILURE_WINDOW_MS) {
          pendingEntries.push({
            text: `You failed claim: ${lastClaimFailureRef.current.message} You are on cooldown.`,
            kind: "error"
          });
          lastClaimFailureRef.current = null;
          continue;
        }
      }

      const cooldownPlayerName = getPlayerName(gameState.players, playerId);
      pendingEntries.push({ text: `${cooldownPlayerName} is on cooldown.`, kind: "event" });
    }

    for (const playerId of endedCooldownPlayerIds) {
      const cooldownPlayerName = getPlayerName(gameState.players, playerId);
      pendingEntries.push({ text: `${cooldownPlayerName} is off cooldown.`, kind: "event" });
    }

    if (previousState.bagCount > 0 && gameState.bagCount === 0 && gameState.endTimerEndsAt) {
      pendingEntries.push({
        text: "Bag is empty. Final countdown started (60s).",
        kind: "event"
      });
    }

    if (previousState.status !== "ended" && gameState.status === "ended") {
      pendingEntries.push({ text: "Game ended.", kind: "event" });
    }

    previousGameStateRef.current = gameState;
    appendGameLogEntries(pendingEntries);
  }, [
    appendGameLogEntries,
    gameState,
    markClaimedWordForAnimation,
    roomState,
    selfPlayerId
  ]);

  const replayBackButtonLabel = roomState?.status === "ended" ? "Back to final scores" : "Close replay";
  const replayPanelContent =
    isReplayMode && activeReplayState ? (
      <ReplayPanelView
        model={{
          replayBackButtonLabel,
          roomState,
          canExportReplay,
          clampedReplayStepIndex,
          replayStepsLength: replaySteps.length,
          maxReplayStepIndex,
          isReplayAnalysisOpen,
          replayPuzzleError,
          importReplayError,
          activeReplayActionText,
          replayTurnPlayerName,
          activeReplayState,
          orderedReplayPlayers,
          replayPreStealPlayers,
          activeReplayAnalysis,
          isActiveReplayAnalysisLoading,
          replayAnalysisError,
          visibleReplayAnalysisOptions,
          activeReplayClaimedWords,
          hiddenReplayAnalysisOptionCount,
          showAllReplayOptionsByStep
        }}
        actions={{
          onExitReplayView: handleExitReplayView,
          onLeaveRoom: handleLeaveRoom,
          onOpenReplayImport: handleOpenReplayImport,
          onViewReplayAsPuzzle: handleViewReplayAsPuzzle,
          onExportReplay: handleExportReplay,
          onReplayStepIndexChange: setReplayStepIndex,
          onReplayAnalysisOpenChange: setIsReplayAnalysisOpen,
          onShowAllReplayOptionsByStepChange: setShowAllReplayOptionsByStep
        }}
      />
    ) : null;

  if (!playerName) {
    return (
      <NameGateView
        nameDraft={nameDraft}
        setNameDraft={setNameDraft}
        onConfirmName={handleConfirmName}
      />
    );
  }

  const pageClassName = shouldShowGameLog ? "page has-game-log" : "page";

  return (
    <UserSettingsContext.Provider value={userSettingsContextValue}>
      <div className={pageClassName}>
        <input
          ref={replayImportInputRef}
          type="file"
          accept={REPLAY_FILE_INPUT_ACCEPT}
          onChange={handleReplayFileInputChange}
          className="hidden-file-input"
        />
        <header className="header">
          <div>
            <h1>Anagram Thief</h1>
          </div>
          <div className="status">
            <div className="status-identity">
              <span className="status-name">{playerName}</span>
              <button className="icon-button" onClick={handleOpenSettings} aria-label="Open settings">
                ⚙
              </button>
            </div>
            <div className="status-connection">
              <span className={isConnected ? "dot online" : "dot"} />
              {isConnected ? "Connected" : "Connecting"}
            </div>
          </div>
        </header>

        <div className={`disconnect-banner${!isConnected ? " visible" : ""}`}>
          <span className="dot" /> Connection lost — reconnecting…
        </div>

      {!roomState && !practiceState.active && !isReplayMode && lobbyView === "list" && (
        <LobbyListView
          openLobbyRooms={openLobbyRooms}
          inProgressLobbyRooms={inProgressLobbyRooms}
          lobbyError={lobbyError}
          importReplayError={importReplayError}
          onJoinRoom={handleJoinRoom}
          onSpectateRoom={handleSpectateRoom}
          onCreateNewGame={() => setLobbyView("create")}
          onStartPractice={handleStartPractice}
          onOpenPracticeEditor={handleOpenPracticeEditor}
          onOpenReplayImport={handleOpenReplayImport}
        />
      )}

      {!roomState && !practiceState.active && !isReplayMode && lobbyView === "create" && (
        <LobbyCreateView
          model={{
            roomName: createRoomName,
            isPublic: createPublic,
            maxPlayers: createMaxPlayers,
            flipTimerEnabled: createFlipTimerEnabled,
            flipTimerSeconds: createFlipTimerSeconds,
            claimTimerSeconds: createClaimTimerSeconds,
            preStealEnabled: createPreStealEnabled
          }}
          limits={{
            minFlipTimerSeconds: MIN_FLIP_TIMER_SECONDS,
            maxFlipTimerSeconds: MAX_FLIP_TIMER_SECONDS,
            minClaimTimerSeconds: MIN_CLAIM_TIMER_SECONDS,
            maxClaimTimerSeconds: MAX_CLAIM_TIMER_SECONDS,
            clampFlipTimerSeconds,
            clampClaimTimerSeconds
          }}
          actions={{
            onRoomNameChange: setCreateRoomName,
            onPublicChange: setCreatePublic,
            onMaxPlayersChange: setCreateMaxPlayers,
            onFlipTimerEnabledChange: setCreateFlipTimerEnabled,
            onFlipTimerSecondsChange: setCreateFlipTimerSeconds,
            onClaimTimerSecondsChange: setCreateClaimTimerSeconds,
            onPreStealEnabledChange: setCreatePreStealEnabled,
            onBackToGames: () => setLobbyView("list"),
            onCreate: handleCreate
          }}
        />
      )}

      {!roomState && !practiceState.active && !isReplayMode && lobbyView === "editor" && (
        <PracticeEditorView
          model={{
            difficulty: editorDifficulty,
            centerInput: editorCenterInput,
            existingWordsInput: editorExistingWordsInput,
            puzzleDraft: editorPuzzleDraft,
            totalCharacters: editorTotalCharacters,
            validationMessage: editorValidationMessage,
            lobbyError,
            isPuzzleReady: isEditorPuzzleReady,
            isShareValidationInFlight: isEditorShareValidationInFlight,
            shareStatus: editorShareStatus
          }}
          limits={{
            customPuzzleCenterLetterMax: CUSTOM_PUZZLE_CENTER_LETTER_MAX,
            customPuzzleExistingWordCountMax: CUSTOM_PUZZLE_EXISTING_WORD_COUNT_MAX,
            customPuzzleTotalCharactersMax: CUSTOM_PUZZLE_TOTAL_CHARACTERS_MAX
          }}
          actions={{
            onDifficultyChange: setEditorDifficulty,
            onCenterInputChange: setEditorCenterInput,
            onExistingWordsInputChange: setEditorExistingWordsInput,
            onBackToLobby: () => {
              setLobbyError(null);
              setEditorValidationMessageFromServer(null);
              setEditorShareStatus(null);
              setIsEditorShareValidationInFlight(false);
              setLobbyView("list");
            },
            onPlayPuzzle: handlePlayEditorPuzzle,
            onSharePuzzle: handleShareEditorPuzzle
          }}
        />
      )}

      {isInPractice && (
        <PracticeView
          model={{
            practiceState,
            practicePuzzle,
            practiceResult,
            practiceShareStatus,
            practiceResultShareStatus,
            practiceTimerRemainingSeconds,
            isPracticeTimerWarning,
            practiceTimerProgress,
            practiceWord,
            practiceSubmitError,
            practiceResultCategory,
            visiblePracticeOptions,
            hiddenPracticeOptionCount,
            showAllPracticeOptions
          }}
          actions={{
            onSharePracticePuzzle: handleSharePracticePuzzle,
            onSharePracticeResult: handleSharePracticeResult,
            onOpenPracticeDifficultyPicker: handleOpenPracticeDifficultyPicker,
            onPracticeNext: handlePracticeNext,
            onPracticeExit: handlePracticeExit,
            onPracticeWordChange: setPracticeWord,
            onPracticeSubmitErrorChange: setPracticeSubmitError,
            onPracticeSubmit: handlePracticeSubmit,
            onPracticeSkip: handlePracticeSkip,
            onShowAllPracticeOptionsChange: setShowAllPracticeOptions
          }}
          refs={{ practiceInputRef }}
        />
      )}

      {roomState && roomState.status === "lobby" && (
        <div className="grid">
          <section className="panel">
            <h2>Waiting for players</h2>
            <p className="muted compact">Claim timer: {roomState.claimTimer.seconds}s</p>
            <p className="muted compact">Pre-steal: {roomState.preSteal.enabled ? "on" : "off"}</p>
            <p className="muted compact">
              Flip timer: {roomState.flipTimer.enabled ? `${roomState.flipTimer.seconds}s` : "off"}
            </p>
            {!roomState.isPublic && roomState.code && <p className="muted">Code: {roomState.code}</p>}
            {!roomState.isPublic && roomState.code && isHost && (
              <div className="button-row">
                <button className="button-secondary" type="button" onClick={handleCopyPrivateInviteUrl}>
                  {privateInviteCopyStatus === "copied"
                    ? "Copied!"
                    : privateInviteCopyStatus === "failed"
                      ? "Copy failed"
                      : "Copy invite URL"}
                </button>
              </div>
            )}
            <div className="player-list">
              {currentPlayers.map((player) => (
                <div key={player.id} className={player.id === selfPlayerId ? "player you" : "player"}>
                  <span>{player.name}</span>
                  {!player.connected && <span className="badge">offline</span>}
                  {player.id === roomState.hostId && <span className="badge">host</span>}
                </div>
              ))}
            </div>
            <div className="button-row">
              <button className="button-secondary" onClick={handleLeaveRoom}>
                Back to lobby
              </button>
              {isHost && <button onClick={handleStart}>Start Game</button>}
            </div>
          </section>

          <HowToPlay preStealEnabled={roomState.preSteal.enabled} />
        </div>
      )}

      {isInGame && gameState && roomState && (
        <GameView
          model={{
            roomState,
            gameState,
            selfPlayerId,
            isSpectator,
            endTimerRemaining,
            formatTime,
            isFlipRevealActive,
            isTileSelectionEnabled,
            pendingFlip,
            flipRevealDurationMs,
            flipRevealElapsedMs,
            flipRevealPlayerName,
            claimWindow,
            claimProgress,
            claimWord,
            isMyClaimWindow,
            claimPlaceholder,
            isClaimInputDisabled,
            isClaimButtonDisabled,
            claimButtonLabel,
            shouldShowClaimUndoButton,
            isClaimUndoButtonDisabled,
            orderedGamePlayers,
            claimedWordHighlights,
            spectatorPreStealPlayers,
            preStealTriggerInput,
            preStealClaimWordInput,
            myPreStealEntries,
            preStealDraggedEntryId
          }}
          actions={{
            onFlip: handleFlip,
            onClaimTileSelect: handleClaimTileSelect,
            onClaimSubmit: handleClaimSubmit,
            onClaimIntent: handleClaimIntent,
            onClaimWordChange: setClaimWord,
            onClaimUndoTap: handleClaimUndoTap,
            onOpenLeaveGameConfirm: () => setShowLeaveGameConfirm(true),
            onPreStealTriggerInputChange: setPreStealTriggerInput,
            onPreStealClaimWordInputChange: setPreStealClaimWordInput,
            onAddPreStealEntry: handleAddPreStealEntry,
            onPreStealDraggedEntryIdChange: setPreStealDraggedEntryId,
            onPreStealEntryDrop: handlePreStealEntryDrop,
            onRemovePreStealEntry: handleRemovePreStealEntry
          }}
          refs={{ claimInputRef }}
        />
      )}

      {roomState?.status === "ended" && gameState && (
        <EndedGameView
          isReplayMode={isReplayMode}
          gameOverStandings={gameOverStandings}
          roomReplayStepsLength={roomReplaySteps.length}
          onLeaveRoom={handleLeaveRoom}
          onEnterReplay={handleEnterReplay}
          replayPanelContent={replayPanelContent}
        />
      )}

      {!roomState && replaySource?.kind === "imported" && replayPanelContent && (
        <div className="panel">
          {replayPanelContent}
        </div>
      )}

      {shouldShowGameLog && (
        <section className="game-log">
          <div className="game-log-controls">
            <button
              type="button"
              className={`game-log-mode-button ${!isBottomPanelChatMode ? "active" : ""}`}
              onClick={() => handleBottomPanelModeChange("log")}
            >
              Game Log
            </button>
            {isBottomPanelChatEnabled && (
              <button
                type="button"
                className={`game-log-mode-button ${isBottomPanelChatMode ? "active" : ""}`}
                onClick={() => handleBottomPanelModeChange("chat")}
              >
                Chat
              </button>
            )}
          </div>
          <div className="game-log-body">
            {!isBottomPanelChatMode && (
              <div ref={gameLogListRef} className="game-log-list">
                {gameLogEntries.length === 0 && (
                  <div className="game-log-empty muted">No gameplay events yet.</div>
                )}
                {gameLogEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className={`game-log-row ${entry.kind === "error" ? "error" : ""}`}
                  >
                    <span className="game-log-time">{formatLogTime(entry.timestamp)}</span>
                    <span className="game-log-text">{entry.text}</span>
                  </div>
                ))}
              </div>
            )}
            {isBottomPanelChatMode && (
              <>
                <div ref={chatListRef} className="game-log-list">
                  {chatMessages.length === 0 && (
                    <div className="game-log-empty muted">No chat messages yet.</div>
                  )}
                  {chatMessages.map((message) => (
                    <div key={message.id} className="chat-log-row">
                      <span className="game-log-time">{formatLogTime(message.timestamp)}</span>
                      <span className="chat-log-message">
                        <span className="chat-log-sender">{message.senderName}:</span> {message.text}
                      </span>
                    </div>
                  ))}
                </div>
                <form
                  className="chat-composer"
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleChatSubmit();
                  }}
                >
                  <input
                    value={chatDraft}
                    onChange={(event) => setChatDraft(event.target.value)}
                    placeholder={isSpectator ? "Spectators can read chat only." : "Type a message..."}
                    maxLength={MAX_CHAT_MESSAGE_LENGTH}
                    disabled={isSpectator}
                  />
                  <button type="submit" disabled={isSpectator || !chatDraft.trim()}>
                    Send
                  </button>
              </form>
            </>
          )}
          </div>
        </section>
      )}

      {showPracticeStartPrompt && !roomState && (
        <PracticeStartModal
          model={{
            title: practiceStartPromptMode === "difficulty" ? "Change Difficulty" : "Start Practice Mode",
            confirmLabel: practiceStartPromptMode === "difficulty" ? "Apply difficulty" : "Start practice",
            showTimerSettings: practiceStartPromptMode !== "difficulty",
            difficulty: practiceStartDifficulty,
            timerEnabled: practiceStartTimerEnabled,
            timerSeconds: practiceStartTimerSeconds
          }}
          limits={{
            minPracticeTimerSeconds: MIN_PRACTICE_TIMER_SECONDS,
            maxPracticeTimerSeconds: MAX_PRACTICE_TIMER_SECONDS,
            clampPracticeTimerSeconds
          }}
          actions={{
            onDifficultyChange: setPracticeStartDifficulty,
            onTimerEnabledChange: setPracticeStartTimerEnabled,
            onTimerSecondsChange: setPracticeStartTimerSeconds,
            onCancel: handleCancelPracticeStart,
            onConfirm: handleConfirmPracticeStart
          }}
        />
      )}

      {isSettingsOpen && (
        <SettingsModal
          model={{
            editNameDraft,
            userSettingsDraft
          }}
          actions={{
            onEditNameDraftChange: setEditNameDraft,
            onUserSettingsDraftChange: setUserSettingsDraft,
            onClose: handleCloseSettings,
            onSave: handleSaveSettings
          }}
        />
      )}

      {showLeaveGameConfirm && (
        <LeaveGameModal
          onStay={() => setShowLeaveGameConfirm(false)}
          onLeave={handleConfirmLeaveGame}
        />
      )}
      </div>
    </UserSettingsContext.Provider>
  );
}
