import type {
  Dispatch,
  SetStateAction
} from "react";
import type {
  PracticeScoredWord,
  ReplayAnalysisResult,
  ReplayPlayerSnapshot,
  ReplayStateSnapshot,
  RoomState
} from "@shared/types";
import { ReplayWordList } from "../components/ReplayWordList";
import { getPlayerName } from "../game/gameUtils";
import {
  formatPracticeOptionLabel,
  getReplayPracticeOptionClassName
} from "../practice/practiceUtils";

type ReplayPreStealPlayer = {
  id: string;
  name: string;
  preStealEntries: {
    id: string;
    triggerLetters: string;
    claimWord: string;
  }[];
};

type Props = {
  replayBackButtonLabel: string;
  roomState: RoomState | null;
  onExitReplayView: () => void;
  onLeaveRoom: () => void;
  onOpenReplayImport: () => void;
  onViewReplayAsPuzzle: () => void;
  onExportReplay: () => void;
  canExportReplay: boolean;
  clampedReplayStepIndex: number;
  replayStepsLength: number;
  maxReplayStepIndex: number;
  setReplayStepIndex: Dispatch<SetStateAction<number>>;
  isReplayAnalysisOpen: boolean;
  setIsReplayAnalysisOpen: Dispatch<SetStateAction<boolean>>;
  replayPuzzleError: string | null;
  importReplayError: string | null;
  activeReplayActionText: string;
  replayTurnPlayerName: string;
  activeReplayState: ReplayStateSnapshot;
  orderedReplayPlayers: ReplayPlayerSnapshot[];
  replayPreStealPlayers: ReplayPreStealPlayer[];
  activeReplayAnalysis: ReplayAnalysisResult | null;
  isActiveReplayAnalysisLoading: boolean;
  replayAnalysisError: string | null;
  visibleReplayAnalysisOptions: PracticeScoredWord[];
  activeReplayClaimedWords: Set<string>;
  hiddenReplayAnalysisOptionCount: number;
  showAllReplayOptionsByStep: Record<number, boolean>;
  setShowAllReplayOptionsByStep: Dispatch<SetStateAction<Record<number, boolean>>>;
};

export function ReplayPanelView({
  replayBackButtonLabel,
  roomState,
  onExitReplayView,
  onLeaveRoom,
  onOpenReplayImport,
  onViewReplayAsPuzzle,
  onExportReplay,
  canExportReplay,
  clampedReplayStepIndex,
  replayStepsLength,
  maxReplayStepIndex,
  setReplayStepIndex,
  isReplayAnalysisOpen,
  setIsReplayAnalysisOpen,
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
  showAllReplayOptionsByStep,
  setShowAllReplayOptionsByStep
}: Props) {
  return (
    <div className="replay-panel">
      <div className="button-row">
        <button className="button-secondary" onClick={onExitReplayView}>
          {replayBackButtonLabel}
        </button>
        {roomState && (
          <button className="button-secondary" onClick={onLeaveRoom}>
            Return to lobby
          </button>
        )}
      </div>
      <div className="replay-controls">
        <button
          className="button-secondary"
          onClick={() => setReplayStepIndex(0)}
          disabled={clampedReplayStepIndex <= 0}
        >
          Start
        </button>
        <button
          className="button-secondary"
          onClick={() => setReplayStepIndex((current) => Math.max(0, current - 1))}
          disabled={clampedReplayStepIndex <= 0}
        >
          Prev
        </button>
        <span className="replay-step-label">
          Step {clampedReplayStepIndex + 1} / {replayStepsLength}
        </span>
        <button
          className="button-secondary"
          onClick={() => setReplayStepIndex((current) => Math.min(maxReplayStepIndex, current + 1))}
          disabled={clampedReplayStepIndex >= maxReplayStepIndex}
        >
          Next
        </button>
        <button
          className="button-secondary"
          onClick={() => setReplayStepIndex(maxReplayStepIndex)}
          disabled={clampedReplayStepIndex >= maxReplayStepIndex}
        >
          End
        </button>
        <button
          className="button-secondary"
          onClick={() => setIsReplayAnalysisOpen((current) => !current)}
        >
          {isReplayAnalysisOpen ? "Hide analysis" : "Show analysis"}
        </button>
        <button className="button-secondary" onClick={onOpenReplayImport}>
          Import replay
        </button>
        <button className="button-secondary" onClick={onViewReplayAsPuzzle}>
          View as Puzzle
        </button>
        {canExportReplay && (
          <button className="button-secondary" onClick={onExportReplay}>
            Export replay (.json)
          </button>
        )}
      </div>
      {replayPuzzleError && (
        <div className="replay-import-error" role="alert">
          {replayPuzzleError}
        </div>
      )}
      {importReplayError && (
        <div className="replay-import-error" role="alert">
          {importReplayError}
        </div>
      )}
      <div className="replay-board-layout">
        <section className="replay-board">
          <div className="replay-board-header">
            <div>
              <h3>Replay Board</h3>
              <p className="muted">{activeReplayActionText}</p>
            </div>
            <div className="turn">
              <span>Turn:</span>
              <strong>{replayTurnPlayerName}</strong>
            </div>
          </div>
          <p className="muted">Bag: {activeReplayState.bagCount} tiles</p>
          {activeReplayState.pendingFlip && (
            <p className="muted">
              {getPlayerName(activeReplayState.players, activeReplayState.pendingFlip.playerId)} is revealing a tile...
            </p>
          )}
          <div className="tiles">
            {activeReplayState.centerTiles.length === 0 && (
              <div className="muted">No tiles flipped yet.</div>
            )}
            {activeReplayState.centerTiles.map((tile) => (
              <div key={tile.id} className="tile">
                {tile.letter}
              </div>
            ))}
          </div>
          <div className="words board-words">
            {activeReplayState.players.map((player) => (
              <ReplayWordList key={player.id} player={player} />
            ))}
          </div>
        </section>
        <section className="replay-scoreboard">
          <h3>Players</h3>
          <div className="player-list">
            {orderedReplayPlayers.map((player) => (
              <div key={player.id} className="player">
                <div>
                  <strong>{player.name}</strong>
                  {player.id === activeReplayState.turnPlayerId && <span className="badge">turn</span>}
                </div>
                <span className="score">{player.score}</span>
              </div>
            ))}
          </div>
          {activeReplayState.preStealEnabled && (
            <div className="pre-steal-panel replay-pre-steal-panel">
              <div className="pre-steal-entries-column">
                <div className="word-header">
                  <span>Pre-steal entries</span>
                </div>
                {replayPreStealPlayers.map((player) => (
                  <div key={player.id} className="word-list">
                    <div className="word-header">
                      <span>{player.name}</span>
                    </div>
                    {player.preStealEntries.length === 0 && (
                      <div className="muted">No entries.</div>
                    )}
                    {player.preStealEntries.map((entry) => (
                      <div key={entry.id} className="pre-steal-entry">
                        <span className="pre-steal-entry-text">
                          {entry.triggerLetters}
                          {" -> "}
                          {entry.claimWord}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
      {isReplayAnalysisOpen && (
        <section className="replay-analysis-panel">
          <div className="replay-analysis-header">
            <h3>Best moves</h3>
            {activeReplayAnalysis && (
              <span className="score">Best score: {activeReplayAnalysis.bestScore}</span>
            )}
          </div>
          {isActiveReplayAnalysisLoading && <div className="muted">Analyzing this replay step...</div>}
          {!isActiveReplayAnalysisLoading && replayAnalysisError && (
            <div className="practice-submit-error" role="alert">
              {replayAnalysisError}
            </div>
          )}
          {!isActiveReplayAnalysisLoading && !replayAnalysisError && activeReplayAnalysis && (
            <>
              <p className="muted">
                {activeReplayAnalysis.basis === "before-claim"
                  ? "Analyzed from state before this claim."
                  : "Analyzed from this revealed-tile state."}
              </p>
              <div className="practice-options">
                {visibleReplayAnalysisOptions.map((option) => (
                  <div
                    key={`${activeReplayAnalysis.requestedStepIndex}-${option.word}-${option.source}-${option.stolenFrom ?? "center"}`}
                    className={getReplayPracticeOptionClassName(option, activeReplayClaimedWords)}
                  >
                    <div>
                      <strong>{formatPracticeOptionLabel(option)}</strong>
                    </div>
                    <span className="score">{option.score}</span>
                  </div>
                ))}
                {hiddenReplayAnalysisOptionCount > 0 &&
                  !showAllReplayOptionsByStep[activeReplayAnalysis.requestedStepIndex] && (
                    <button
                      type="button"
                      className="practice-option-more"
                      onClick={() =>
                        setShowAllReplayOptionsByStep((current) => ({
                          ...current,
                          [activeReplayAnalysis.requestedStepIndex]: true
                        }))
                      }
                    >
                      more
                    </button>
                  )}
                {activeReplayAnalysis.allOptions.length === 0 && (
                  <div className="muted">No valid moves from this position.</div>
                )}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
