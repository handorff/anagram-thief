import assert from "node:assert/strict";
import test from "node:test";
import type { Player, PreStealEntry, Tile, Word } from "../../shared/types.js";
import { appendReplayStepIfChanged, hydrateGameState, toPersistedGameState } from "./index.js";

function makeTile(letter: string, id: string): Tile {
  return { id, letter };
}

function makeWord(text: string, ownerId: string, id: string): Word {
  return {
    id,
    text,
    ownerId,
    tileIds: text.split("").map((_, index) => `${id}-tile-${index}`),
    createdAt: Date.now()
  };
}

function makeEntry(id: string, triggerLetters: string, claimWord: string): PreStealEntry {
  return {
    id,
    triggerLetters,
    claimWord,
    createdAt: Date.now()
  };
}

function makePlayer(id: string, name: string): Player {
  return {
    id,
    name,
    connected: true,
    words: [],
    preStealEntries: [],
    score: 0
  };
}

function makeGame(): any {
  const alice = makePlayer("p-alice", "Alice");
  return {
    roomId: "room-1",
    status: "in-game" as const,
    bag: [makeTile("A", "bag-1"), makeTile("B", "bag-2")],
    centerTiles: [],
    players: [alice],
    turnOrder: [alice.id],
    turnIndex: 0,
    turnPlayerId: alice.id,
    lastClaimAt: null as number | null,
    endTimer: undefined as NodeJS.Timeout | undefined,
    endTimerEndsAt: undefined as number | undefined,
    flipTimer: {
      enabled: false,
      seconds: 15
    },
    flipTimerTimeout: undefined as NodeJS.Timeout | undefined,
    flipTimerEndsAt: undefined as number | undefined,
    flipTimerToken: undefined as string | undefined,
    pendingFlip: null,
    pendingFlipTimeout: undefined as NodeJS.Timeout | undefined,
    claimTimer: {
      seconds: 3
    },
    claimWindow: null,
    claimWindowTimeout: undefined as NodeJS.Timeout | undefined,
    claimCooldowns: {} as Record<string, number>,
    claimCooldownTimeouts: new Map<string, NodeJS.Timeout>(),
    preStealEnabled: true,
    preStealPrecedenceOrder: [alice.id],
    lastClaimEvent: null as any,
    replay: { steps: [] as any[] },
    lastReplaySnapshotHash: null as string | null
  };
}

test("appendReplayStepIfChanged deduplicates unchanged state and keeps sequential step order", () => {
  const game = makeGame();

  const appendedGameStart = appendReplayStepIfChanged(game as any, "game-start", 1);
  const appendedDuplicate = appendReplayStepIfChanged(game as any, "game-start", 2);

  game.pendingFlip = {
    token: "pending-token",
    playerId: "p-alice",
    startedAt: 10,
    revealsAt: 20
  };
  const appendedFlipStarted = appendReplayStepIfChanged(game as any, "flip-started", 3);

  game.pendingFlip = null;
  game.centerTiles.push(makeTile("A", "center-1"));
  const appendedFlipRevealed = appendReplayStepIfChanged(game as any, "flip-revealed", 4);

  assert.equal(appendedGameStart, true);
  assert.equal(appendedDuplicate, false);
  assert.equal(appendedFlipStarted, true);
  assert.equal(appendedFlipRevealed, true);
  assert.equal(game.replay.steps.length, 3);
  assert.deepEqual(
    game.replay.steps.map((step: any) => step.index),
    [0, 1, 2]
  );
  assert.deepEqual(
    game.replay.steps.map((step: any) => step.kind),
    ["game-start", "flip-started", "flip-revealed"]
  );
});

test("persisted replay survives toPersistedGameState -> hydrateGameState round trip", () => {
  const game = makeGame();
  const player = game.players[0];
  player.words.push(makeWord("TEAM", player.id, "w-team"));
  player.preStealEntries.push(makeEntry("e-1", "S", "STEAM"));
  player.score = 4;

  appendReplayStepIfChanged(game as any, "game-start", 1);
  game.centerTiles.push(makeTile("S", "center-1"));
  appendReplayStepIfChanged(game as any, "flip-revealed", 2);
  game.status = "ended";
  appendReplayStepIfChanged(game as any, "game-ended", 3);

  const persisted = toPersistedGameState(game as any);
  const hydrated = hydrateGameState(persisted);

  assert.equal(persisted.replay?.steps.length, 3);
  assert.equal(hydrated.replay.steps.length, 3);
  assert.deepEqual(hydrated.replay.steps, persisted.replay?.steps ?? []);
  assert.equal(
    hydrated.lastReplaySnapshotHash,
    JSON.stringify(hydrated.replay.steps[hydrated.replay.steps.length - 1].state)
  );
});
