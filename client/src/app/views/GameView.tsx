import type {
  Dispatch,
  RefObject,
  SetStateAction
} from "react";
import type {
  GameState,
  Player,
  RoomState
} from "@shared/types";
import { WordList } from "../components/WordList";
import type { WordHighlightKind } from "../types";

type SpectatorPreStealPlayer = {
  id: string;
  name: string;
  connected: boolean;
  preStealEntries: GameState["players"][number]["preStealEntries"];
};

type Props = {
  roomState: RoomState;
  gameState: GameState;
  selfPlayerId: string | null;
  isSpectator: boolean;
  endTimerRemaining: number | null;
  formatTime: (seconds: number) => string;
  onFlip: () => void;
  isFlipRevealActive: boolean;
  isTileSelectionEnabled: boolean;
  onClaimTileSelect: (letter: string) => void;
  pendingFlip: GameState["pendingFlip"];
  flipRevealDurationMs: number;
  flipRevealElapsedMs: number;
  flipRevealPlayerName: string;
  claimWindow: GameState["claimWindow"];
  claimProgress: number;
  claimInputRef: RefObject<HTMLInputElement>;
  claimWord: string;
  setClaimWord: Dispatch<SetStateAction<string>>;
  isMyClaimWindow: boolean;
  onClaimSubmit: () => void;
  onClaimIntent: () => void;
  claimPlaceholder: string;
  isClaimInputDisabled: boolean;
  isClaimButtonDisabled: boolean;
  claimButtonLabel: string;
  orderedGamePlayers: Player[];
  claimedWordHighlights: Record<string, WordHighlightKind>;
  setShowLeaveGameConfirm: Dispatch<SetStateAction<boolean>>;
  spectatorPreStealPlayers: SpectatorPreStealPlayer[];
  preStealTriggerInput: string;
  setPreStealTriggerInput: Dispatch<SetStateAction<string>>;
  preStealClaimWordInput: string;
  setPreStealClaimWordInput: Dispatch<SetStateAction<string>>;
  onAddPreStealEntry: () => void;
  myPreStealEntries: GameState["players"][number]["preStealEntries"];
  setPreStealDraggedEntryId: Dispatch<SetStateAction<string | null>>;
  preStealDraggedEntryId: string | null;
  onPreStealEntryDrop: (targetEntryId: string) => void;
  onRemovePreStealEntry: (entryId: string) => void;
};

export function GameView({
  roomState,
  gameState,
  selfPlayerId,
  isSpectator,
  endTimerRemaining,
  formatTime,
  onFlip,
  isFlipRevealActive,
  isTileSelectionEnabled,
  onClaimTileSelect,
  pendingFlip,
  flipRevealDurationMs,
  flipRevealElapsedMs,
  flipRevealPlayerName,
  claimWindow,
  claimProgress,
  claimInputRef,
  claimWord,
  setClaimWord,
  isMyClaimWindow,
  onClaimSubmit,
  onClaimIntent,
  claimPlaceholder,
  isClaimInputDisabled,
  isClaimButtonDisabled,
  claimButtonLabel,
  orderedGamePlayers,
  claimedWordHighlights,
  setShowLeaveGameConfirm,
  spectatorPreStealPlayers,
  preStealTriggerInput,
  setPreStealTriggerInput,
  preStealClaimWordInput,
  setPreStealClaimWordInput,
  onAddPreStealEntry,
  myPreStealEntries,
  setPreStealDraggedEntryId,
  preStealDraggedEntryId,
  onPreStealEntryDrop,
  onRemovePreStealEntry
}: Props) {
  return (
    <div className="game">
      <section className="panel game-board">
        <div className="game-header">
          <div>
            <h2>Center Tiles</h2>
            <p className="muted">Bag: {gameState.bagCount} tiles</p>
            {roomState?.flipTimer.enabled && (
              <p className="muted">Auto flip: {roomState.flipTimer.seconds}s</p>
            )}
          </div>
          <div className="turn">
            <span>Turn:</span>
            <strong>
              {gameState.players.find((p) => p.id === gameState.turnPlayerId)?.name || "Unknown"}
            </strong>
            <button
              onClick={onFlip}
              disabled={isSpectator || gameState.turnPlayerId !== selfPlayerId || isFlipRevealActive}
            >
              Flip Tile
            </button>
          </div>
        </div>

        {endTimerRemaining !== null && (
          <div className="timer">End in {formatTime(endTimerRemaining)}</div>
        )}

        <div className="tiles">
          {gameState.centerTiles.length === 0 && !pendingFlip && (
            <div className="muted">No tiles flipped yet.</div>
          )}
          {gameState.centerTiles.map((tile) => (
            <div
              key={tile.id}
              className={isTileSelectionEnabled ? "tile tile-selectable" : "tile"}
              role={isTileSelectionEnabled ? "button" : undefined}
              tabIndex={isTileSelectionEnabled ? 0 : undefined}
              onClick={
                isTileSelectionEnabled ? () => onClaimTileSelect(tile.letter) : undefined
              }
              onKeyDown={
                isTileSelectionEnabled
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        onClaimTileSelect(tile.letter);
                      }
                    }
                  : undefined
              }
              aria-label={
                isTileSelectionEnabled ? `Use letter ${tile.letter} for claim` : undefined
              }
            >
              {tile.letter}
            </div>
          ))}
          {pendingFlip && (
            <div
              className="tile tile-reveal-card"
              style={{
                animationDuration: `${flipRevealDurationMs}ms`,
                animationDelay: `-${flipRevealElapsedMs}ms`
              }}
              aria-live="polite"
              aria-label={`${flipRevealPlayerName} is revealing the next tile`}
            >
              ?
            </div>
          )}
        </div>

        <div className="claim-box">
          <div
            className={`claim-timer ${claimWindow ? "" : "placeholder"}`}
            role={claimWindow ? "progressbar" : undefined}
            aria-label={claimWindow ? "Claim timer" : undefined}
            aria-valuemin={claimWindow ? 0 : undefined}
            aria-valuemax={claimWindow ? 100 : undefined}
            aria-valuenow={claimWindow ? Math.round(claimProgress * 100) : undefined}
            aria-hidden={!claimWindow}
          >
            <div
              className="claim-progress"
              style={{ width: `${claimWindow ? claimProgress * 100 : 0}%` }}
            />
          </div>
          <div className="claim-input">
            <input
              ref={claimInputRef}
              value={claimWord}
              onChange={(e) => setClaimWord(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (isMyClaimWindow) {
                    onClaimSubmit();
                    return;
                  }
                  onClaimIntent();
                }
              }}
              placeholder={claimPlaceholder}
              disabled={isClaimInputDisabled}
            />
            <button
              onClick={isMyClaimWindow ? onClaimSubmit : onClaimIntent}
              disabled={isClaimButtonDisabled}
            >
              {claimButtonLabel}
            </button>
          </div>
        </div>

        <div className="words board-words">
          {gameState.players.map((player) => (
            <WordList
              key={player.id}
              player={player}
              isSelf={player.id === selfPlayerId}
              highlightedWordIds={claimedWordHighlights}
              onTileLetterSelect={onClaimTileSelect}
            />
          ))}
        </div>
      </section>

      <section className="panel scoreboard">
        <div className="scoreboard-header">
          <h2>Players</h2>
          <button className="button-danger" onClick={() => setShowLeaveGameConfirm(true)}>
            {isSpectator ? "Leave Spectate" : "Leave Game"}
          </button>
        </div>
        <div className="player-list">
          {orderedGamePlayers.map((player) => (
            <div key={player.id} className={player.id === selfPlayerId ? "player you" : "player"}>
              <div>
                <strong>{player.name}</strong>
                {player.id === gameState.turnPlayerId && <span className="badge">turn</span>}
                {!player.connected && <span className="badge">offline</span>}
              </div>
              <span className="score">{player.score}</span>
            </div>
          ))}
        </div>

        {gameState.preStealEnabled && (
          <div className="pre-steal-panel">
            {isSpectator ? (
              <div className="pre-steal-entries-column">
                <div className="word-header">
                  <span>Pre-steal entries</span>
                </div>
                {spectatorPreStealPlayers.map((player) => (
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
                    value={preStealTriggerInput}
                    onChange={(event) => setPreStealTriggerInput(event.target.value)}
                    placeholder="Trigger letters"
                  />
                  <input
                    className="pre-steal-claim-input"
                    value={preStealClaimWordInput}
                    onChange={(event) => setPreStealClaimWordInput(event.target.value)}
                    placeholder="Claim word"
                  />
                  <button
                    className="button-secondary"
                    onClick={onAddPreStealEntry}
                    disabled={!preStealTriggerInput.trim() || !preStealClaimWordInput.trim()}
                  >
                    Add
                  </button>
                </div>

                {myPreStealEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="pre-steal-entry self"
                    draggable
                    onDragStart={(event) => {
                      setPreStealDraggedEntryId(entry.id);
                      event.dataTransfer.setData("text/plain", entry.id);
                    }}
                    onDragEnd={() => setPreStealDraggedEntryId(null)}
                    onDragOver={(event) => {
                      if (!preStealDraggedEntryId) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      onPreStealEntryDrop(entry.id);
                    }}
                  >
                    <span className="pre-steal-entry-text">
                      {entry.triggerLetters}
                      {" -> "}
                      {entry.claimWord}
                    </span>
                    <button className="button-secondary" onClick={() => onRemovePreStealEntry(entry.id)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
