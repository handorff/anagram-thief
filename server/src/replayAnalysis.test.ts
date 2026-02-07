import assert from "node:assert/strict";
import test from "node:test";
import type { ReplayStateSnapshot, ReplayStep } from "../../shared/types.js";
import {
  analyzeReplayStep,
  buildPracticePuzzleFromReplayState,
  resolveReplayAnalysisBasisStep
} from "./index.js";

function makeReplayState(options: {
  centerLetters?: string;
  aliceWords?: string[];
  bobWords?: string[];
} = {}): ReplayStateSnapshot {
  const centerLetters = options.centerLetters ?? "";
  const aliceWords = options.aliceWords ?? [];
  const bobWords = options.bobWords ?? [];
  const now = Date.now();

  return {
    roomId: "room-1",
    status: "in-game",
    bagCount: 10,
    centerTiles: centerLetters.split("").map((letter, index) => ({
      id: `center-${index}`,
      letter
    })),
    players: [
      {
        id: "p-alice",
        name: "Alice",
        score: aliceWords.reduce((sum, word) => sum + word.length, 0),
        words: aliceWords.map((word, index) => ({
          id: `w-alice-${index}`,
          text: word,
          tileIds: word.split("").map((_, tileIndex) => `wa-${index}-${tileIndex}`),
          ownerId: "p-alice",
          createdAt: now + index
        })),
        preStealEntries: []
      },
      {
        id: "p-bob",
        name: "Bob",
        score: bobWords.reduce((sum, word) => sum + word.length, 0),
        words: bobWords.map((word, index) => ({
          id: `w-bob-${index}`,
          text: word,
          tileIds: word.split("").map((_, tileIndex) => `wb-${index}-${tileIndex}`),
          ownerId: "p-bob",
          createdAt: now + index
        })),
        preStealEntries: []
      }
    ],
    turnPlayerId: "p-alice",
    claimWindow: null,
    claimCooldowns: {},
    pendingFlip: null,
    preStealEnabled: true,
    preStealPrecedenceOrder: ["p-alice", "p-bob"],
    lastClaimEvent: null
  };
}

function makeReplaySteps(): ReplayStep[] {
  return [
    {
      index: 0,
      at: 1,
      kind: "flip-revealed",
      state: makeReplayState({ centerLetters: "S", aliceWords: ["RATE"] })
    },
    {
      index: 1,
      at: 2,
      kind: "claim-succeeded",
      state: makeReplayState({ centerLetters: "", aliceWords: ["STARE"] })
    }
  ];
}

test("resolveReplayAnalysisBasisStep uses previous step for claim-succeeded", () => {
  const game = { replay: { steps: makeReplaySteps() } };
  const resolution = resolveReplayAnalysisBasisStep(game as any, 1);

  assert.equal(resolution.ok, true);
  if (!resolution.ok) return;
  assert.equal(resolution.stepKind, "claim-succeeded");
  assert.equal(resolution.basis, "before-claim");
  assert.equal(resolution.basisStepIndex, 0);
});

test("resolveReplayAnalysisBasisStep uses requested step for flip-revealed", () => {
  const game = { replay: { steps: makeReplaySteps() } };
  const resolution = resolveReplayAnalysisBasisStep(game as any, 0);

  assert.equal(resolution.ok, true);
  if (!resolution.ok) return;
  assert.equal(resolution.stepKind, "flip-revealed");
  assert.equal(resolution.basis, "step");
  assert.equal(resolution.basisStepIndex, 0);
});

test("buildPracticePuzzleFromReplayState includes center tiles and all player words", () => {
  const state = makeReplayState({
    centerLetters: "TEAM",
    aliceWords: ["RATE"],
    bobWords: ["MALE"]
  });
  const puzzle = buildPracticePuzzleFromReplayState(state);

  assert.deepEqual(
    puzzle.centerTiles.map((tile) => tile.letter),
    ["T", "E", "A", "M"]
  );
  assert.deepEqual(
    puzzle.existingWords.map((word) => word.text),
    ["RATE", "MALE"]
  );
});

test("analyzeReplayStep returns solver output and bestScore from top option", () => {
  const game = { replay: { steps: makeReplaySteps() } };
  const response = analyzeReplayStep(game as any, 0, () => [
    {
      word: "TARES",
      score: 7,
      baseScore: 5,
      stolenLetters: 2,
      source: "steal" as const,
      stolenFrom: "RATE"
    },
    {
      word: "TEAMS",
      score: 5,
      baseScore: 5,
      stolenLetters: 0,
      source: "center" as const
    }
  ]);

  assert.equal(response.ok, true);
  if (!response.ok) return;
  assert.equal(response.result.bestScore, 7);
  assert.equal(response.result.allOptions.length, 2);
  assert.equal(response.result.basis, "step");
  assert.equal(response.result.requestedStepIndex, 0);
});

test("analyzeReplayStep returns failure for unsupported or invalid steps", () => {
  const unsupportedGame = {
    replay: {
      steps: [
        {
          index: 0,
          at: 1,
          kind: "game-start" as const,
          state: makeReplayState({ centerLetters: "A" })
        }
      ]
    }
  };
  const unsupportedResponse = analyzeReplayStep(unsupportedGame as any, 0, () => []);
  assert.equal(unsupportedResponse.ok, false);

  const invalidIndexGame = { replay: { steps: makeReplaySteps() } };
  const invalidResponse = analyzeReplayStep(invalidIndexGame as any, 99, () => []);
  assert.equal(invalidResponse.ok, false);
});
