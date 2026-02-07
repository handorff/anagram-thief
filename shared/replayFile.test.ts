import assert from "node:assert/strict";
import test from "node:test";
import type { GameReplay, ReplayAnalysisMap, ReplayFileV1, ReplayStateSnapshot } from "./types.js";
import {
  buildReplayFileV1,
  parseReplayFile,
  serializeReplayFile,
  validateReplayFile
} from "./replayFile.js";

function makeReplayState(overrides: Partial<ReplayStateSnapshot> = {}): ReplayStateSnapshot {
  return {
    roomId: "room-1",
    status: "in-game",
    bagCount: 10,
    centerTiles: [{ id: "tile-a", letter: "A" }],
    players: [
      {
        id: "p1",
        name: "Alice",
        score: 0,
        words: [],
        preStealEntries: []
      }
    ],
    turnPlayerId: "p1",
    claimWindow: null,
    claimCooldowns: {},
    pendingFlip: null,
    preStealEnabled: true,
    preStealPrecedenceOrder: ["p1"],
    lastClaimEvent: null,
    ...overrides
  };
}

function makeReplay(): GameReplay {
  return {
    steps: [
      {
        index: 0,
        at: 100,
        kind: "flip-revealed",
        state: makeReplayState()
      },
      {
        index: 1,
        at: 101,
        kind: "claim-succeeded",
        state: makeReplayState({
          bagCount: 9,
          centerTiles: [],
          players: [
            {
              id: "p1",
              name: "Alice",
              score: 5,
              words: [
                {
                  id: "w1",
                  text: "TEAMS",
                  tileIds: ["t1", "t2", "t3", "t4", "t5"],
                  ownerId: "p1",
                  createdAt: 101
                }
              ],
              preStealEntries: []
            }
          ],
          lastClaimEvent: {
            eventId: "e1",
            wordId: "w1",
            claimantId: "p1",
            replacedWordId: null,
            source: "manual",
            movedToBottomOfPreStealPrecedence: false
          }
        })
      }
    ]
  };
}

function makeReplayFile(): ReplayFileV1 {
  const analysisByStepIndex: ReplayAnalysisMap = {
    "1": {
      requestedStepIndex: 1,
      stepKind: "claim-succeeded",
      basis: "before-claim",
      basisStepIndex: 0,
      bestScore: 5,
      allOptions: [
        {
          word: "TEAMS",
          score: 5,
          baseScore: 5,
          stolenLetters: 0,
          source: "center"
        }
      ]
    }
  };
  return buildReplayFileV1({
    replay: makeReplay(),
    analysisByStepIndex,
    sourceRoomId: "room-1",
    exportedAt: 1_700_000_000_000,
    app: "anagram-thief-web"
  });
}

test("valid replay file round-trips serialize/parse", () => {
  const file = makeReplayFile();
  const json = serializeReplayFile(file);
  const parsed = parseReplayFile(json);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.file.kind, "anagram-thief-replay");
  assert.equal(parsed.file.v, 1);
  assert.equal(parsed.file.replay.steps.length, 2);
});

test("validateReplayFile rejects wrong kind", () => {
  const file = makeReplayFile() as unknown as Record<string, unknown>;
  file.kind = "not-anagram-replay";
  const result = validateReplayFile(file);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.message, "Replay file is invalid or corrupted.");
});

test("validateReplayFile rejects unsupported version", () => {
  const file = makeReplayFile() as unknown as Record<string, unknown>;
  file.v = 2;
  const result = validateReplayFile(file);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.message, "Unsupported replay file version.");
});

test("validateReplayFile rejects malformed steps and non-sequential index", () => {
  const file = makeReplayFile() as unknown as Record<string, unknown>;
  const replay = file.replay as { steps: Array<Record<string, unknown>> };
  replay.steps[1].index = 3;
  const result = validateReplayFile(file);
  assert.equal(result.ok, false);
});

test("validateReplayFile rejects analysis map keys outside step range", () => {
  const file = makeReplayFile() as unknown as Record<string, unknown>;
  file.analysisByStepIndex = {
    "99": {
      requestedStepIndex: 99,
      stepKind: "claim-succeeded",
      basis: "before-claim",
      basisStepIndex: 0,
      bestScore: 10,
      allOptions: []
    }
  };
  const result = validateReplayFile(file);
  assert.equal(result.ok, false);
});
