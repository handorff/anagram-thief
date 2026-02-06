export type RoomStatus = "lobby" | "in-game" | "ended";

export interface FlipTimerSettings {
  enabled: boolean;
  seconds: number;
}

export interface ClaimTimerSettings {
  seconds: number;
}

export interface Tile {
  id: string;
  letter: string;
}

export interface Word {
  id: string;
  text: string;
  tileIds: string[];
  ownerId: string;
  createdAt: number;
}

export interface Player {
  id: string;
  name: string;
  connected: boolean;
  words: Word[];
  score: number;
}

export interface RoomSummary {
  id: string;
  name: string;
  isPublic: boolean;
  playerCount: number;
  maxPlayers: number;
  status: RoomStatus;
}

export interface RoomState {
  id: string;
  name: string;
  isPublic: boolean;
  code?: string;
  hostId: string;
  players: Player[];
  status: RoomStatus;
  createdAt: number;
  flipTimer: FlipTimerSettings;
  claimTimer: ClaimTimerSettings;
}

export interface ClaimWindowState {
  playerId: string;
  endsAt: number;
}

export interface PendingFlipState {
  playerId: string;
  startedAt: number;
  revealsAt: number;
}

export interface GameState {
  roomId: string;
  status: "in-game" | "ended";
  bagCount: number;
  centerTiles: Tile[];
  players: Player[];
  turnPlayerId: string;
  lastClaimAt: number | null;
  endTimerEndsAt?: number;
  claimWindow: ClaimWindowState | null;
  claimCooldowns: Record<string, number>;
  pendingFlip: PendingFlipState | null;
}
