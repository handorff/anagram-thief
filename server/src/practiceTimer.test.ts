import assert from "node:assert/strict";
import test from "node:test";
import type { PracticePuzzle, PracticeScoredWord, Tile } from "../../shared/types.js";
import { createTimedOutPracticeResult } from "./practiceTimer.js";

function makeTile(letter: string, index: number): Tile {
  return {
    id: `tile-${index}`,
    letter
  };
}

function makePuzzle(center: string, existingWords: string[] = []): PracticePuzzle {
  return {
    id: "puzzle-1",
    centerTiles: center.split("").map((letter, index) => makeTile(letter, index)),
    existingWords: existingWords.map((text, index) => ({
      id: `existing-${index}`,
      text
    }))
  };
}

test("createTimedOutPracticeResult marks timeout and keeps solver options", () => {
  const puzzle = makePuzzle("TEAM", ["RATE"]);
  const options: PracticeScoredWord[] = [
    {
      word: "STARE",
      score: 9,
      baseScore: 5,
      stolenLetters: 4,
      source: "steal",
      stolenFrom: "RATE"
    },
    {
      word: "MEAT",
      score: 4,
      baseScore: 4,
      stolenLetters: 0,
      source: "center"
    }
  ];
  const result = createTimedOutPracticeResult(puzzle, () => options);

  assert.equal(result.isValid, true);
  assert.equal(result.timedOut, true);
  assert.equal(result.score, 0);
  assert.equal(result.bestScore, 9);
  assert.equal(result.isBestPlay, false);
  assert.equal(result.submittedWordRaw, "");
  assert.equal(result.submittedWordNormalized, "");
  assert.deepEqual(result.allOptions, options);
});

test("createTimedOutPracticeResult handles puzzles with no valid options", () => {
  const puzzle = makePuzzle("ZZZZ");
  const result = createTimedOutPracticeResult(puzzle, () => []);

  assert.equal(result.timedOut, true);
  assert.equal(result.score, 0);
  assert.equal(result.bestScore, 0);
  assert.deepEqual(result.allOptions, []);
});
