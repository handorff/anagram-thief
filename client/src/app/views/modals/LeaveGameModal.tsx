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
          This removes you from the current game, and you will not be able to rejoin by reloading.
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
