import type {
  Player,
  PracticeScoredWord,
  ReplayStateSnapshot,
  RoomSummary
} from "@shared/types";
import {
  DEFAULT_CLAIM_TIMER_SECONDS,
  DEFAULT_FLIP_REVEAL_MS,
  PRACTICE_TIMER_WARNING_SECONDS,
  REPLAY_ANALYSIS_DEFAULT_VISIBLE_OPTIONS
} from "../constants";
import { normalizeEditorText } from "../practice/practiceUtils";
import { getReplayClaimWordDiff } from "../replay/replayUtils";
import { getPlayerName } from "../game/gameUtils";
import type { AppState } from "./types";

export function selectCurrentPlayers(state: AppState): Player[] {
  if (state.server.gameState) return state.server.gameState.players;
  if (state.server.roomState) return state.server.roomState.players;
  return [];
}

export function selectOpenLobbyRooms(state: AppState): RoomSummary[] {
  return state.server.roomList.filter((room) => room.status === "lobby");
}

export function selectInProgressLobbyRooms(state: AppState): RoomSummary[] {
  return state.server.roomList.filter((room) => room.status === "in-game");
}

export function selectOrderedGamePlayers(state: AppState): Player[] {
  const gameState = state.server.gameState;
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
}

export function selectClaimUi(state: AppState): {
  isMyClaimWindow: boolean;
  isFlipRevealActive: boolean;
  claimWindowRemainingSeconds: number | null;
  claimProgress: number;
  claimStatus: string;
  claimButtonLabel: string;
  isClaimButtonDisabled: boolean;
  isClaimInputDisabled: boolean;
  shouldShowClaimUndoButton: boolean;
  isClaimUndoButtonDisabled: boolean;
  pendingFlip: NonNullable<AppState["server"]["gameState"]>["pendingFlip"] | null;
  flipRevealDurationMs: number;
  flipRevealElapsedMs: number;
  flipRevealPlayerName: string;
  claimWindow: NonNullable<AppState["server"]["gameState"]>["claimWindow"] | null;
} {
  const now = state.clock.now;
  const roomState = state.server.roomState;
  const gameState = state.server.gameState;
  const selfPlayerId = state.connection.selfPlayerId;
  const isSpectator = Boolean(
    roomState &&
      gameState &&
      selfPlayerId &&
      !gameState.players.some((player) => player.id === selfPlayerId)
  );

  const pendingFlip = gameState?.pendingFlip ?? null;
  const isFlipRevealActive = pendingFlip !== null;
  const flipRevealDurationMs = pendingFlip
    ? Math.max(1, pendingFlip.revealsAt - pendingFlip.startedAt)
    : DEFAULT_FLIP_REVEAL_MS;
  const flipRevealElapsedMs = pendingFlip
    ? Math.max(0, Math.min(flipRevealDurationMs, now - pendingFlip.startedAt))
    : 0;
  const flipRevealPlayerName = pendingFlip && gameState
    ? getPlayerName(gameState.players, pendingFlip.playerId)
    : "Unknown";

  const claimWindow = gameState?.claimWindow ?? null;
  const isMyClaimWindow = claimWindow?.playerId === selfPlayerId;
  const claimTimerSeconds = roomState?.claimTimer.seconds ?? DEFAULT_CLAIM_TIMER_SECONDS;
  const claimWindowRemainingMs = claimWindow ? Math.max(0, claimWindow.endsAt - now) : null;
  const claimWindowRemainingSeconds =
    claimWindowRemainingMs === null ? null : Math.max(0, Math.ceil(claimWindowRemainingMs / 1000));

  const claimProgress = claimWindowRemainingMs === null
    ? 0
    : Math.max(0, Math.min(1, claimWindowRemainingMs / (claimTimerSeconds * 1000)));

  const claimCooldownEndsAt = selfPlayerId ? gameState?.claimCooldowns?.[selfPlayerId] : null;
  const claimCooldownRemainingMs =
    claimCooldownEndsAt && claimCooldownEndsAt > now ? claimCooldownEndsAt - now : null;
  const claimCooldownRemainingSeconds =
    claimCooldownRemainingMs === null ? null : Math.max(0, Math.ceil(claimCooldownRemainingMs / 1000));
  const isClaimCooldownActive = claimCooldownRemainingMs !== null;

  const claimWindowPlayerName = claimWindow && gameState
    ? gameState.players.find((player) => player.id === claimWindow.playerId)?.name ?? "Unknown"
    : "Unknown";

  const tileInputEnabled = state.settings.userSettings.inputMethod === "tile";

  const claimStatus = isSpectator
    ? "Spectating (read-only)"
    : isFlipRevealActive
      ? `${flipRevealPlayerName} is revealing a tile...`
      : claimWindow && claimWindowRemainingSeconds !== null
        ? isMyClaimWindow
          ? `Your claim window: ${claimWindowRemainingSeconds}s`
          : `${claimWindowPlayerName} is claiming (${claimWindowRemainingSeconds}s)`
        : isClaimCooldownActive && claimCooldownRemainingSeconds !== null
          ? `Cooldown: ${claimCooldownRemainingSeconds}s or next flip.`
          : tileInputEnabled
            ? "Click or tap tiles to build a claim"
            : "Press enter to claim a word";

  const isClaimButtonDisabled = isMyClaimWindow
    ? !state.gameUi.claimWord.trim() || isFlipRevealActive
    : Boolean(claimWindow) || isClaimCooldownActive || isFlipRevealActive || isSpectator;

  const isClaimInputDisabled =
    !isMyClaimWindow || isClaimCooldownActive || isFlipRevealActive || isSpectator;

  const shouldShowClaimUndoButton = tileInputEnabled && !isSpectator;
  const isClaimUndoButtonDisabled = isMyClaimWindow
    ? state.gameUi.claimWord.length === 0
    : state.gameUi.queuedTileClaimLetters.length === 0;

  return {
    isMyClaimWindow,
    isFlipRevealActive,
    claimWindowRemainingSeconds,
    claimProgress,
    claimStatus,
    claimButtonLabel: isSpectator ? "Spectating" : isMyClaimWindow ? "Submit Claim" : "Start Claim",
    isClaimButtonDisabled,
    isClaimInputDisabled,
    shouldShowClaimUndoButton,
    isClaimUndoButtonDisabled,
    pendingFlip,
    flipRevealDurationMs,
    flipRevealElapsedMs,
    flipRevealPlayerName,
    claimWindow
  };
}

export function selectReplayState(state: AppState): {
  replayStepsLength: number;
  maxReplayStepIndex: number;
  clampedReplayStepIndex: number;
  activeReplayState: ReplayStateSnapshot | null;
  activeReplayClaimedWords: Set<string>;
  visibleReplayAnalysisOptions: PracticeScoredWord[];
  hiddenReplayAnalysisOptionCount: number;
} {
  const roomReplay = state.server.gameState?.replay ?? null;
  const replaySource = state.replayUi.replaySource;
  const activeReplay =
    replaySource?.kind === "imported"
      ? replaySource.file.replay
      : replaySource?.kind === "room"
        ? replaySource.replay
        : null;
  const replaySteps = (activeReplay?.steps ?? []).filter(
    (step) => step.kind === "flip-revealed" || step.kind === "claim-succeeded"
  );

  const maxReplayStepIndex = replaySteps.length > 0 ? replaySteps.length - 1 : 0;
  const clampedReplayStepIndex = Math.min(Math.max(state.replayUi.replayStepIndex, 0), maxReplayStepIndex);
  const activeReplayStep = replaySteps[clampedReplayStepIndex] ?? null;
  const activeReplayState = activeReplayStep?.state ?? null;

  const requestedStepIndex = activeReplayStep?.index;
  const activeReplayAnalysis =
    requestedStepIndex === undefined
      ? null
      : replaySource?.kind === "imported"
        ? state.replayUi.importedAnalysisByStepIndex[requestedStepIndex] ?? null
        : state.replayUi.analysisByStepIndex[requestedStepIndex] ?? null;

  let visibleReplayAnalysisOptions: PracticeScoredWord[] = [];
  let hiddenReplayAnalysisOptionCount = 0;

  if (activeReplayAnalysis) {
    const showAll = Boolean(state.replayUi.showAllOptionsByStep[activeReplayAnalysis.requestedStepIndex]);
    if (showAll) {
      visibleReplayAnalysisOptions = activeReplayAnalysis.allOptions;
    } else {
      const visibleCount = Math.min(
        REPLAY_ANALYSIS_DEFAULT_VISIBLE_OPTIONS,
        activeReplayAnalysis.allOptions.length
      );
      visibleReplayAnalysisOptions = activeReplayAnalysis.allOptions.slice(0, visibleCount);
      hiddenReplayAnalysisOptionCount = Math.max(0, activeReplayAnalysis.allOptions.length - visibleCount);
    }
  }

  const claimWordDiff = getReplayClaimWordDiff(replaySteps, clampedReplayStepIndex);
  const activeReplayClaimedWords = claimWordDiff
    ? new Set(claimWordDiff.addedWords.map((word) => normalizeEditorText(word.text)))
    : new Set<string>();

  void roomReplay;

  return {
    replayStepsLength: replaySteps.length,
    maxReplayStepIndex,
    clampedReplayStepIndex,
    activeReplayState,
    activeReplayClaimedWords,
    visibleReplayAnalysisOptions,
    hiddenReplayAnalysisOptionCount
  };
}

export function selectPracticeTimerUi(state: AppState): {
  practiceTimerRemainingSeconds: number | null;
  practiceTimerProgress: number;
  isPracticeTimerWarning: boolean;
} {
  const now = state.clock.now;
  const practiceState = state.server.practiceState;

  const practiceTimerRemainingMs =
    !practiceState.active ||
    practiceState.phase !== "puzzle" ||
    !practiceState.timerEnabled ||
    !practiceState.puzzleTimerEndsAt
      ? null
      : Math.max(0, practiceState.puzzleTimerEndsAt - now);

  const practiceTimerRemainingSeconds =
    practiceTimerRemainingMs === null ? null : Math.max(0, Math.ceil(practiceTimerRemainingMs / 1000));

  const practiceTimerProgress =
    practiceTimerRemainingMs === null
      ? 0
      : Math.max(0, Math.min(1, practiceTimerRemainingMs / (practiceState.timerSeconds * 1000)));

  const isPracticeTimerWarning =
    practiceTimerRemainingSeconds !== null &&
    practiceTimerRemainingSeconds <= PRACTICE_TIMER_WARNING_SECONDS;

  return {
    practiceTimerRemainingSeconds,
    practiceTimerProgress,
    isPracticeTimerWarning
  };
}
