import {
  useMemo,
  useState,
  type KeyboardEvent,
  type RefObject
} from "react";
import type {
  GameState,
  Player,
  RoomState
} from "@shared/types";
import { WordList } from "../components/WordList";
import type { WordHighlightKind } from "../types";

const BAG_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

type SpectatorPreStealPlayer = {
  id: string;
  name: string;
  connected: boolean;
  preStealEntries: GameState["players"][number]["preStealEntries"];
};

type GameViewModel = {
  roomState: RoomState;
  gameState: GameState;
  selfPlayerId: string | null;
  isSpectator: boolean;
  endTimerRemaining: number | null;
  formatTime: (seconds: number) => string;
  isFlipRevealActive: boolean;
  isTileSelectionEnabled: boolean;
  pendingFlip: GameState["pendingFlip"];
  flipRevealDurationMs: number;
  flipRevealElapsedMs: number;
  flipRevealPlayerName: string;
  claimWindow: GameState["claimWindow"];
  claimProgress: number;
  claimWord: string;
  isMyClaimWindow: boolean;
  claimPlaceholder: string;
  isClaimInputDisabled: boolean;
  isClaimButtonDisabled: boolean;
  claimButtonLabel: string;
  shouldShowClaimUndoButton: boolean;
  isClaimUndoButtonDisabled: boolean;
  orderedGamePlayers: Player[];
  claimedWordHighlights: Record<string, WordHighlightKind>;
  spectatorPreStealPlayers: SpectatorPreStealPlayer[];
  preStealTriggerInput: string;
  preStealClaimWordInput: string;
  myPreStealEntries: GameState["players"][number]["preStealEntries"];
  preStealDraggedEntryId: string | null;
};

type GameViewActions = {
  onFlip: () => void;
  onClaimTileSelect: (letter: string) => void;
  onClaimSubmit: () => void;
  onClaimIntent: () => void;
  onClaimWordChange: (value: string) => void;
  onClaimUndoTap: () => void;
  onOpenLeaveGameConfirm: () => void;
  onPreStealTriggerInputChange: (value: string) => void;
  onPreStealClaimWordInputChange: (value: string) => void;
  onAddPreStealEntry: () => void;
  onPreStealDraggedEntryIdChange: (entryId: string | null) => void;
  onPreStealEntryDrop: (targetEntryId: string) => void;
  onRemovePreStealEntry: (entryId: string) => void;
};

type GameViewRefs = {
  claimInputRef: RefObject<HTMLInputElement>;
};

type Props = {
  model: GameViewModel;
  actions: GameViewActions;
  refs: GameViewRefs;
};

export function GameView({ model, actions, refs }: Props) {
  const [isRemainingTilesModalOpen, setIsRemainingTilesModalOpen] = useState(false);

  const remainingBagLetterCounts = useMemo(
    () =>
      BAG_LETTERS.map((letter) => ({
        letter,
        count: model.gameState.bagLetterCounts?.[letter] ?? 0
      })),
    [model.gameState.bagLetterCounts]
  );

  const handleBagCountKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setIsRemainingTilesModalOpen(true);
  };

  return (
    <div className="game">
      <section className="panel game-board">
        <div className="game-header">
          <div>
            <h2>Center Tiles</h2>
            <div
              className="muted bag-count-trigger"
              role="button"
              tabIndex={0}
              onClick={() => setIsRemainingTilesModalOpen(true)}
              onKeyDown={handleBagCountKeyDown}
              aria-label="Show remaining tiles in bag"
            >
              Bag: {model.gameState.bagCount} tiles
            </div>
            {model.roomState?.flipTimer.enabled && (
              <p className="muted">Auto flip: {model.roomState.flipTimer.seconds}s</p>
            )}
          </div>
          <div className="turn">
            <span>Turn:</span>
            <strong>
              {model.gameState.players.find((player) => player.id === model.gameState.turnPlayerId)?.name || "Unknown"}
            </strong>
            <button
              onClick={actions.onFlip}
              disabled={
                model.isSpectator ||
                model.gameState.turnPlayerId !== model.selfPlayerId ||
                model.isFlipRevealActive ||
                !!model.claimWindow
              }
            >
              Flip Tile
            </button>
          </div>
        </div>

        {model.endTimerRemaining !== null && (
          <div className="timer">End in {model.formatTime(model.endTimerRemaining)}</div>
        )}

        <div className="tiles">
          {model.gameState.centerTiles.length === 0 && !model.pendingFlip && (
            <div className="muted">No tiles flipped yet.</div>
          )}
          {model.gameState.centerTiles.map((tile) => (
            <div
              key={tile.id}
              className={model.isTileSelectionEnabled ? "tile tile-selectable" : "tile"}
              role={model.isTileSelectionEnabled ? "button" : undefined}
              tabIndex={model.isTileSelectionEnabled ? 0 : undefined}
              onClick={
                model.isTileSelectionEnabled ? () => actions.onClaimTileSelect(tile.letter) : undefined
              }
              onKeyDown={
                model.isTileSelectionEnabled
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        actions.onClaimTileSelect(tile.letter);
                      }
                    }
                  : undefined
              }
              aria-label={
                model.isTileSelectionEnabled ? `Use letter ${tile.letter} for claim` : undefined
              }
            >
              {tile.letter}
            </div>
          ))}
          {model.pendingFlip && (
            <div
              className="tile tile-reveal-card"
              style={{
                animationDuration: `${model.flipRevealDurationMs}ms`,
                animationDelay: `-${model.flipRevealElapsedMs}ms`
              }}
              aria-live="polite"
              aria-label={`${model.flipRevealPlayerName} is revealing the next tile`}
            >
              ?
            </div>
          )}
        </div>

        <div className="claim-box">
          <div
            className={`claim-timer ${model.claimWindow ? "" : "placeholder"}`}
            role={model.claimWindow ? "progressbar" : undefined}
            aria-label={model.claimWindow ? "Claim timer" : undefined}
            aria-valuemin={model.claimWindow ? 0 : undefined}
            aria-valuemax={model.claimWindow ? 100 : undefined}
            aria-valuenow={model.claimWindow ? Math.round(model.claimProgress * 100) : undefined}
            aria-hidden={!model.claimWindow}
          >
            <div
              className="claim-progress"
              style={{ width: `${model.claimWindow ? model.claimProgress * 100 : 0}%` }}
            />
          </div>
          <div className="claim-input">
            <input
              ref={refs.claimInputRef}
              value={model.claimWord}
              onChange={(event) => actions.onClaimWordChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  if (model.isMyClaimWindow) {
                    actions.onClaimSubmit();
                    return;
                  }
                  actions.onClaimIntent();
                }
              }}
              placeholder={model.claimPlaceholder}
              disabled={model.isClaimInputDisabled}
            />
            {model.shouldShowClaimUndoButton && (
              <button
                type="button"
                className="button-secondary"
                onClick={actions.onClaimUndoTap}
                disabled={model.isClaimUndoButtonDisabled}
              >
                Undo
              </button>
            )}
            <button
              type="button"
              onClick={model.isMyClaimWindow ? actions.onClaimSubmit : actions.onClaimIntent}
              disabled={model.isClaimButtonDisabled}
            >
              {model.claimButtonLabel}
            </button>
          </div>
        </div>

        <div className="words board-words">
          {model.gameState.players.map((player) => (
            <WordList
              key={player.id}
              player={player}
              isSelf={player.id === model.selfPlayerId}
              highlightedWordIds={model.claimedWordHighlights}
              onTileLetterSelect={actions.onClaimTileSelect}
            />
          ))}
        </div>
      </section>

      <section className="panel scoreboard">
        <div className="scoreboard-header">
          <h2>Players</h2>
          <button className="button-danger" onClick={actions.onOpenLeaveGameConfirm}>
            {model.isSpectator ? "Leave Spectate" : "Leave Game"}
          </button>
        </div>
        <div className="player-list">
          {model.orderedGamePlayers.map((player) => (
            <div key={player.id} className={player.id === model.selfPlayerId ? "player you" : "player"}>
              <div>
                <strong>{player.name}</strong>
                {player.id === model.gameState.turnPlayerId && <span className="badge">turn</span>}
                {!player.connected && <span className="badge">offline</span>}
              </div>
              <span className="score">{player.score}</span>
            </div>
          ))}
        </div>

        {model.gameState.preStealEnabled && (
          <div className="pre-steal-panel">
            {model.isSpectator ? (
              <div className="pre-steal-entries-column">
                <div className="word-header">
                  <span>Pre-steal entries</span>
                </div>
                {model.spectatorPreStealPlayers.map((player) => (
                  <div key={player.id} className="word-list">
                    <div className="word-header">
                      <span>{player.name}</span>
                      {!player.connected && <span className="badge">offline</span>}
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
            ) : (
              <div className="pre-steal-entries-column">
                <div className="word-header">
                  <span>Your pre-steal entries</span>
                </div>
                <div className="pre-steal-entry-form">
                  <input
                    className="pre-steal-trigger-input"
                    value={model.preStealTriggerInput}
                    onChange={(event) => actions.onPreStealTriggerInputChange(event.target.value)}
                    placeholder="Trigger letters"
                  />
                  <input
                    className="pre-steal-claim-input"
                    value={model.preStealClaimWordInput}
                    onChange={(event) => actions.onPreStealClaimWordInputChange(event.target.value)}
                    placeholder="Claim word"
                  />
                  <button
                    className="button-secondary"
                    onClick={actions.onAddPreStealEntry}
                    disabled={!model.preStealTriggerInput.trim() || !model.preStealClaimWordInput.trim()}
                  >
                    Add
                  </button>
                </div>

                {model.myPreStealEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="pre-steal-entry self"
                    draggable
                    onDragStart={(event) => {
                      actions.onPreStealDraggedEntryIdChange(entry.id);
                      event.dataTransfer.setData("text/plain", entry.id);
                    }}
                    onDragEnd={() => actions.onPreStealDraggedEntryIdChange(null)}
                    onDragOver={(event) => {
                      if (!model.preStealDraggedEntryId) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      actions.onPreStealEntryDrop(entry.id);
                    }}
                  >
                    <span className="pre-steal-entry-text">
                      {entry.triggerLetters}
                      {" -> "}
                      {entry.claimWord}
                    </span>
                    <button className="button-secondary" onClick={() => actions.onRemovePreStealEntry(entry.id)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {isRemainingTilesModalOpen && (
        <div className="join-overlay" onClick={() => setIsRemainingTilesModalOpen(false)}>
          <div
            className="panel join-modal remaining-tiles-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Remaining tiles in bag"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>Remaining Tiles</h2>
            <p className="muted">A-Z counts for tiles still in the bag.</p>
            <div className="remaining-tiles-list">
              {remainingBagLetterCounts.map(({ letter, count }) => (
                <div
                  key={letter}
                  className={count > 0 ? "remaining-tiles-item" : "remaining-tiles-item empty"}
                  aria-label={`${letter} has ${count} tiles remaining`}
                >
                  <span className="tile remaining-tiles-letter">{letter}</span>
                  <span className="remaining-tiles-count">x{count}</span>
                </div>
              ))}
            </div>
            <div className="button-row">
              <button className="button-secondary" onClick={() => setIsRemainingTilesModalOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
