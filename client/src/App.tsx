import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import type { GameState, Player, RoomState, RoomSummary } from "@shared/types";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";
const socket = io(SERVER_URL, { autoConnect: true });

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function App() {
  const [socketId, setSocketId] = useState<string | null>(null);
  const [roomList, setRoomList] = useState<RoomSummary[]>([]);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [createRoomName, setCreateRoomName] = useState("");
  const [createPlayerName, setCreatePlayerName] = useState("");
  const [createPublic, setCreatePublic] = useState(true);
  const [createMaxPlayers, setCreateMaxPlayers] = useState(8);

  const [joinName, setJoinName] = useState("");
  const [joinRoomId, setJoinRoomId] = useState("");
  const [joinCode, setJoinCode] = useState("");

  const [claimWord, setClaimWord] = useState("");

  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const onConnect = () => setSocketId(socket.id ?? null);
    const onDisconnect = () => setSocketId(null);
    const onRoomList = (rooms: RoomSummary[]) => setRoomList(rooms);
    const onRoomState = (state: RoomState) => setRoomState(state);
    const onGameState = (state: GameState) => setGameState(state);
    const onError = ({ message }: { message: string }) => setError(message);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:list", onRoomList);
    socket.on("room:state", onRoomState);
    socket.on("game:state", onGameState);
    socket.on("error", onError);

    socket.emit("room:list");

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:list", onRoomList);
      socket.off("room:state", onRoomState);
      socket.off("game:state", onGameState);
      socket.off("error", onError);
    };
  }, []);

  const currentPlayers: Player[] = useMemo(() => {
    if (gameState) return gameState.players;
    if (roomState) return roomState.players;
    return [];
  }, [gameState, roomState]);

  const endTimerRemaining = useMemo(() => {
    if (!gameState?.endTimerEndsAt) return null;
    const remaining = Math.max(0, Math.ceil((gameState.endTimerEndsAt - now) / 1000));
    return remaining;
  }, [gameState?.endTimerEndsAt, now]);

  const isHost = roomState?.hostId === socketId;
  const isInGame = roomState?.status === "in-game" && gameState;

  const handleCreate = () => {
    socket.emit("room:create", {
      roomName: createRoomName,
      playerName: createPlayerName,
      isPublic: createPublic,
      maxPlayers: createMaxPlayers
    });
  };

  const handleJoin = () => {
    socket.emit("room:join", {
      roomId: joinRoomId.trim(),
      name: joinName || "Player",
      code: joinCode.trim() || undefined
    });
  };

  const handleStart = () => {
    if (!roomState) return;
    socket.emit("room:start", { roomId: roomState.id });
  };

  const handleFlip = () => {
    if (!roomState) return;
    socket.emit("game:flip", { roomId: roomState.id });
  };

  const handleClaim = () => {
    if (!roomState) return;
    if (!claimWord.trim()) return;
    socket.emit("game:claim", {
      roomId: roomState.id,
      word: claimWord
    });
    setClaimWord("");
  };

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1>Anagram Thief</h1>
          <p className="subtitle">Steal words in real-time. Flip one tile per turn.</p>
        </div>
        <div className="status">
          <span className={socketId ? "dot online" : "dot"} />
          {socketId ? "Connected" : "Connecting"}
        </div>
      </header>

      {error && (
        <div className="banner">
          <span>{error}</span>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {!roomState && (
        <div className="grid">
          <section className="panel">
            <h2>Create Room</h2>
            <label>
              Your name
              <input
                value={createPlayerName}
                onChange={(e) => setCreatePlayerName(e.target.value)}
                placeholder="Player name"
              />
            </label>
            <label>
              Room name
              <input
                value={createRoomName}
                onChange={(e) => setCreateRoomName(e.target.value)}
                placeholder="Friday Night"
              />
            </label>
            <label className="row">
              <span>Public room</span>
              <input
                type="checkbox"
                checked={createPublic}
                onChange={(e) => setCreatePublic(e.target.checked)}
              />
            </label>
            <label>
              Max players (2-8)
              <input
                type="number"
                min={2}
                max={8}
                value={createMaxPlayers}
                onChange={(e) => setCreateMaxPlayers(Number(e.target.value))}
              />
            </label>
            <button onClick={handleCreate}>Create</button>
          </section>

          <section className="panel">
            <h2>Join Room</h2>
            <label>
              Your name
              <input value={joinName} onChange={(e) => setJoinName(e.target.value)} placeholder="Player name" />
            </label>
            <label>
              Room ID
              <input value={joinRoomId} onChange={(e) => setJoinRoomId(e.target.value)} placeholder="Room ID" />
            </label>
            <label>
              Room code (private)
              <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="Code" />
            </label>
            <button onClick={handleJoin}>Join</button>
          </section>

          <section className="panel">
            <h2>Public Rooms</h2>
            <div className="room-list">
              {roomList.length === 0 && <p className="muted">No public rooms yet.</p>}
              {roomList.map((room) => (
                <div key={room.id} className="room-card">
                  <div>
                    <strong>{room.name}</strong>
                    <div className="muted">
                      {room.playerCount} / {room.maxPlayers} • {room.status}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setJoinRoomId(room.id);
                    }}
                  >
                    Use ID
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {roomState && roomState.status === "lobby" && (
        <div className="grid">
          <section className="panel">
            <h2>Lobby</h2>
            <p className="muted">Room ID: {roomState.id}</p>
            {!roomState.isPublic && roomState.code && <p className="muted">Code: {roomState.code}</p>}
            <div className="player-list">
              {currentPlayers.map((player) => (
                <div key={player.id} className={player.id === socketId ? "player you" : "player"}>
                  <span>{player.name}</span>
                  {!player.connected && <span className="badge">offline</span>}
                  {player.id === roomState.hostId && <span className="badge">host</span>}
                </div>
              ))}
            </div>
            {isHost && <button onClick={handleStart}>Start Game</button>}
          </section>

          <section className="panel">
            <h2>How to Play</h2>
            <ul>
              <li>Flip one tile on your turn.</li>
              <li>Claim words any time using center tiles.</li>
              <li>Steals are automatic when possible.</li>
              <li>Game ends 60s after bag is empty.</li>
            </ul>
          </section>
        </div>
      )}

      {isInGame && gameState && (
        <div className="game">
          <section className="panel game-board">
            <div className="game-header">
              <div>
                <h2>Center Tiles</h2>
                <p className="muted">Bag: {gameState.bagCount} tiles</p>
              </div>
              <div className="turn">
                <span>Turn:</span>
                <strong>
                  {gameState.players.find((p) => p.id === gameState.turnPlayerId)?.name || "Unknown"}
                </strong>
                <button onClick={handleFlip} disabled={gameState.turnPlayerId !== socketId}>
                  Flip Tile
                </button>
              </div>
            </div>

            {endTimerRemaining !== null && (
              <div className="timer">End in {formatTime(endTimerRemaining)}</div>
            )}

            <div className="tiles">
              {gameState.centerTiles.length === 0 && <div className="muted">No tiles flipped yet.</div>}
              {gameState.centerTiles.map((tile) => (
                <div key={tile.id} className="tile">
                  {tile.letter}
                </div>
              ))}
            </div>

            <div className="claim-box">
              <div className="claim-header">
                <h3>Claim a Word</h3>
                <div className="muted">Steals are detected automatically.</div>
              </div>
              <div className="claim-input">
                <input
                  value={claimWord}
                  onChange={(e) => setClaimWord(e.target.value)}
                  placeholder="Enter word"
                />
                <button onClick={handleClaim} disabled={!claimWord.trim()}>
                  Claim
                </button>
              </div>
            </div>
          </section>

          <section className="panel scoreboard">
            <h2>Players</h2>
            <div className="player-list">
              {gameState.players.map((player) => (
                <div key={player.id} className={player.id === socketId ? "player you" : "player"}>
                  <div>
                    <strong>{player.name}</strong>
                    {player.id === gameState.turnPlayerId && <span className="badge">turn</span>}
                    {!player.connected && <span className="badge">offline</span>}
                  </div>
                  <span className="score">{player.score}</span>
                </div>
              ))}
            </div>

            <div className="words">
              {gameState.players.map((player) => (
                <WordList key={player.id} player={player} />
              ))}
            </div>
          </section>
        </div>
      )}

      {roomState?.status === "ended" && gameState && (
        <div className="panel">
          <h2>Game Over</h2>
          <p className="muted">Final scores</p>
          <div className="player-list">
            {gameState.players
              .slice()
              .sort((a, b) => b.score - a.score)
              .map((player) => (
                <div key={player.id} className="player">
                  <span>{player.name}</span>
                  <span className="score">{player.score}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WordList({ player }: { player: Player }) {
  return (
    <div className="word-list">
      <div className="word-header">
        <span>{player.name}'s words</span>
        <span className="muted">{player.words.length}</span>
      </div>
      {player.words.length === 0 && <div className="muted">No words yet.</div>}
      {player.words.map((word) => (
        <div key={word.id} className="word-item">
          <span>{word.text}</span>
        </div>
      ))}
    </div>
  );
}
