type Props = {
  onStay: () => void;
  onLeave: () => void;
};

export function LeaveGameModal({ onStay, onLeave }: Props) {
  return (
    <div className="join-overlay">
      <div className="panel join-modal leave-confirm-modal">
        <h2>Leave this game?</h2>
        <p className="muted">
          If you leave this game, you won't be able to rejoin.
        </p>
        <div className="button-row">
          <button className="button-secondary" onClick={onStay}>
            Stay in game
          </button>
          <button className="button-danger" onClick={onLeave}>
            Leave game
          </button>
        </div>
      </div>
    </div>
  );
}
