import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPracticeChallengeComparison,
  clampClaimTimerSeconds,
  clampFlipTimerSeconds,
  clampPracticeDifficulty,
  clampPracticeTimerSeconds,
  formatPracticeOptionLabel,
  getPracticeScoreForWord,
  getPracticeResultCategory,
  getReplayPracticeOptionClassName,
  normalizeEditorText
} from "./practiceUtils";

test("normalizeEditorText trims and uppercases", () => {
  assert.equal(normalizeEditorText("  team "), "TEAM");
});

test("timer clamp helpers respect min/max bounds", () => {
  assert.equal(clampFlipTimerSeconds(0), 1);
  assert.equal(clampFlipTimerSeconds(90), 60);
  assert.equal(clampClaimTimerSeconds(0), 1);
  assert.equal(clampClaimTimerSeconds(99), 10);
  assert.equal(clampPracticeTimerSeconds(1), 10);
  assert.equal(clampPracticeTimerSeconds(999), 120);
});

test("practice difficulty clamp limits to 1-5", () => {
  assert.equal(clampPracticeDifficulty(-10), 1);
  assert.equal(clampPracticeDifficulty(10), 5);
  assert.equal(clampPracticeDifficulty(3.2), 3);
});

test("practice result category returns expected labels", () => {
  assert.equal(getPracticeResultCategory({ score: 0, bestScore: 10, allOptions: [], timedOut: false }).key, "better-luck-next-time");
  assert.equal(getPracticeResultCategory({ score: 10, bestScore: 10, allOptions: [], timedOut: false }).key, "perfect");
  assert.equal(getPracticeResultCategory({ score: 8, bestScore: 10, allOptions: [], timedOut: false }).key, "great");
});

test("formatPracticeOptionLabel includes steal breakdown", () => {
  assert.equal(
    formatPracticeOptionLabel({
      word: "TEAMS",
      score: 5,
      baseScore: 5,
      stolenLetters: 1,
      source: "steal",
      stolenFrom: "TEAM"
    }),
    "TEAMS (TEAM + S)"
  );
});

test("getReplayPracticeOptionClassName highlights claimed words", () => {
  const option = {
    word: "teams",
    score: 5,
    baseScore: 5,
    stolenLetters: 0,
    source: "center" as const
  };
  assert.equal(getReplayPracticeOptionClassName(option, new Set(["TEAMS"])), "practice-option replay-claimed");
  assert.equal(getReplayPracticeOptionClassName(option, new Set(["OTHER"])), "practice-option");
});

test("getPracticeScoreForWord resolves score from options and falls back to zero", () => {
  const result = {
    submittedWordNormalized: "TEAM",
    score: 4,
    bestScore: 6,
    timedOut: false,
    allOptions: [
      {
        word: "TEAMS",
        score: 5,
        baseScore: 5,
        stolenLetters: 0,
        source: "center" as const
      }
    ]
  };
  assert.equal(getPracticeScoreForWord(result, "TEAMS"), 5);
  assert.equal(getPracticeScoreForWord(result, "team"), 4);
  assert.equal(getPracticeScoreForWord(result, "OTHER"), 0);
});

test("buildPracticeChallengeComparison returns deterministic challenge summary", () => {
  const result = {
    submittedWordNormalized: "TEAM",
    score: 4,
    bestScore: 6,
    timedOut: false,
    allOptions: [
      {
        word: "TEAMS",
        score: 5,
        baseScore: 5,
        stolenLetters: 0,
        source: "center" as const
      }
    ]
  };

  const comparison = buildPracticeChallengeComparison(result, "teams", "Paul");
  assert.deepEqual(comparison, {
    sharerLabel: "Paul",
    sharerWord: "TEAMS",
    sharerScore: 5,
    recipientWord: "TEAM",
    recipientScore: 4,
    scoreDelta: -1
  });
});

test("buildPracticeChallengeComparison defaults missing sharer score to zero and name to Challenger", () => {
  const result = {
    submittedWordNormalized: "TEAM",
    score: 4,
    bestScore: 6,
    timedOut: false,
    allOptions: []
  };

  const comparison = buildPracticeChallengeComparison(result, "OTHER");
  assert.equal(comparison.sharerLabel, "Challenger");
  assert.equal(comparison.sharerScore, 0);
  assert.equal(comparison.scoreDelta, 4);
});
