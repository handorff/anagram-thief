import type { ReplayPlayerSnapshot } from "@shared/types";

export function ReplayWordList({ player }: { player: ReplayPlayerSnapshot }) {
  return (
    <div className="word-list">
      <div className="word-header">
        <span>{player.name}'s words</span>
        <span className="muted">{player.words.length}</span>
      </div>
      {player.words.length === 0 && <div className="muted">No words yet.</div>}
      {player.words.map((word) => (
        <div key={word.id} className="word-item">
          <div className="word-tiles" aria-label={word.text}>
            {word.text.split("").map((letter, index) => (
              <div key={`${word.id}-${index}`} className="tile word-tile">
                {letter.toUpperCase()}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
