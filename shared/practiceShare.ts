import type { PracticeDifficulty, PracticePuzzle, PracticeSharePayload } from "./types.js";
import { normalizeWord } from "./wordValidation.js";

const PRACTICE_SHARE_VERSION = 1;
const LETTER_PATTERN = /^[A-Z]+$/;
const TOKEN_SEPARATOR = ".";
const WORD_SEPARATOR = "~";

function isPracticeDifficulty(value: unknown): value is PracticeDifficulty {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

function normalizeCenterLetters(puzzle: PracticePuzzle): string {
  return puzzle.centerTiles
    .map((tile) => normalizeWord(tile.letter))
    .filter((letter) => letter.length === 1 && LETTER_PATTERN.test(letter))
    .join("");
}

function normalizeExistingWords(puzzle: PracticePuzzle): string[] {
  return puzzle.existingWords
    .map((existingWord) => normalizeWord(existingWord.text))
    .filter((word) => word.length > 0 && LETTER_PATTERN.test(word));
}

function parseWordSection(section: string): string[] | null {
  if (!section) return [];
  const words = section.split(WORD_SEPARATOR);
  for (const word of words) {
    if (!word || !LETTER_PATTERN.test(word)) {
      return null;
    }
  }
  return words;
}

export function buildPracticeSharePayload(
  difficulty: PracticeDifficulty,
  puzzle: PracticePuzzle
): PracticeSharePayload {
  return {
    v: PRACTICE_SHARE_VERSION,
    d: difficulty,
    c: normalizeCenterLetters(puzzle),
    w: normalizeExistingWords(puzzle)
  };
}

export function encodePracticeSharePayload(payload: PracticeSharePayload): string {
  const wordsPart = payload.w.join(WORD_SEPARATOR);
  return `${payload.v}${TOKEN_SEPARATOR}${payload.d}${TOKEN_SEPARATOR}${payload.c}${TOKEN_SEPARATOR}${wordsPart}`;
}

export function decodePracticeSharePayload(token: string): PracticeSharePayload | null {
  if (typeof token !== "string") return null;
  const trimmed = token.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(TOKEN_SEPARATOR);
  if (parts.length !== 4) return null;

  const [versionPart, difficultyPart, centerPart, wordsPart] = parts;
  if (versionPart !== String(PRACTICE_SHARE_VERSION)) return null;

  const difficulty = Number(difficultyPart);
  if (!isPracticeDifficulty(difficulty)) return null;

  const centerLetters = normalizeWord(centerPart);
  if (!centerLetters || !LETTER_PATTERN.test(centerLetters)) return null;

  const words = parseWordSection(wordsPart);
  if (!words) return null;

  const normalizedWords = words.map((word) => normalizeWord(word));
  if (normalizedWords.some((word) => !word || !LETTER_PATTERN.test(word))) {
    return null;
  }

  return {
    v: PRACTICE_SHARE_VERSION,
    d: difficulty,
    c: centerLetters,
    w: normalizedWords
  };
}
