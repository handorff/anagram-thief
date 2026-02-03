import fs from "node:fs";

export const MIN_WORD_LENGTH = 4;

export function normalizeWord(word: string): string {
  return word.trim().toUpperCase();
}

export function loadWordSet(wordListPath: string): Set<string> {
  const raw = fs.readFileSync(wordListPath, "utf-8");
  const words = raw
    .split(/\r?\n/)
    .map((line) => normalizeWord(line))
    .filter(Boolean);
  return new Set(words);
}

export function isValidWord(word: string, wordSet: Set<string>): boolean {
  return word.length >= MIN_WORD_LENGTH && wordSet.has(word);
}
