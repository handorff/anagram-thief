import type {
  PracticeDifficulty,
  PracticeModeState,
  PracticeResult,
  PracticeScoredWord,
  ReplayStateSnapshot
} from "@shared/types";
import {
  DEFAULT_CLAIM_TIMER_SECONDS,
  DEFAULT_FLIP_TIMER_SECONDS,
  DEFAULT_PRACTICE_DIFFICULTY,
  DEFAULT_PRACTICE_TIMER_SECONDS,
  LETTER_PATTERN,
  MAX_CLAIM_TIMER_SECONDS,
  MAX_FLIP_TIMER_SECONDS,
  MAX_PRACTICE_TIMER_SECONDS,
  MIN_CLAIM_TIMER_SECONDS,
  MIN_FLIP_TIMER_SECONDS,
  MIN_PRACTICE_TIMER_SECONDS
} from "../constants";

export function normalizeEditorText(value: string): string {
  return value.trim().toUpperCase();
}

export function createInactivePracticeState(
  difficulty: PracticeDifficulty = DEFAULT_PRACTICE_DIFFICULTY
): PracticeModeState {
  return {
    active: false,
    phase: "puzzle",
    currentDifficulty: difficulty,
    queuedDifficulty: difficulty,
    timerEnabled: false,
    timerSeconds: DEFAULT_PRACTICE_TIMER_SECONDS,
    puzzleTimerEndsAt: null,
    puzzle: null,
    result: null
  };
}

export function clampFlipTimerSeconds(value: number) {
  const rounded = Math.round(value);
  if (Number.isNaN(rounded)) return DEFAULT_FLIP_TIMER_SECONDS;
  return Math.min(MAX_FLIP_TIMER_SECONDS, Math.max(MIN_FLIP_TIMER_SECONDS, rounded));
}

export function clampClaimTimerSeconds(value: number) {
  const rounded = Math.round(value);
  if (Number.isNaN(rounded)) return DEFAULT_CLAIM_TIMER_SECONDS;
  return Math.min(MAX_CLAIM_TIMER_SECONDS, Math.max(MIN_CLAIM_TIMER_SECONDS, rounded));
}

export function clampPracticeDifficulty(value: number): PracticeDifficulty {
  const rounded = Math.round(value);
  if (Number.isNaN(rounded)) return DEFAULT_PRACTICE_DIFFICULTY;
  if (rounded <= 1) return 1;
  if (rounded >= 5) return 5;
  return rounded as PracticeDifficulty;
}

export function clampPracticeTimerSeconds(value: number): number {
  const rounded = Math.round(value);
  if (Number.isNaN(rounded)) return DEFAULT_PRACTICE_TIMER_SECONDS;
  return Math.min(MAX_PRACTICE_TIMER_SECONDS, Math.max(MIN_PRACTICE_TIMER_SECONDS, rounded));
}

export function getPracticeResultCategory(result: PracticeResult): {
  key: "perfect" | "amazing" | "great" | "good" | "ok" | "better-luck-next-time";
  label: string;
} {
  if (result.score <= 0) {
    return {
      key: "better-luck-next-time",
      label: "Better luck next time"
    };
  }
  if (result.bestScore <= 0 || result.score === result.bestScore) {
    return {
      key: "perfect",
      label: "Perfect"
    };
  }

  const ratio = result.score / result.bestScore;
  if (ratio >= 0.9) {
    return { key: "amazing", label: "Amazing" };
  }
  if (ratio >= 0.75) {
    return { key: "great", label: "Great" };
  }
  if (ratio >= 0.5) {
    return { key: "good", label: "Good" };
  }
  return { key: "ok", label: "OK" };
}

export function buildPracticeSharePayloadFromReplayState(state: ReplayStateSnapshot) {
  const centerLetters = state.centerTiles
    .map((tile) => normalizeEditorText(tile.letter))
    .filter((letter) => letter.length === 1 && LETTER_PATTERN.test(letter))
    .join("");
  const existingWords = state.players.flatMap((player) =>
    player.words
      .map((word) => normalizeEditorText(word.text))
      .filter((word) => word.length > 0 && LETTER_PATTERN.test(word))
  );

  return {
    v: 2 as const,
    d: DEFAULT_PRACTICE_DIFFICULTY,
    c: centerLetters,
    w: existingWords
  };
}

export function getPracticeOptionClassName(
  option: PracticeScoredWord,
  submittedWordNormalized: string
) {
  if (option.word === submittedWordNormalized) {
    return "practice-option submitted";
  }
  return "practice-option";
}

export function getReplayPracticeOptionClassName(
  option: PracticeScoredWord,
  activeReplayClaimedWords: Set<string>
): string {
  if (activeReplayClaimedWords.has(normalizeEditorText(option.word))) {
    return "practice-option replay-claimed";
  }
  return "practice-option";
}

export function formatPracticeOptionLabel(option: PracticeScoredWord): string {
  if (option.source !== "steal" || !option.stolenFrom) {
    return option.word;
  }

  const addedLetters = getAddedLettersForSteal(option.word, option.stolenFrom);
  return `${option.word} (${option.stolenFrom} + ${addedLetters})`;
}

export function getAddedLettersForSteal(word: string, stolenWord: string): string {
  const remainingCounts: Record<string, number> = {};
  for (const letter of stolenWord) {
    remainingCounts[letter] = (remainingCounts[letter] ?? 0) + 1;
  }

  let addedLetters = "";
  for (const letter of word) {
    if ((remainingCounts[letter] ?? 0) > 0) {
      remainingCounts[letter] -= 1;
      continue;
    }
    addedLetters += letter;
  }

  return addedLetters;
}
