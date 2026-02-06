import { randomUUID } from "node:crypto";
import type {
  PracticeDifficulty,
  PracticePuzzle,
  PracticeScoredWord,
  PracticeSharePayload,
  PracticeStartRequest,
  PracticeValidateCustomResponse
} from "../../shared/types.js";
import { normalizeWord } from "../../shared/wordValidation.js";
import { clampPracticeDifficulty } from "./practice.js";

const LETTER_PATTERN = /^[A-Z]+$/;

const MIN_SHARED_CENTER_LETTERS = 1;
const MAX_SHARED_CENTER_LETTERS = 16;
const MAX_SHARED_EXISTING_WORDS = 8;
const MIN_SHARED_EXISTING_WORD_LENGTH = 4;
const MAX_SHARED_EXISTING_WORD_LENGTH = 16;
const MAX_SHARED_TOTAL_CHARACTERS = 96;
const INVALID_SHARED_PUZZLE_MESSAGE = "Custom puzzle is invalid or has no valid plays.";
export const MIN_PRACTICE_TIMER_SECONDS = 10;
export const MAX_PRACTICE_TIMER_SECONDS = 120;
export const DEFAULT_PRACTICE_TIMER_SECONDS = 60;

type ResolvePracticeStartDependencies = {
  generatePuzzle: (difficulty: PracticeDifficulty) => PracticePuzzle;
  solvePuzzle: (puzzle: PracticePuzzle) => PracticeScoredWord[];
};

type ResolvePracticeStartSuccess = {
  ok: true;
  difficulty: PracticeDifficulty;
  puzzle: PracticePuzzle;
  isShared: boolean;
  timerEnabled: boolean;
  timerSeconds: number;
};

type ResolvePracticeStartFailure = {
  ok: false;
  message: string;
};

export type ResolvedPracticeStart = ResolvePracticeStartSuccess | ResolvePracticeStartFailure;

export function clampPracticeTimerSeconds(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_PRACTICE_TIMER_SECONDS;
  }
  const rounded = Math.round(value);
  if (rounded <= MIN_PRACTICE_TIMER_SECONDS) return MIN_PRACTICE_TIMER_SECONDS;
  if (rounded >= MAX_PRACTICE_TIMER_SECONDS) return MAX_PRACTICE_TIMER_SECONDS;
  return rounded;
}

function normalizeSharedWord(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = normalizeWord(value);
  if (!normalized || !LETTER_PATTERN.test(normalized)) return null;
  return normalized;
}

export function materializeSharedPracticePuzzle(
  sharedPuzzle: unknown,
  solvePuzzle: (puzzle: PracticePuzzle) => PracticeScoredWord[]
): { difficulty: PracticeDifficulty; puzzle: PracticePuzzle } | null {
  if (!sharedPuzzle || typeof sharedPuzzle !== "object") return null;
  const payload = sharedPuzzle as Partial<PracticeSharePayload>;
  if (payload.v !== 2) return null;

  const difficultyRaw = payload.d;
  if (typeof difficultyRaw !== "number" || !Number.isFinite(difficultyRaw)) return null;
  const roundedDifficulty = Math.round(difficultyRaw);
  if (roundedDifficulty < 1 || roundedDifficulty > 5) return null;
  const difficulty = clampPracticeDifficulty(roundedDifficulty);

  const centerLetters = normalizeSharedWord(payload.c);
  if (!centerLetters) return null;
  if (centerLetters.length < MIN_SHARED_CENTER_LETTERS || centerLetters.length > MAX_SHARED_CENTER_LETTERS) {
    return null;
  }

  const rawWords = payload.w;
  if (!Array.isArray(rawWords) || rawWords.length > MAX_SHARED_EXISTING_WORDS) return null;

  let totalCharacters = centerLetters.length;
  const existingWords: PracticePuzzle["existingWords"] = [];
  for (const rawWord of rawWords) {
    const word = normalizeSharedWord(rawWord);
    if (!word) return null;
    if (word.length < MIN_SHARED_EXISTING_WORD_LENGTH || word.length > MAX_SHARED_EXISTING_WORD_LENGTH) {
      return null;
    }
    totalCharacters += word.length;
    if (totalCharacters > MAX_SHARED_TOTAL_CHARACTERS) {
      return null;
    }
    existingWords.push({
      id: randomUUID(),
      text: word
    });
  }

  const puzzle: PracticePuzzle = {
    id: randomUUID(),
    centerTiles: centerLetters.split("").map((letter) => ({
      id: randomUUID(),
      letter
    })),
    existingWords
  };

  if (solvePuzzle(puzzle).length === 0) {
    return null;
  }

  return { difficulty, puzzle };
}

export function validateCustomPracticePuzzle(
  sharedPuzzle: unknown,
  solvePuzzle: (puzzle: PracticePuzzle) => PracticeScoredWord[]
): PracticeValidateCustomResponse {
  const materialized = materializeSharedPracticePuzzle(sharedPuzzle, solvePuzzle);
  if (!materialized) {
    return {
      ok: false,
      message: INVALID_SHARED_PUZZLE_MESSAGE
    };
  }
  return { ok: true };
}

export function resolvePracticeStartRequest(
  request: PracticeStartRequest | null | undefined,
  dependencies: ResolvePracticeStartDependencies
): ResolvedPracticeStart {
  const timerEnabled = request?.timerEnabled === true;
  const timerSeconds = clampPracticeTimerSeconds(request?.timerSeconds);
  const sharedPuzzle = request?.sharedPuzzle;
  if (sharedPuzzle !== undefined) {
    const materialized = materializeSharedPracticePuzzle(sharedPuzzle, dependencies.solvePuzzle);
    if (!materialized) {
      return {
        ok: false,
        message: INVALID_SHARED_PUZZLE_MESSAGE
      };
    }
    return {
      ok: true,
      difficulty: materialized.difficulty,
      puzzle: materialized.puzzle,
      isShared: true,
      timerEnabled,
      timerSeconds
    };
  }

  const resolvedDifficulty = clampPracticeDifficulty(request?.difficulty);
  return {
    ok: true,
    difficulty: resolvedDifficulty,
    puzzle: dependencies.generatePuzzle(resolvedDifficulty),
    isShared: false,
    timerEnabled,
    timerSeconds
  };
}
