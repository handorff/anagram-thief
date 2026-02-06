import assert from "node:assert/strict";
import test from "node:test";
import type { PracticePuzzle, PracticeSharePayload } from "../../shared/types.js";
import {
  buildPracticeSharePayload,
  decodePracticeSharePayload,
  encodePracticeSharePayload
} from "../../shared/practiceShare.js";
import {
  buildPracticeResultSharePayload,
  decodePracticeResultSharePayload,
  encodePracticeResultSharePayload
} from "../../shared/practiceResultShare.js";
import { createPracticeEngine } from "./practice.js";
import {
  materializeSharedPracticePuzzle,
  resolvePracticeStartRequest,
  validateCustomPracticePuzzle
} from "./practiceShare.js";

function buildPuzzle(center: string, existingWords: string[]): PracticePuzzle {
  return {
    id: "puzzle",
    centerTiles: center.split("").map((letter, index) => ({
      id: `center-${index}`,
      letter
    })),
    existingWords: existingWords.map((word, index) => ({
      id: `existing-${index}`,
      text: word
    }))
  };
}

test("share payload round-trip encodes and decodes puzzle content", () => {
  const payload = buildPracticeSharePayload(4, buildPuzzle("team", ["Rate", "stare"]));
  assert.deepEqual(payload, {
    v: 2,
    d: 4,
    c: "TEAM",
    w: ["RATE", "STARE"]
  });

  const token = encodePracticeSharePayload(payload);
  const decoded = decodePracticeSharePayload(token);
  assert.deepEqual(decoded, payload);
});

test("share payload decode returns null for invalid tokens", () => {
  assert.equal(decodePracticeSharePayload(""), null);
  assert.equal(decodePracticeSharePayload("1.3.TEAM.RATE"), null);
  assert.equal(decodePracticeSharePayload("2.3.TEAM.RATE"), null);
  assert.equal(decodePracticeSharePayload("$$$$"), null);
  assert.equal(decodePracticeSharePayload("a"), null);
});

test("result share payload round-trip encodes and decodes puzzle and answer", () => {
  const payload = buildPracticeResultSharePayload(3, buildPuzzle("team", ["rate"]), "meat", "Player One");
  assert.deepEqual(payload, {
    v: 1,
    p: {
      v: 2,
      d: 3,
      c: "TEAM",
      w: ["RATE"]
    },
    a: "MEAT",
    n: "Player One"
  });

  const token = encodePracticeResultSharePayload(payload);
  const decoded = decodePracticeResultSharePayload(token);
  assert.deepEqual(decoded, payload);
});

test("result share payload decode returns null for malformed tokens", () => {
  assert.equal(decodePracticeResultSharePayload(""), null);
  assert.equal(decodePracticeResultSharePayload("2.ABC.WORD"), null);
  assert.equal(decodePracticeResultSharePayload("1"), null);
  assert.equal(decodePracticeResultSharePayload("1..."), null);
  assert.equal(decodePracticeResultSharePayload("1.invalid.WORD"), null);
  assert.equal(decodePracticeResultSharePayload("1.invalid-token"), null);
});

test("result share payload decode rejects invalid puzzle token and answer format", () => {
  const puzzleToken = encodePracticeSharePayload({
    v: 2,
    d: 3,
    c: "TEAM",
    w: []
  });

  assert.equal(decodePracticeResultSharePayload(`1.invalid.${"TEAM"}`), null);
  assert.equal(decodePracticeResultSharePayload(`1.${puzzleToken}.TEAM1`), null);
});

test("materializeSharedPracticePuzzle accepts valid share payload", () => {
  const dictionary = new Set(["TEAM", "MATE", "MEAT", "TAME"]);
  const engine = createPracticeEngine(dictionary);
  const payload: PracticeSharePayload = {
    v: 2,
    d: 5,
    c: "TEAM",
    w: []
  };

  const materialized = materializeSharedPracticePuzzle(payload, (puzzle) => engine.solvePuzzle(puzzle));
  assert.ok(materialized);
  assert.equal(materialized.difficulty, 5);
  assert.deepEqual(
    materialized.puzzle.centerTiles.map((tile) => tile.letter),
    ["T", "E", "A", "M"]
  );
  assert.deepEqual(materialized.puzzle.existingWords, []);
});

test("materializeSharedPracticePuzzle rejects invalid payload bounds", () => {
  const dictionary = new Set(["TEAM", "MATE", "MEAT", "TAME"]);
  const engine = createPracticeEngine(dictionary);

  assert.equal(
    materializeSharedPracticePuzzle({ v: 2, d: 3, c: "", w: [] }, (puzzle) => engine.solvePuzzle(puzzle)),
    null
  );
  assert.equal(
    materializeSharedPracticePuzzle({ v: 2, d: 3, c: "TEAM", w: Array(9).fill("RATE") }, (puzzle) =>
      engine.solvePuzzle(puzzle)
    ),
    null
  );
  assert.equal(
    materializeSharedPracticePuzzle({ v: 2, d: 3, c: "TEAM", w: ["CAT"] }, (puzzle) => engine.solvePuzzle(puzzle)),
    null
  );
});

test("materializeSharedPracticePuzzle rejects unsolvable shared puzzles", () => {
  const dictionary = new Set(["TEAM", "MATE"]);
  const engine = createPracticeEngine(dictionary);

  const materialized = materializeSharedPracticePuzzle(
    { v: 2, d: 2, c: "ZZZZ", w: [] },
    (puzzle) => engine.solvePuzzle(puzzle)
  );
  assert.equal(materialized, null);
});

test("resolvePracticeStartRequest uses shared puzzle for practice:start payload", () => {
  const dictionary = new Set(["TEAM", "MATE", "MEAT", "TAME"]);
  const engine = createPracticeEngine(dictionary);
  const payload: PracticeSharePayload = {
    v: 2,
    d: 4,
    c: "TEAM",
    w: []
  };

  let generatedCalls = 0;
  const generatedPuzzle = buildPuzzle("ZZZZ", []);

  const resolved = resolvePracticeStartRequest(
    {
      difficulty: 1,
      sharedPuzzle: payload
    },
    {
      generatePuzzle: () => {
        generatedCalls += 1;
        return generatedPuzzle;
      },
      solvePuzzle: (puzzle) => engine.solvePuzzle(puzzle)
    }
  );

  assert.equal(resolved.ok, true);
  if (!resolved.ok) {
    assert.fail("Expected shared puzzle to resolve successfully.");
  }
  assert.equal(resolved.isShared, true);
  assert.equal(resolved.difficulty, 4);
  assert.equal(generatedCalls, 0);
  assert.deepEqual(
    resolved.puzzle.centerTiles.map((tile) => tile.letter),
    ["T", "E", "A", "M"]
  );
  assert.deepEqual(resolved.puzzle.existingWords.map((word) => word.text), []);
});

test("resolvePracticeStartRequest rejects invalid shared puzzles without falling back to random", () => {
  const dictionary = new Set(["TEAM", "MATE", "MEAT", "TAME"]);
  const engine = createPracticeEngine(dictionary);
  let generatedCalls = 0;

  const resolved = resolvePracticeStartRequest(
    {
      difficulty: 2,
      sharedPuzzle: {
        v: 2,
        d: 2,
        c: "ZZZZ",
        w: []
      }
    },
    {
      generatePuzzle: () => {
        generatedCalls += 1;
        return buildPuzzle("TEAM", []);
      },
      solvePuzzle: (puzzle) => engine.solvePuzzle(puzzle)
    }
  );

  assert.equal(resolved.ok, false);
  if (resolved.ok) {
    assert.fail("Expected invalid shared puzzle to fail.");
  }
  assert.equal(generatedCalls, 0);
  assert.equal(resolved.message, "Custom puzzle is invalid or has no valid plays.");
});

test("resolvePracticeStartRequest still generates random puzzle when no shared puzzle is provided", () => {
  const dictionary = new Set(["TEAM", "MATE", "MEAT", "TAME"]);
  const engine = createPracticeEngine(dictionary);
  let generatedCalls = 0;
  const generatedPuzzle = buildPuzzle("TEAM", []);

  const resolved = resolvePracticeStartRequest(
    {
      difficulty: 5
    },
    {
      generatePuzzle: () => {
        generatedCalls += 1;
        return generatedPuzzle;
      },
      solvePuzzle: (puzzle) => engine.solvePuzzle(puzzle)
    }
  );

  assert.equal(resolved.ok, true);
  if (!resolved.ok) {
    assert.fail("Expected random generation to succeed.");
  }
  assert.equal(generatedCalls, 1);
  assert.equal(resolved.isShared, false);
  assert.equal(resolved.difficulty, 5);
  assert.equal(resolved.puzzle, generatedPuzzle);
});

test("validateCustomPracticePuzzle returns explicit validation responses", () => {
  const dictionary = new Set(["TEAM", "MATE", "MEAT", "TAME"]);
  const engine = createPracticeEngine(dictionary);

  const validResponse = validateCustomPracticePuzzle(
    {
      v: 2,
      d: 3,
      c: "TEAM",
      w: []
    },
    (puzzle) => engine.solvePuzzle(puzzle)
  );
  assert.deepEqual(validResponse, { ok: true });

  const invalidResponse = validateCustomPracticePuzzle(
    {
      v: 2,
      d: 3,
      c: "ZZZZ",
      w: []
    },
    (puzzle) => engine.solvePuzzle(puzzle)
  );
  assert.deepEqual(invalidResponse, {
    ok: false,
    message: "Custom puzzle is invalid or has no valid plays."
  });
});
