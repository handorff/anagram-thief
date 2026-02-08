import assert from "node:assert/strict";
import test from "node:test";
import type { GameState } from "@shared/types";
import {
  buildReplayActionText,
  getReplayClaimWordDiff
} from "./replayUtils";

function makeBaseState(): GameState {
  return {
    roomId: "room-1",
    status: "in-game",
    bagCount: 10,
    centerTiles: [],
    players: [
      {
        id: "p1",
        name: "Alice",
        connected: true,
        score: 0,
        words: [],
        preStealEntries: []
      },
      {
        id: "p2",
        name: "Bob",
        connected: true,
        score: 0,
        words: [],
        preStealEntries: []
      }
    ],
    turnPlayerId: "p1",
    claimWindow: null,
    claimCooldowns: {},
    pendingFlip: null,
    endTimerEndsAt: null,
    replay: null,
    preStealEnabled: true,
    preStealPrecedenceOrder: ["p1", "p2"],
    lastClaimEvent: null
  };
}

test("getReplayClaimWordDiff returns added and removed words", () => {
  const previous = {
    ...makeBaseState(),
    players: [
      {
        id: "p1",
        name: "Alice",
        connected: true,
        score: 0,
        words: [{ id: "w1", text: "TEAM", tileIds: ["t1", "t2", "t3", "t4"], createdAt: 1 }],
        preStealEntries: []
      },
      {
        id: "p2",
        name: "Bob",
        connected: true,
        score: 0,
        words: [],
        preStealEntries: []
      }
    ]
  };

  const current = {
    ...previous,
    players: [
      {
        id: "p1",
        name: "Alice",
        connected: true,
        score: 5,
        words: [{ id: "w2", text: "TEAMS", tileIds: ["t1", "t2", "t3", "t4", "t5"], createdAt: 2 }],
        preStealEntries: []
      },
      previous.players[1]
    ]
  };

  const steps: NonNullable<GameState["replay"]>["steps"] = [
    { index: 0, at: 1, kind: "flip-revealed", state: previous },
    { index: 1, at: 2, kind: "claim-succeeded", state: current }
  ];

  const diff = getReplayClaimWordDiff(steps, 1);
  assert.ok(diff);
  assert.equal(diff?.addedWords.length, 1);
  assert.equal(diff?.removedWords.length, 1);
  assert.equal(diff?.addedWords[0].text, "TEAMS");
  assert.equal(diff?.removedWords[0].text, "TEAM");
});

test("buildReplayActionText describes claim events", () => {
  const previous = {
    ...makeBaseState(),
    players: [
      {
        id: "p1",
        name: "Alice",
        connected: true,
        score: 0,
        words: [{ id: "w1", text: "TEAM", tileIds: ["t1", "t2", "t3", "t4"], createdAt: 1 }],
        preStealEntries: []
      },
      {
        id: "p2",
        name: "Bob",
        connected: true,
        score: 0,
        words: [],
        preStealEntries: []
      }
    ]
  };
  const current = {
    ...previous,
    players: [
      {
        id: "p1",
        name: "Alice",
        connected: true,
        score: 5,
        words: [{ id: "w2", text: "TEAMS", tileIds: ["t1", "t2", "t3", "t4", "t5"], createdAt: 2 }],
        preStealEntries: []
      },
      previous.players[1]
    ]
  };

  const steps: NonNullable<GameState["replay"]>["steps"] = [
    { index: 0, at: 1, kind: "flip-revealed", state: previous },
    { index: 1, at: 2, kind: "claim-succeeded", state: current }
  ];

  const text = buildReplayActionText(steps, 1);
  assert.match(text, /extended TEAM to TEAMS\./);
});
