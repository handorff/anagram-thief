import assert from "node:assert/strict";
import test from "node:test";
import type { Player, RoomState } from "../../shared/types.js";
import { buildAdminGameSummary, createAdminSessionToken, verifyAdminSessionToken } from "./index.js";

function makePlayer(id: string, name: string, connected: boolean): Player {
  return {
    id,
    name,
    connected,
    words: [],
    preStealEntries: [],
    score: 0
  };
}

function makeRoom(overrides: Partial<RoomState> = {}): RoomState {
  return {
    id: overrides.id ?? "room-1",
    name: overrides.name ?? "Room",
    isPublic: overrides.isPublic ?? false,
    code: overrides.code,
    hostId: overrides.hostId ?? "p-1",
    players: overrides.players ?? [makePlayer("p-1", "Alice", true)],
    spectators: overrides.spectators ?? [],
    status: overrides.status ?? "in-game",
    createdAt: overrides.createdAt ?? Date.now(),
    flipTimer: overrides.flipTimer ?? { enabled: false, seconds: 15 },
    claimTimer: overrides.claimTimer ?? { seconds: 3 },
    preSteal: overrides.preSteal ?? { enabled: false }
  };
}

test("admin session tokens are signed and expire", () => {
  process.env.ADMIN_MODE_TOKEN = "test-admin-token";
  process.env.ADMIN_SESSION_SIGNING_SECRET = "test-admin-signing-secret";
  process.env.ADMIN_SESSION_TTL_SECONDS = "120";

  const issuedAtMs = Date.now();
  const session = createAdminSessionToken(issuedAtMs);

  assert.equal(typeof session.token, "string");
  assert.ok(session.token.includes("."));
  assert.equal(session.expiresAt > issuedAtMs, true);

  const verified = verifyAdminSessionToken(session.token, issuedAtMs + 1_000);
  assert.ok(verified);

  const tampered = `${session.token.slice(0, -1)}x`;
  assert.equal(verifyAdminSessionToken(tampered, issuedAtMs + 1_000), null);

  const expiredAt = session.expiresAt + 1;
  assert.equal(verifyAdminSessionToken(session.token, expiredAt), null);
});

test("buildAdminGameSummary flags private rooms, offline players, and stuck games", () => {
  const now = Date.now();
  const room = makeRoom({
    id: "room-private",
    name: "Private Match",
    isPublic: false,
    players: [makePlayer("p-1", "Alice", false), makePlayer("p-2", "Bob", false)],
    spectators: [{ id: "s-1", name: "Spec", connected: true }],
    status: "in-game",
    createdAt: now - 20 * 60_000
  });

  const game = {
    roomId: room.id,
    status: "in-game" as const,
    lastActivityAt: now - 11 * 60_000,
    bag: [{ id: "tile-1", letter: "A" }],
    centerTiles: [{ id: "tile-2", letter: "B" }],
    turnPlayerId: "p-1",
    claimWindow: { playerId: "p-1", endsAt: now + 2_000, token: "token" },
    pendingFlip: { playerId: "p-2", startedAt: now, revealsAt: now + 1_000, token: "pending" },
    endTimerEndsAt: now + 60_000
  };

  const summary = buildAdminGameSummary(room, game as any, now, 10 * 60_000);

  assert.equal(summary.roomId, room.id);
  assert.equal(summary.isPublic, false);
  assert.equal(summary.onlinePlayerCount, 0);
  assert.equal(summary.offlinePlayerCount, 2);
  assert.equal(summary.allPlayersOffline, true);
  assert.equal(summary.players.length, 2);
  assert.equal(summary.players[0]?.name, "Alice");
  assert.equal(summary.players[0]?.connected, false);
  assert.equal(summary.spectatorCount, 1);
  assert.equal(summary.onlineSpectatorCount, 1);
  assert.equal(summary.spectators.length, 1);
  assert.equal(summary.spectators[0]?.name, "Spec");
  assert.equal(summary.spectators[0]?.connected, true);
  assert.equal(summary.hasLiveGame, true);
  assert.equal(summary.bagCount, 1);
  assert.equal(summary.centerTileCount, 1);
  assert.equal(summary.stuck, true);
});

test("buildAdminGameSummary handles lobby rooms without game state", () => {
  const room = makeRoom({
    id: "room-lobby",
    status: "lobby",
    isPublic: true,
    players: [makePlayer("p-1", "Alice", true)]
  });

  const summary = buildAdminGameSummary(room, undefined, Date.now(), 10 * 60_000);

  assert.equal(summary.hasLiveGame, false);
  assert.equal(summary.gameStatus, null);
  assert.equal(summary.bagCount, null);
  assert.equal(summary.centerTileCount, null);
  assert.equal(summary.stuck, false);
  assert.equal(summary.allPlayersOffline, false);
});
