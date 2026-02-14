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

type ReplayPanelModel = {
  replayBackButtonLabel: string;
  roomState: RoomState | null;
  canExportReplay: boolean;
  clampedReplayStepIndex: number;
  replayStepsLength: number;
  maxReplayStepIndex: number;
  isReplayAnalysisOpen: boolean;
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
};

type ReplayPanelActions = {
  onExitReplayView: () => void;
  onLeaveRoom: () => void;
  onOpenReplayImport: () => void;
  onViewReplayAsPuzzle: () => void;
  onExportReplay: () => void;
  onReplayStepIndexChange: (value: number | ((current: number) => number)) => void;
  onReplayAnalysisOpenChange: (value: boolean | ((current: boolean) => boolean)) => void;
  onShowAllReplayOptionsByStepChange: (
    updater: (current: Record<number, boolean>) => Record<number, boolean>
  ) => void;
};

type Props = {
  model: ReplayPanelModel;
  actions: ReplayPanelActions;
};

export function ReplayPanelView({ model, actions }: Props) {
  return (
    <div className="replay-panel">
      <div className="button-row">
        <button className="button-secondary" onClick={actions.onExitReplayView}>
          {model.replayBackButtonLabel}
        </button>
        {model.roomState && (
          <button className="button-secondary" onClick={actions.onLeaveRoom}>
            Return to lobby
          </button>
        )}
      </div>
      <div className="replay-controls">
        <button
          className="button-secondary"
          onClick={() => actions.onReplayStepIndexChange(0)}
          disabled={model.clampedReplayStepIndex <= 0}
        >
          Start
        </button>
        <button
          className="button-secondary"
          onClick={() => actions.onReplayStepIndexChange((current) => Math.max(0, current - 1))}
          disabled={model.clampedReplayStepIndex <= 0}
        >
          Prev
        </button>
        <span className="replay-step-label">
          Step {model.clampedReplayStepIndex + 1} / {model.replayStepsLength}
        </span>
        <button
          className="button-secondary"
          onClick={() =>
            actions.onReplayStepIndexChange((current) => Math.min(model.maxReplayStepIndex, current + 1))
          }
          disabled={model.clampedReplayStepIndex >= model.maxReplayStepIndex}
        >
          Next
        </button>
        <button
          className="button-secondary"
          onClick={() => actions.onReplayStepIndexChange(model.maxReplayStepIndex)}
          disabled={model.clampedReplayStepIndex >= model.maxReplayStepIndex}
        >
          End
        </button>
        <button
          className="button-secondary"
          onClick={() => actions.onReplayAnalysisOpenChange((current) => !current)}
        >
          {model.isReplayAnalysisOpen ? "Hide analysis" : "Show analysis"}
        </button>
        <button className="button-secondary" onClick={actions.onOpenReplayImport}>
          Import replay
        </button>
        <button className="button-secondary" onClick={actions.onViewReplayAsPuzzle}>
          View as Puzzle
        </button>
        {model.canExportReplay && (
          <button className="button-secondary" onClick={actions.onExportReplay}>
            Export replay (.json)
          </button>
        )}
      </div>
      {model.replayPuzzleError && (
        <div className="replay-import-error" role="alert">
          {model.replayPuzzleError}
        </div>
      )}
      {model.importReplayError && (
        <div className="replay-import-error" role="alert">
          {model.importReplayError}
        </div>
      )}
      <div className="replay-board-layout">
        <section className="replay-board">
          <div className="replay-board-header">
            <div>
              <h3>Replay Board</h3>
              <p className="muted">{model.activeReplayActionText}</p>
            </div>
            <div className="turn">
              <span>Turn:</span>
              <strong>{model.replayTurnPlayerName}</strong>
            </div>
          </div>
          <p className="muted">Bag: {model.activeReplayState.bagCount} tiles</p>
          {model.activeReplayState.pendingFlip && (
            <p className="muted">
              {getPlayerName(model.activeReplayState.players, model.activeReplayState.pendingFlip.playerId)} is revealing a tile...
            </p>
          )}
          <div className="tiles">
            {model.activeReplayState.centerTiles.length === 0 && (
              <div className="muted">No tiles flipped yet.</div>
            )}
            {model.activeReplayState.centerTiles.map((tile) => (
              <div key={tile.id} className="tile">
                {tile.letter}
              </div>
            ))}
          </div>
          <div className="words board-words">
            {model.activeReplayState.players.map((player) => (
              <ReplayWordList key={player.id} player={player} />
            ))}
          </div>
        </section>
        <section className="replay-scoreboard">
          <h3>Players</h3>
          <div className="player-list">
            {model.orderedReplayPlayers.map((player) => (
              <div key={player.id} className="player">
                <div>
                  <strong>{player.name}</strong>
                  {player.id === model.activeReplayState.turnPlayerId && <span className="badge">turn</span>}
                </div>
                <span className="score">{player.score}</span>
              </div>
            ))}
          </div>
          {model.activeReplayState.preStealEnabled && (
            <div className="pre-steal-panel replay-pre-steal-panel">
              <div className="pre-steal-entries-column">
                <div className="word-header">
                  <span>Pre-steal entries</span>
                </div>
                {model.replayPreStealPlayers.map((player) => (
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
      {model.isReplayAnalysisOpen && (
        <section className="replay-analysis-panel">
          <div className="replay-analysis-header">
            <h3>Best moves</h3>
            {model.activeReplayAnalysis && (
              <span className="score">Best score: {model.activeReplayAnalysis.bestScore}</span>
            )}
          </div>
          {model.isActiveReplayAnalysisLoading && <div className="muted">Analyzing this replay step...</div>}
          {!model.isActiveReplayAnalysisLoading && model.replayAnalysisError && (
            <div className="practice-submit-error" role="alert">
              {model.replayAnalysisError}
            </div>
          )}
          {!model.isActiveReplayAnalysisLoading && !model.replayAnalysisError && model.activeReplayAnalysis && (
            <>
              <p className="muted">
                {model.activeReplayAnalysis.basis === "before-claim"
                  ? "Analyzed from state before this claim."
                  : "Analyzed from this revealed-tile state."}
              </p>
              <div className="practice-options replay-options">
                {model.visibleReplayAnalysisOptions.map((option) => {
                  const key = `${option.word}-${option.source}-${option.stolenFrom ?? "center"}`;
                  return (
                    <div
                      key={key}
                      className={getReplayPracticeOptionClassName(option, model.activeReplayClaimedWords)}
                    >
                      <div>
                        <strong>{formatPracticeOptionLabel(option)}</strong>
                      </div>
                      <span className="score">{option.score}</span>
                    </div>
                  );
                })}
                {model.hiddenReplayAnalysisOptionCount > 0 && (
                  <button
                    type="button"
                    className="practice-option-more"
                    onClick={() => {
                      const requestedStepIndex = model.activeReplayAnalysis?.requestedStepIndex;
                      if (requestedStepIndex === undefined) return;
                      actions.onShowAllReplayOptionsByStepChange((current) => ({
                        ...current,
                        [requestedStepIndex]: true
                      }));
                    }}
                  >
                    more
                  </button>
                )}
              </div>
            </>
          )}
          {!model.isActiveReplayAnalysisLoading &&
            !model.replayAnalysisError &&
            !model.activeReplayAnalysis && (
              <div className="muted">No analysis available for this replay step.</div>
            )}
        </section>
      )}
    </div>
  );
}
