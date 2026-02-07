import assert from "node:assert/strict";
import test from "node:test";
import type { Player, PreStealEntry, Tile } from "../../shared/types.js";
import { buildGameStateForViewer } from "./index.js";

function makeTile(letter: string, id: string): Tile {
  return { id, letter };
}

function makeEntry(id: string, triggerLetters: string, claimWord: string): PreStealEntry {
  return {
    id,
    triggerLetters,
    claimWord,
    createdAt: Date.now()
  };
}

function makePlayer(id: string, name: string, entries: PreStealEntry[]): Player {
  return {
    id,
    name,
    connected: true,
    words: [],
    preStealEntries: entries,
    score: 0
  };
}

function makeGame(players: Player[]) {
  return {
    roomId: "room-1",
    status: "in-game" as const,
    bag: [makeTile("T", "bag-1"), makeTile("E", "bag-2")],
    centerTiles: [makeTile("A", "center-1")],
    players,
    turnOrder: players.map((player) => player.id),
    turnIndex: 0,
    turnPlayerId: players[0]?.id ?? "",
    lastClaimAt: null,
    endTimer: undefined,
    endTimerEndsAt: undefined,
    flipTimer: {
      enabled: false,
      seconds: 15
    },
    flipTimerTimeout: undefined,
    flipTimerEndsAt: undefined,
    flipTimerToken: undefined,
    pendingFlip: null,
    pendingFlipTimeout: undefined,
    claimTimer: {
      seconds: 3
    },
    claimWindow: null,
    claimWindowTimeout: undefined,
    claimCooldowns: {},
    claimCooldownTimeouts: new Map<string, NodeJS.Timeout>(),
    preStealEnabled: true,
    preStealPrecedenceOrder: players.map((player) => player.id),
    lastClaimEvent: null
  };
}

test("buildGameStateForViewer hides other players pre-steal entries for players", () => {
  const alice = makePlayer("p-alice", "Alice", [makeEntry("a-1", "S", "STARE")]);
  const bob = makePlayer("p-bob", "Bob", [makeEntry("b-1", "M", "TAME")]);
  const game = makeGame([alice, bob]);

  const state = buildGameStateForViewer(game as any, "player", "p-alice");
  const aliceState = state.players.find((player) => player.id === "p-alice");
  const bobState = state.players.find((player) => player.id === "p-bob");

  assert.ok(aliceState);
  assert.ok(bobState);
  assert.equal(aliceState.preStealEntries.length, 1);
  assert.equal(bobState.preStealEntries.length, 0);
});

test("buildGameStateForViewer exposes all pre-steal entries for spectators", () => {
  const alice = makePlayer("p-alice", "Alice", [makeEntry("a-1", "S", "STARE")]);
  const bob = makePlayer("p-bob", "Bob", [makeEntry("b-1", "M", "TAME")]);
  const game = makeGame([alice, bob]);

  const state = buildGameStateForViewer(game as any, "spectator", "s-1");
  const aliceState = state.players.find((player) => player.id === "p-alice");
  const bobState = state.players.find((player) => player.id === "p-bob");

  assert.ok(aliceState);
  assert.ok(bobState);
  assert.equal(aliceState.preStealEntries.length, 1);
  assert.equal(bobState.preStealEntries.length, 1);
});
