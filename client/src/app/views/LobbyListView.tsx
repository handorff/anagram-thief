import type { RoomSummary } from "@shared/types";

type Props = {
  openLobbyRooms: RoomSummary[];
  inProgressLobbyRooms: RoomSummary[];
  lobbyError: string | null;
  importReplayError: string | null;
  onJoinRoom: (room: RoomSummary) => void;
  onSpectateRoom: (room: RoomSummary) => void;
  onCreateNewGame: () => void;
  onStartPractice: () => void;
  onOpenPracticeEditor: () => void;
  onOpenReplayImport: () => void;
};

export function LobbyListView({
  openLobbyRooms,
  inProgressLobbyRooms,
  lobbyError,
  importReplayError,
  onJoinRoom,
  onSpectateRoom,
  onCreateNewGame,
  onStartPractice,
  onOpenPracticeEditor,
  onOpenReplayImport
}: Props) {
  return (
    <div className="grid lobby-grid">
      <section className="panel">
        <h2>Open Games</h2>
        <div className="room-list">
          {openLobbyRooms.length === 0 && <p className="muted">No open games yet.</p>}
          {openLobbyRooms.map((room) => {
            const isFull = room.playerCount >= room.maxPlayers;
            return (
              <div key={room.id} className="room-card">
                <div>
                  <strong>{room.name}</strong>
                  <div className="muted">
                    {room.playerCount} / {room.maxPlayers} • {room.isPublic ? "public" : "private"}
                  </div>
                </div>
                <button onClick={() => onJoinRoom(room)} disabled={isFull}>
                  {isFull ? "Full" : "Join"}
                </button>
              </div>
            );
          })}
        </div>
        <div className="button-row">
          <button onClick={onCreateNewGame}>Create new game</button>
        </div>
      </section>

      <section className="panel">
        <h2>Games in Progress</h2>
        <div className="room-list">
          {inProgressLobbyRooms.length === 0 && <p className="muted">No games in progress.</p>}
          {inProgressLobbyRooms.map((room) => (
            <div key={room.id} className="room-card">
              <div>
                <strong>{room.name}</strong>
                <div className="muted">
                  {room.playerCount} / {room.maxPlayers} • in progress
                </div>
              </div>
              <button className="button-secondary" onClick={() => onSpectateRoom(room)}>
                Spectate
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Puzzle Mode</h2>
        <p className="muted">
          Train solo on one puzzle at a time. Submit your best play, then review every possible claim
          and score.
        </p>
        {lobbyError && (
          <div className="practice-editor-error" role="alert">
            {lobbyError}
          </div>
        )}
        <div className="button-row">
          <button onClick={onStartPractice}>Start puzzle mode</button>
          <button className="button-secondary" onClick={onOpenPracticeEditor}>
            Create custom puzzle
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Replays</h2>
        <p className="muted">Import a replay file to review a completed game step-by-step.</p>
        <div className="button-row">
          <button className="button-secondary" onClick={onOpenReplayImport}>
            Import replay
          </button>
        </div>
        {importReplayError && (
          <div className="replay-import-error" role="alert">
            {importReplayError}
          </div>
        )}
      </section>
    </div>
  );
}
