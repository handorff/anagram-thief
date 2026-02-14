import assert from "node:assert/strict";
import test from "node:test";
import type {
  GameState,
  Player,
  Word
} from "@shared/types";
import { deriveGameplaySounds } from "./deriveGameplaySounds";

function makePlayer(id: string, name: string, words: Word[] = []): Player {
  return {
    id,
    name,
    connected: true,
    score: words.length,
    words,
    preStealEntries: []
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    roomId: "room-1",
    status: "in-game",
    bagCount: 10,
    centerTiles: [],
    players: [
      makePlayer("p1", "Alice"),
      makePlayer("p2", "Bob")
    ],
    turnPlayerId: "p1",
    lastClaimAt: null,
    claimWindow: null,
    claimCooldowns: {},
    pendingFlip: null,
    preStealEnabled: true,
    preStealPrecedenceOrder: ["p1", "p2"],
    lastClaimEvent: null,
    replay: null,
    ...overrides
  };
}

test("deriveGameplaySounds includes flipReveal when center tile is added after a bag decrement", () => {
  const previousState = makeState({
    bagCount: 10,
    centerTiles: [{ id: "t1", letter: "A" }]
  });
  const nextState = makeState({
    bagCount: 9,
    centerTiles: [
      { id: "t1", letter: "A" },
      { id: "t2", letter: "B" }
    ]
  });

  const sounds = deriveGameplaySounds({
    previousState,
    nextState,
    selfPlayerId: "p1",
    now: 1_000
  });

  assert.deepEqual(sounds, ["flipReveal"]);
});

test("deriveGameplaySounds includes claimSuccess for claims and self-extensions", () => {
  const previousState = makeState({
    players: [
      makePlayer("p1", "Alice", [
        { id: "w1", text: "TEAM", tileIds: ["t1", "t2", "t3", "t4"], ownerId: "p1", createdAt: 1 }
      ]),
      makePlayer("p2", "Bob")
    ]
  });
  const nextState = makeState({
    players: [
      makePlayer("p1", "Alice", [
        { id: "w2", text: "TEAMS", tileIds: ["t1", "t2", "t3", "t4", "t5"], ownerId: "p1", createdAt: 2 }
      ]),
      makePlayer("p2", "Bob")
    ]
  });

  const sounds = deriveGameplaySounds({
    previousState,
    nextState,
    selfPlayerId: "p1",
    now: 1_000
  });

  assert.deepEqual(sounds, ["claimSuccess"]);
});

test("deriveGameplaySounds includes stealSuccess when a word changes owners", () => {
  const previousState = makeState({
    players: [
      makePlayer("p1", "Alice", [
        { id: "w1", text: "TEAM", tileIds: ["t1", "t2", "t3", "t4"], ownerId: "p1", createdAt: 1 }
      ]),
      makePlayer("p2", "Bob")
    ]
  });
  const nextState = makeState({
    players: [
      makePlayer("p1", "Alice"),
      makePlayer("p2", "Bob", [
        { id: "w2", text: "TEAMS", tileIds: ["t1", "t2", "t3", "t4", "t5"], ownerId: "p2", createdAt: 2 }
      ])
    ]
  });

  const sounds = deriveGameplaySounds({
    previousState,
    nextState,
    selfPlayerId: "p1",
    now: 1_000
  });

  assert.deepEqual(sounds, ["stealSuccess"]);
});

test("deriveGameplaySounds includes claimExpired when claim window times out into cooldown", () => {
  const previousState = makeState({
    claimWindow: {
      playerId: "p2",
      endsAt: 1_500
    }
  });
  const nextState = makeState({
    claimWindow: null,
    claimCooldowns: {
      p2: 2_000
    }
  });

  const sounds = deriveGameplaySounds({
    previousState,
    nextState,
    selfPlayerId: "p1",
    now: 1_700
  });

  assert.deepEqual(sounds, ["claimExpired"]);
});

test("deriveGameplaySounds includes cooldownSelf only when self starts cooldown", () => {
  const previousState = makeState();
  const nextState = makeState({
    claimCooldowns: {
      p1: 2_000
    }
  });

  const selfSounds = deriveGameplaySounds({
    previousState,
    nextState,
    selfPlayerId: "p1",
    now: 1_000
  });
  assert.deepEqual(selfSounds, ["cooldownSelf"]);

  const otherPlayerSounds = deriveGameplaySounds({
    previousState,
    nextState,
    selfPlayerId: "p2",
    now: 1_000
  });
  assert.deepEqual(otherPlayerSounds, []);
});

test("deriveGameplaySounds includes gameEnd on transition into ended status", () => {
  const previousState = makeState({ status: "in-game" });
  const nextState = makeState({ status: "ended" });

  const sounds = deriveGameplaySounds({
    previousState,
    nextState,
    selfPlayerId: "p1",
    now: 1_000
  });

  assert.deepEqual(sounds, ["gameEnd"]);
});
