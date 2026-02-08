import type { ReactNode } from "react";
import type { Player } from "@shared/types";

type Props = {
  isReplayMode: boolean;
  gameOverStandings: {
    players: Player[];
    winningScore: number | null;
  };
  roomReplayStepsLength: number;
  onLeaveRoom: () => void;
  onEnterReplay: () => void;
  replayPanelContent: ReactNode;
};

export function EndedGameView({
  isReplayMode,
  gameOverStandings,
  roomReplayStepsLength,
  onLeaveRoom,
  onEnterReplay,
  replayPanelContent
}: Props) {
  return (
    <div className="panel">
      {!isReplayMode && (
        <>
          <h2>Game Over</h2>
          <p className="muted">Final scores</p>
          <div className="player-list">
            {gameOverStandings.players.map((player) => {
              const isWinner =
                gameOverStandings.winningScore !== null && player.score === gameOverStandings.winningScore;
              return (
                <div key={player.id} className={isWinner ? "player winner" : "player"}>
                  <div>
                    <span>{player.name}</span>
                    {isWinner && <span className="badge winner-badge">winner</span>}
                  </div>
                  <span className="score">{player.score}</span>
                </div>
              );
            })}
          </div>
          <div className="button-row">
            <button className="button-secondary" onClick={onLeaveRoom}>
              Return to lobby
            </button>
            <button onClick={onEnterReplay} disabled={roomReplayStepsLength === 0}>
              Watch replay
            </button>
          </div>
          {roomReplayStepsLength === 0 && <p className="muted">Replay unavailable for this game.</p>}
        </>
      )}
      {replayPanelContent}
    </div>
  );
}
