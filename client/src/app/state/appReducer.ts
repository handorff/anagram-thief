import { createInactivePracticeState } from "../practice/practiceUtils";
import type { AppAction } from "./actions";
import { applyUpdater } from "./actions";
import type { AppState, InitialAppStateOptions } from "./types";

export function createInitialAppState(options: InitialAppStateOptions): AppState {
  return {
    connection: {
      isConnected: options.isConnected,
      selfPlayerId: null
    },
    server: {
      roomList: [],
      roomState: null,
      gameState: null,
      practiceState: options.practiceState
    },
    identity: {
      playerName: options.playerName,
      nameDraft: options.playerName,
      editNameDraft: ""
    },
    settings: {
      isSettingsOpen: false,
      userSettings: options.userSettings,
      userSettingsDraft: options.userSettings
    },
    lobby: {
      view: "list",
      error: null,
      createRoomForm: {
        roomName: "",
        isPublic: true,
        maxPlayers: 8,
        flipTimerEnabled: false,
        flipTimerSeconds: options.defaultFlipTimerSeconds,
        claimTimerSeconds: options.defaultClaimTimerSeconds,
        preStealEnabled: true
      },
      practiceStartPrompt: {
        isOpen: false,
        mode: "start",
        difficulty: null,
        timerEnabled: false,
        timerSeconds: options.defaultPracticeTimerSeconds
      },
      editorForm: {
        difficulty: options.defaultPracticeDifficulty,
        centerInput: "",
        existingWordsInput: "",
        validationMessageFromServer: null,
        shareStatus: null,
        isShareValidationInFlight: false
      }
    },
    practiceUi: {
      practiceWord: "",
      submitError: null,
      shareStatus: null,
      resultShareStatus: null,
      showAllOptions: false,
      pendingSharedLaunch: options.pendingSharedLaunch,
      pendingResultAutoSubmit: null
    },
    gameUi: {
      claimWord: "",
      queuedTileClaimLetters: "",
      preStealTriggerInput: "",
      preStealClaimWordInput: "",
      preStealDraggedEntryId: null,
      showLeaveGameConfirm: false,
      gameLogEntries: [],
      chatMessages: [],
      chatDraft: "",
      claimedWordHighlights: {}
    },
    replayUi: {
      isReplayMode: false,
      replayStepIndex: 0,
      replaySource: null,
      importReplayError: null,
      replayPuzzleError: null,
      isReplayAnalysisOpen: false,
      analysisByStepIndex: {},
      importedAnalysisByStepIndex: {},
      analysisLoadingStepIndex: null,
      analysisError: null,
      showAllOptionsByStep: {}
    },
    clock: {
      now: Date.now()
    },
    pendingPrivateRoomJoin: options.pendingPrivateRoomJoin,
    privateInviteCopyStatus: null
  };
}

function resetReplayState(state: AppState): AppState {
  return {
    ...state,
    replayUi: {
      isReplayMode: false,
      replayStepIndex: 0,
      replaySource: null,
      importReplayError: null,
      replayPuzzleError: null,
      isReplayAnalysisOpen: false,
      analysisByStepIndex: {},
      importedAnalysisByStepIndex: {},
      analysisLoadingStepIndex: null,
      analysisError: null,
      showAllOptionsByStep: {}
    }
  };
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "connection/patch":
      return { ...state, connection: applyUpdater(state.connection, action.updater) };
    case "server/patch":
      return { ...state, server: applyUpdater(state.server, action.updater) };
    case "identity/patch":
      return { ...state, identity: applyUpdater(state.identity, action.updater) };
    case "settings/patch":
      return { ...state, settings: applyUpdater(state.settings, action.updater) };
    case "lobby/patch":
      return { ...state, lobby: applyUpdater(state.lobby, action.updater) };
    case "practice/patch":
      return { ...state, practiceUi: applyUpdater(state.practiceUi, action.updater) };
    case "game/patch":
      return { ...state, gameUi: applyUpdater(state.gameUi, action.updater) };
    case "replay/patch":
      return { ...state, replayUi: applyUpdater(state.replayUi, action.updater) };
    case "clock/tick":
      return { ...state, clock: { now: action.now } };
    case "app/set-pending-private-room-join":
      return { ...state, pendingPrivateRoomJoin: action.value };
    case "app/set-private-invite-copy-status":
      return { ...state, privateInviteCopyStatus: action.value };
    case "game/clear-log-and-chat":
      return {
        ...state,
        gameUi: {
          ...state.gameUi,
          gameLogEntries: [],
          chatMessages: [],
          chatDraft: "",
          claimedWordHighlights: {}
        }
      };
    case "replay/reset":
      return resetReplayState(state);
    case "practice/reset-inputs":
      return {
        ...state,
        practiceUi: {
          ...state.practiceUi,
          practiceWord: "",
          submitError: null,
          pendingResultAutoSubmit: null
        },
        server: {
          ...state.server,
          practiceState: createInactivePracticeState()
        }
      };
    case "lobby/reset-practice-start-prompt":
      return {
        ...state,
        lobby: {
          ...state.lobby,
          practiceStartPrompt: {
            ...state.lobby.practiceStartPrompt,
            isOpen: false,
            mode: "start",
            difficulty: null,
            timerEnabled: false
          }
        }
      };
    case "app/reset-on-leave-room": {
      const replayReset = resetReplayState(state);
      return {
        ...replayReset,
        server: {
          ...replayReset.server,
          roomState: null,
          gameState: null
        },
        lobby: {
          ...replayReset.lobby,
          error: null,
          view: "list"
        },
        gameUi: {
          ...replayReset.gameUi,
          claimWord: "",
          queuedTileClaimLetters: "",
          preStealTriggerInput: "",
          preStealClaimWordInput: "",
          preStealDraggedEntryId: null,
          showLeaveGameConfirm: false,
          gameLogEntries: [],
          chatMessages: [],
          chatDraft: "",
          claimedWordHighlights: {}
        },
        privateInviteCopyStatus: null
      };
    }
    default:
      return state;
  }
}
