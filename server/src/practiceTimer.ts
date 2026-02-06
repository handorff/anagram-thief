import type { PracticePuzzle, PracticeResult, PracticeScoredWord } from "../../shared/types.js";

export function createTimedOutPracticeResult(
  puzzle: PracticePuzzle,
  solvePuzzle: (puzzle: PracticePuzzle) => PracticeScoredWord[]
): PracticeResult {
  const allOptions = solvePuzzle(puzzle);
  return {
    submittedWordRaw: "",
    submittedWordNormalized: "",
    isValid: true,
    isBestPlay: false,
    timedOut: true,
    score: 0,
    bestScore: allOptions[0]?.score ?? 0,
    allOptions
  };
}
