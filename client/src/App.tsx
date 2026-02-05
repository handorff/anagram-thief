import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import type { GameState, Player, RoomState, RoomSummary } from "@shared/types";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";
const SESSION_STORAGE_KEY = "anagram.sessionId";
const PLAYER_NAME_STORAGE_KEY = "anagram.playerName";

function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function readStoredPlayerName() {
  if (typeof window === "undefined") return "";
  try {
    const value = window.localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
    return value ?? "";
  } catch {
    return "";
  }
}

function persistPlayerName(name: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name);
  } catch {
    // Ignore storage failures.
  }
}

function getOrCreateSessionId() {
  if (typeof window === "undefined") return generateId();
  try {
    const existing = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (existing && existing.trim()) {
      return existing.trim();
    }
    const created = generateId();
    window.localStorage.setItem(SESSION_STORAGE_KEY, created);
    return created;
  } catch {
    return generateId();
  }
}

const sessionId = getOrCreateSessionId();
const socket = io(SERVER_URL, { autoConnect: false });
socket.auth = { sessionId };
socket.connect();

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function sanitizeClientName(name: string) {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 24) : "Player";
}

const DEFAULT_FLIP_TIMER_SECONDS = 15;
const MIN_FLIP_TIMER_SECONDS = 1;
const MAX_FLIP_TIMER_SECONDS = 60;
const DEFAULT_CLAIM_TIMER_SECONDS = 3;
const MIN_CLAIM_TIMER_SECONDS = 1;
const MAX_CLAIM_TIMER_SECONDS = 10;

function clampFlipTimerSeconds(value: number) {
  const rounded = Math.round(value);
  if (Number.isNaN(rounded)) return DEFAULT_FLIP_TIMER_SECONDS;
  return Math.min(MAX_FLIP_TIMER_SECONDS, Math.max(MIN_FLIP_TIMER_SECONDS, rounded));
}

function clampClaimTimerSeconds(value: number) {
  const rounded = Math.round(value);
  if (Number.isNaN(rounded)) return DEFAULT_CLAIM_TIMER_SECONDS;
  return Math.min(MAX_CLAIM_TIMER_SECONDS, Math.max(MIN_CLAIM_TIMER_SECONDS, rounded));
}

export default function App() {
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [selfPlayerId, setSelfPlayerId] = useState<string | null>(null);
  const [roomList, setRoomList] = useState<RoomSummary[]>([]);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [playerName, setPlayerName] = useState(() => readStoredPlayerName());
  const [nameDraft, setNameDraft] = useState(() => readStoredPlayerName());
  const [editNameDraft, setEditNameDraft] = useState("");
  const [isEditingName, setIsEditingName] = useState(false);
  const [lobbyView, setLobbyView] = useState<"list" | "create">("list");
  const [joinPrompt, setJoinPrompt] = useState<{ roomId: string; roomName: string } | null>(null);

  const [createRoomName, setCreateRoomName] = useState("");
  const [createPublic, setCreatePublic] = useState(true);
  const [createMaxPlayers, setCreateMaxPlayers] = useState(8);
  const [createFlipTimerEnabled, setCreateFlipTimerEnabled] = useState(false);
  const [createFlipTimerSeconds, setCreateFlipTimerSeconds] = useState(DEFAULT_FLIP_TIMER_SECONDS);
  const [createClaimTimerSeconds, setCreateClaimTimerSeconds] = useState(DEFAULT_CLAIM_TIMER_SECONDS);

  const [joinCode, setJoinCode] = useState("");

  const [claimWord, setClaimWord] = useState("");
  const claimInputRef = useRef<HTMLInputElement>(null);

  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const onConnect = () => {
      setIsConnected(true);
      socket.emit("room:list");
    };
    const onDisconnect = () => setIsConnected(false);
    const onRoomList = (rooms: RoomSummary[]) => setRoomList(rooms);
    const onRoomState = (state: RoomState) => setRoomState(state);
    const onGameState = (state: GameState) => setGameState(state);
    const onError = ({ message }: { message: string }) => setError(message);
    const onSessionSelf = ({
      playerId,
      name
    }: {
      playerId: string;
      name: string;
      roomId: string | null;
    }) => {
      setSelfPlayerId(playerId);
      if (playerName.trim()) {
        const sanitizedLocalName = sanitizeClientName(playerName);
        if (sanitizedLocalName !== playerName) {
          setPlayerName(sanitizedLocalName);
          setNameDraft(sanitizedLocalName);
          setEditNameDraft(sanitizedLocalName);
          persistPlayerName(sanitizedLocalName);
        }
        if (sanitizedLocalName !== name) {
          socket.emit("session:update-name", { name: sanitizedLocalName });
        }
        return;
      }
      const resolvedName = sanitizeClientName(name);
      if (resolvedName === "Player") return;
      setPlayerName(resolvedName);
      setNameDraft(resolvedName);
      setEditNameDraft(resolvedName);
      persistPlayerName(resolvedName);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:list", onRoomList);
    socket.on("room:state", onRoomState);
    socket.on("game:state", onGameState);
    socket.on("session:self", onSessionSelf);
    socket.on("error", onError);

    if (socket.connected) {
      onConnect();
    }

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:list", onRoomList);
      socket.off("room:state", onRoomState);
      socket.off("game:state", onGameState);
      socket.off("session:self", onSessionSelf);
      socket.off("error", onError);
    };
  }, [playerName]);

  const currentPlayers: Player[] = useMemo(() => {
    if (gameState) return gameState.players;
    if (roomState) return roomState.players;
    return [];
  }, [gameState, roomState]);

  const lobbyRooms = useMemo(() => roomList.filter((room) => room.status === "lobby"), [roomList]);

  const endTimerRemaining = useMemo(() => {
    if (!gameState?.endTimerEndsAt) return null;
    const remaining = Math.max(0, Math.ceil((gameState.endTimerEndsAt - now) / 1000));
    return remaining;
  }, [gameState?.endTimerEndsAt, now]);

  const isHost = roomState?.hostId === selfPlayerId;
  const isInGame = roomState?.status === "in-game" && gameState;
  const claimWindow = gameState?.claimWindow ?? null;
  const isMyClaimWindow = claimWindow?.playerId === selfPlayerId;
  const claimTimerSeconds = roomState?.claimTimer.seconds ?? DEFAULT_CLAIM_TIMER_SECONDS;
  const claimWindowRemainingMs = useMemo(() => {
    if (!claimWindow) return null;
    return Math.max(0, claimWindow.endsAt - now);
  }, [claimWindow, now]);
  const claimWindowRemainingSeconds =
    claimWindowRemainingMs === null ? null : Math.max(0, Math.ceil(claimWindowRemainingMs / 1000));
  const claimProgress =
    claimWindowRemainingMs === null
      ? 0
      : Math.max(
          0,
          Math.min(1, claimWindowRemainingMs / (claimTimerSeconds * 1000))
        );
  const claimCooldownEndsAt = selfPlayerId ? gameState?.claimCooldowns?.[selfPlayerId] : null;
  const claimCooldownRemainingMs =
    claimCooldownEndsAt && claimCooldownEndsAt > now ? claimCooldownEndsAt - now : null;
  const claimCooldownRemainingSeconds =
    claimCooldownRemainingMs === null ? null : Math.max(0, Math.ceil(claimCooldownRemainingMs / 1000));
  const isClaimCooldownActive = claimCooldownRemainingMs !== null;
  const claimWindowPlayerName = useMemo(() => {
    if (!claimWindow || !gameState) return "Unknown";
    return gameState.players.find((player) => player.id === claimWindow.playerId)?.name ?? "Unknown";
  }, [claimWindow, gameState]);
  const claimStatus = useMemo(() => {
    if (claimWindow && claimWindowRemainingSeconds !== null) {
      if (isMyClaimWindow) {
        return `Your claim window: ${claimWindowRemainingSeconds}s`;
      }
      return `${claimWindowPlayerName} is claiming (${claimWindowRemainingSeconds}s)`;
    }
    if (isClaimCooldownActive && claimCooldownRemainingSeconds !== null) {
      return `Cooldown: ${claimCooldownRemainingSeconds}s or next flip.`;
    }
    return "Press enter to claim a word";
  }, [
    claimWindow,
    claimWindowRemainingSeconds,
    isMyClaimWindow,
    claimWindowPlayerName,
    isClaimCooldownActive,
    claimCooldownRemainingSeconds
  ]);
  const claimPlaceholder = claimStatus;
  const claimButtonLabel = isMyClaimWindow ? "Submit Claim" : "Start Claim";
  const isClaimButtonDisabled = isMyClaimWindow
    ? !claimWord.trim()
    : Boolean(claimWindow) || isClaimCooldownActive;
  const isClaimInputDisabled = (Boolean(claimWindow) && !isMyClaimWindow) || isClaimCooldownActive;

  const handleCreate = () => {
    if (!playerName) return;
    const flipTimerSeconds = clampFlipTimerSeconds(createFlipTimerSeconds);
    const claimTimerSeconds = clampClaimTimerSeconds(createClaimTimerSeconds);
    socket.emit("room:create", {
      roomName: createRoomName,
      playerName,
      isPublic: createPublic,
      maxPlayers: createMaxPlayers,
      flipTimerEnabled: createFlipTimerEnabled,
      flipTimerSeconds,
      claimTimerSeconds
    });
  };

  const handleJoinRoom = (room: RoomSummary) => {
    if (!playerName) return;
    if (room.status !== "lobby") return;
    if (room.playerCount >= room.maxPlayers) return;
    if (room.isPublic) {
      socket.emit("room:join", {
        roomId: room.id,
        name: playerName
      });
      return;
    }
    setJoinCode("");
    setJoinPrompt({ roomId: room.id, roomName: room.name });
  };

  const handleJoinWithCode = () => {
    if (!playerName || !joinPrompt) return;
    socket.emit("room:join", {
      roomId: joinPrompt.roomId,
      name: playerName,
      code: joinCode.trim() || undefined
    });
  };

  const handleStart = () => {
    if (!roomState) return;
    socket.emit("room:start", { roomId: roomState.id });
  };

  const handleLeaveRoom = () => {
    if (!roomState) return;
    socket.emit("room:leave");
    setRoomState(null);
    setGameState(null);
  };

  const handleConfirmName = () => {
    const resolvedName = sanitizeClientName(nameDraft);
    setPlayerName(resolvedName);
    setNameDraft(resolvedName);
    setEditNameDraft(resolvedName);
    persistPlayerName(resolvedName);
    socket.emit("session:update-name", { name: resolvedName });
  };

  const roomId = roomState?.id ?? null;

  const handleStartEditName = () => {
    setEditNameDraft(playerName);
    setIsEditingName(true);
  };

  const handleSaveEditName = () => {
    const resolvedName = sanitizeClientName(editNameDraft);
    setPlayerName(resolvedName);
    setNameDraft(resolvedName);
    setIsEditingName(false);
    persistPlayerName(resolvedName);
    socket.emit("session:update-name", { name: resolvedName });
    if (roomId) {
      socket.emit("player:update-name", { name: resolvedName });
    }
  };

  const handleCancelEditName = () => {
    setEditNameDraft(playerName);
    setIsEditingName(false);
  };

  const handleFlip = useCallback(() => {
    if (!roomId) return;
    socket.emit("game:flip", { roomId });
  }, [roomId]);

  const handleClaimIntent = useCallback(() => {
    if (!roomId) return;
    if (claimWindow || isClaimCooldownActive) return;
    claimInputRef.current?.focus();
    socket.emit("game:claim-intent", { roomId });
  }, [roomId, claimWindow, isClaimCooldownActive]);

  const handleClaimSubmit = useCallback(() => {
    if (!roomState) return;
    if (!isMyClaimWindow) return;
    if (!claimWord.trim()) return;
    socket.emit("game:claim", {
      roomId: roomState.id,
      word: claimWord
    });
    setClaimWord("");
    requestAnimationFrame(() => claimInputRef.current?.focus());
  }, [roomState, isMyClaimWindow, claimWord]);

  useEffect(() => {
    if (!isMyClaimWindow) {
      setClaimWord("");
      return;
    }
    requestAnimationFrame(() => claimInputRef.current?.focus());
  }, [isMyClaimWindow]);

  useEffect(() => {
    if (roomState) {
      setJoinPrompt(null);
      return;
    }
    setLobbyView("list");
  }, [roomState]);

  useEffect(() => {
    if (!isInGame) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat) return;
      const target = event.target as HTMLElement | null;
      const isEditableTarget =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      const isSpace = event.code === "Space" || event.key === " " || event.key === "Spacebar";
      if (isSpace) {
        if (gameState?.turnPlayerId !== selfPlayerId) return;
        event.preventDefault();
        handleFlip();
        return;
      }

      if (event.key === "Enter" && !isEditableTarget) {
        if (isMyClaimWindow) {
          claimInputRef.current?.focus();
          return;
        }
        if (claimWindow || isClaimCooldownActive) {
          return;
        }
        event.preventDefault();
        handleClaimIntent();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    handleFlip,
    handleClaimIntent,
    isInGame,
    gameState?.turnPlayerId,
    selfPlayerId,
    isMyClaimWindow,
    claimWindow,
    isClaimCooldownActive
  ]);

  if (!playerName) {
    return (
      <div className="name-gate">
        <div className="name-card">
          <h1>Choose your name</h1>
          <p className="muted">This is how other players will see you.</p>
          <input
            className="name-input"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing && nameDraft.trim()) {
                e.preventDefault();
                handleConfirmName();
              }
            }}
            placeholder="Type your name"
            autoFocus
          />
          <button onClick={handleConfirmName} disabled={!nameDraft.trim()}>
            Enter Lobby
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1>Anagram Thief</h1>
        </div>
        <div className="status">
          <div className="status-identity">
            {isEditingName ? (
              <>
                <input
                  className="status-name-input"
                  value={editNameDraft}
                  onChange={(event) => setEditNameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      handleSaveEditName();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      handleCancelEditName();
                    }
                  }}
                  aria-label="Edit display name"
                />
                <button
                  className="status-button"
                  onClick={handleSaveEditName}
                  disabled={!editNameDraft.trim()}
                >
                  Save
                </button>
                <button className="status-button ghost" onClick={handleCancelEditName}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span className="status-name">{playerName}</span>
                <button className="icon-button" onClick={handleStartEditName} aria-label="Edit name">
                  ✎
                </button>
              </>
            )}
          </div>
          <div className="status-connection">
            <span className={isConnected ? "dot online" : "dot"} />
            {isConnected ? "Connected" : "Connecting"}
          </div>
        </div>
      </header>

      {error && (
        <div className="banner">
          <span>{error}</span>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {!roomState && lobbyView === "list" && (
        <div className="grid">
          <section className="panel panel-narrow">
            <h2>Open Games</h2>
            <div className="room-list">
              {lobbyRooms.length === 0 && <p className="muted">No open games yet.</p>}
              {lobbyRooms.map((room) => {
                const isFull = room.playerCount >= room.maxPlayers;
                return (
                  <div key={room.id} className="room-card">
                    <div>
                      <strong>{room.name}</strong>
                      <div className="muted">
                        {room.playerCount} / {room.maxPlayers} • {room.isPublic ? "public" : "private"}
                      </div>
                    </div>
                    <button onClick={() => handleJoinRoom(room)} disabled={isFull}>
                      {isFull ? "Full" : "Join"}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="button-row">
              <button onClick={() => setLobbyView("create")}>Create new game</button>
            </div>
          </section>
        </div>
      )}

      {!roomState && lobbyView === "create" && (
        <div className="grid">
          <section className="panel panel-narrow">
            <h2>New Game</h2>
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
            <label className="row">
              <span>Flip timer</span>
              <input
                type="checkbox"
                checked={createFlipTimerEnabled}
                onChange={(e) => setCreateFlipTimerEnabled(e.target.checked)}
              />
            </label>
            <label>
              Flip timer seconds (1-60)
              <input
                type="number"
                min={MIN_FLIP_TIMER_SECONDS}
                max={MAX_FLIP_TIMER_SECONDS}
                value={createFlipTimerSeconds}
                onChange={(e) => setCreateFlipTimerSeconds(Number(e.target.value))}
                onBlur={() =>
                  setCreateFlipTimerSeconds((current) => clampFlipTimerSeconds(current))
                }
                disabled={!createFlipTimerEnabled}
              />
            </label>
            <label>
              Claim timer seconds (1-10)
              <input
                type="number"
                min={MIN_CLAIM_TIMER_SECONDS}
                max={MAX_CLAIM_TIMER_SECONDS}
                value={createClaimTimerSeconds}
                onChange={(e) => setCreateClaimTimerSeconds(Number(e.target.value))}
                onBlur={() =>
                  setCreateClaimTimerSeconds((current) => clampClaimTimerSeconds(current))
                }
              />
            </label>
            <div className="button-row">
              <button className="button-secondary" onClick={() => setLobbyView("list")}>
                Back to games
              </button>
              <button onClick={handleCreate}>Create game</button>
            </div>
          </section>

        </div>
      )}

      {roomState && roomState.status === "lobby" && (
        <div className="grid">
          <section className="panel">
            <h2>Lobby</h2>
            <p className="muted">Room ID: {roomState.id}</p>
            <p className="muted">
              Flip timer: {roomState.flipTimer.enabled ? `${roomState.flipTimer.seconds}s` : "off"}
            </p>
            <p className="muted">Claim timer: {roomState.claimTimer.seconds}s</p>
            {!roomState.isPublic && roomState.code && <p className="muted">Code: {roomState.code}</p>}
            <div className="player-list">
              {currentPlayers.map((player) => (
                <div key={player.id} className={player.id === selfPlayerId ? "player you" : "player"}>
                  <span>{player.name}</span>
                  {!player.connected && <span className="badge">offline</span>}
                  {player.id === roomState.hostId && <span className="badge">host</span>}
                </div>
              ))}
            </div>
            <div className="button-row">
              <button className="button-secondary" onClick={handleLeaveRoom}>
                Back to lobby
              </button>
              {isHost && <button onClick={handleStart}>Start Game</button>}
            </div>
          </section>

          <section className="panel">
            <h2>How to Play</h2>
            <ul>
              <li>Flip one tile on your turn.</li>
              <li>Press Enter to start a claim using center tiles.</li>
              <li>Steals are automatic when possible.</li>
              <li>Steals must rearrange letters (no substring extensions).</li>
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
                {roomState?.flipTimer.enabled && (
                  <p className="muted">Auto flip: {roomState.flipTimer.seconds}s</p>
                )}
              </div>
              <div className="turn">
                <span>Turn:</span>
                <strong>
                  {gameState.players.find((p) => p.id === gameState.turnPlayerId)?.name || "Unknown"}
                </strong>
                <button onClick={handleFlip} disabled={gameState.turnPlayerId !== selfPlayerId}>
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
              {claimWindow && (
                <div
                  className="claim-timer"
                  role="progressbar"
                  aria-label="Claim timer"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(claimProgress * 100)}
                >
                  <div className="claim-progress" style={{ width: `${claimProgress * 100}%` }} />
                </div>
              )}
              <div className="claim-input">
                <input
                  ref={claimInputRef}
                  value={claimWord}
                  onChange={(e) => setClaimWord(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      if (isMyClaimWindow) {
                        handleClaimSubmit();
                        return;
                      }
                      handleClaimIntent();
                    }
                  }}
                  placeholder={claimPlaceholder}
                  disabled={isClaimInputDisabled}
                />
                <button
                  onClick={isMyClaimWindow ? handleClaimSubmit : handleClaimIntent}
                  disabled={isClaimButtonDisabled}
                >
                  {claimButtonLabel}
                </button>
              </div>
            </div>
          </section>

          <section className="panel scoreboard">
            <h2>Players</h2>
            <div className="player-list">
              {gameState.players.map((player) => (
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

      {joinPrompt && (
        <div className="join-overlay">
          <div className="panel join-modal">
            <h2>Enter room code</h2>
            <p className="muted">{joinPrompt.roomName} is private.</p>
            <input
              type="password"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing && joinCode.trim()) {
                  e.preventDefault();
                  handleJoinWithCode();
                }
              }}
              placeholder="Room code"
            />
            <div className="button-row">
              <button
                className="button-secondary"
                onClick={() => {
                  setJoinPrompt(null);
                  setJoinCode("");
                }}
              >
                Cancel
              </button>
              <button onClick={handleJoinWithCode} disabled={!joinCode.trim()}>
                Join game
              </button>
            </div>
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
