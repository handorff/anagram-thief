import assert from "node:assert/strict";
import test from "node:test";
import type { PracticeDifficulty, PracticePuzzle, Tile } from "../../shared/types.js";
import { createPracticeEngine } from "./practice.js";

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

test("solvePuzzle finds all center-only words", () => {
  const dictionary = new Set(["TEAM", "MATE", "MEAT", "META", "TAME"]);
  const engine = createPracticeEngine(dictionary);
  const puzzle = makePuzzle("TEAM");
  const options = engine.solvePuzzle(puzzle);

  assert.deepEqual(
    options.map((option) => option.word),
    ["MATE", "MEAT", "META", "TAME", "TEAM"]
  );
  for (const option of options) {
    assert.equal(option.source, "center");
    assert.equal(option.score, 4);
  }
});

test("solvePuzzle only includes valid steals and excludes substring extensions", () => {
  const dictionary = new Set(["RATE", "STARE", "RATES", "TEAR"]);
  const engine = createPracticeEngine(dictionary);
  const puzzle = makePuzzle("S", ["RATE"]);
  const options = engine.solvePuzzle(puzzle);

  const stare = options.find((option) => option.word === "STARE");
  assert.ok(stare);
  assert.equal(stare.source, "steal");
  assert.equal(stare.stolenLetters, 4);
  assert.equal(stare.score, 9);
  assert.equal(stare.stolenFrom, "RATE");

  assert.equal(options.some((option) => option.word === "RATES"), false);
});

test("duplicate derivations collapse to one row using the best score", () => {
  const dictionary = new Set(["LATE", "ALTER", "TALERS"]);
  const engine = createPracticeEngine(dictionary);
  const puzzle = makePuzzle("RS", ["LATE", "ALTER"]);
  const options = engine.solvePuzzle(puzzle);

  const talers = options.find((option) => option.word === "TALERS");
  assert.ok(talers);
  assert.equal(talers.score, 11);
  assert.equal(talers.source, "steal");
  assert.equal(talers.stolenFrom, "ALTER");
});

test("evaluateSubmission treats tied top score as best play", () => {
  const dictionary = new Set(["TEAM", "MATE"]);
  const engine = createPracticeEngine(dictionary);
  const puzzle = makePuzzle("TEAM");
  const result = engine.evaluateSubmission(puzzle, "team");

  assert.equal(result.isValid, true);
  assert.equal(result.score, 4);
  assert.equal(result.isBestPlay, true);
  assert.equal(result.bestScore, 4);
});

test("evaluateSubmission returns specific invalid reasons", () => {
  const dictionary = new Set(["TEAM", "MATE", "TIGER"]);
  const engine = createPracticeEngine(dictionary);
  const puzzle = makePuzzle("TEAM");

  const empty = engine.evaluateSubmission(puzzle, "   ");
  assert.equal(empty.isValid, false);
  assert.equal(empty.score, 0);
  assert.equal(empty.invalidReason, "Enter a word to submit.");

  const nonAlpha = engine.evaluateSubmission(puzzle, "TE4M");
  assert.equal(nonAlpha.isValid, false);
  assert.equal(nonAlpha.invalidReason, "Word must contain only letters A-Z.");

  const notInDictionary = engine.evaluateSubmission(puzzle, "ZZZZ");
  assert.equal(notInDictionary.isValid, false);
  assert.equal(notInDictionary.invalidReason, "Word is not in the dictionary.");

  const notClaimable = engine.evaluateSubmission(puzzle, "TIGER");
  assert.equal(notClaimable.isValid, false);
  assert.equal(notClaimable.invalidReason, "Word cannot be claimed from this puzzle.");
});

test("generatePuzzle always returns at least one claimable word", () => {
  const dictionary = new Set([
    "TEAM",
    "MATE",
    "MEAT",
    "TAME",
    "RATE",
    "STARE",
    "ALERT",
    "LATER",
    "ALTER",
    "TALERS",
    "STREAM",
    "MASTER",
    "TAMERS",
    "SMEAR",
    "REAMS"
  ]);
  const engine = createPracticeEngine(dictionary);

  const difficulties: PracticeDifficulty[] = [1, 2, 3, 4, 5];
  for (const difficulty of difficulties) {
    for (let index = 0; index < 40; index += 1) {
      const puzzle = engine.generatePuzzle(difficulty);
      const options = engine.solvePuzzle(puzzle);
      assert.ok(options.length > 0);
    }
  }
});

test("harder generated puzzles trend toward more and longer existing words", () => {
  const dictionary = new Set([
    "TEAM",
    "MATE",
    "MEAT",
    "TAME",
    "RATE",
    "TEAR",
    "STARE",
    "ALERT",
    "LATER",
    "ALTER",
    "TALERS",
    "STREAM",
    "MASTER",
    "TAMERS",
    "SMEAR",
    "REAMS",
    "RELATES",
    "TAILERS",
    "SALTIER",
    "RELATION",
    "ORIENTAL",
    "TAILORED",
    "TRACTIONS",
    "CONTAINER",
    "STONEWARE"
  ]);
  const engine = createPracticeEngine(dictionary);

  const sampleCount = 120;
  let easyWordCountTotal = 0;
  let hardWordCountTotal = 0;
  let easyWordLengthTotal = 0;
  let hardWordLengthTotal = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const easyPuzzle = engine.generatePuzzle(1);
    easyWordCountTotal += easyPuzzle.existingWords.length;
    easyWordLengthTotal += easyPuzzle.existingWords.reduce((sum, word) => sum + word.text.length, 0);

    const hardPuzzle = engine.generatePuzzle(5);
    hardWordCountTotal += hardPuzzle.existingWords.length;
    hardWordLengthTotal += hardPuzzle.existingWords.reduce((sum, word) => sum + word.text.length, 0);
  }

  const easyAverageCount = easyWordCountTotal / sampleCount;
  const hardAverageCount = hardWordCountTotal / sampleCount;
  const easyAverageLength = easyWordCountTotal > 0 ? easyWordLengthTotal / easyWordCountTotal : 0;
  const hardAverageLength = hardWordCountTotal > 0 ? hardWordLengthTotal / hardWordCountTotal : 0;

  assert.ok(hardAverageCount > easyAverageCount);
  assert.ok(hardAverageLength > easyAverageLength);
});
