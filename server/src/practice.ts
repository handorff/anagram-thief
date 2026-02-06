import { randomUUID } from "node:crypto";
import type {
  PracticeDifficulty,
  PracticeExistingWord,
  PracticePuzzle,
  PracticeResult,
  PracticeScoredWord,
  Tile
} from "../../shared/types.js";
import { MIN_WORD_LENGTH, normalizeWord } from "../../shared/wordValidation.js";

const LETTER_A_CODE = "A".charCodeAt(0);
const LETTER_PATTERN = /^[A-Z]+$/;
const PRACTICE_GENERATION_ATTEMPTS = 250;

export const DEFAULT_PRACTICE_DIFFICULTY: PracticeDifficulty = 3;

type LetterCounts = Uint8Array;

type DictionaryEntry = {
  word: string;
  counts: LetterCounts;
  length: number;
};

type ExistingWordMeta = {
  text: string;
  length: number;
  counts: LetterCounts;
};

export type DifficultyProfile = {
  existingWordCountMin: number;
  existingWordCountMax: number;
  existingWordLengthMin: number;
  existingWordLengthMax: number;
  centerTileCountMin: number;
  centerTileCountMax: number;
};

type PracticeEngineState = {
  entries: DictionaryEntry[];
  entriesByLength: Map<number, DictionaryEntry[]>;
  wordToEntry: Map<string, DictionaryEntry>;
};

const DIFFICULTY_PROFILES: Record<PracticeDifficulty, DifficultyProfile> = {
  1: {
    existingWordCountMin: 0,
    existingWordCountMax: 1,
    existingWordLengthMin: 4,
    existingWordLengthMax: 5,
    centerTileCountMin: 6,
    centerTileCountMax: 8
  },
  2: {
    existingWordCountMin: 1,
    existingWordCountMax: 2,
    existingWordLengthMin: 4,
    existingWordLengthMax: 6,
    centerTileCountMin: 6,
    centerTileCountMax: 8
  },
  3: {
    existingWordCountMin: 1,
    existingWordCountMax: 3,
    existingWordLengthMin: 5,
    existingWordLengthMax: 7,
    centerTileCountMin: 7,
    centerTileCountMax: 9
  },
  4: {
    existingWordCountMin: 2,
    existingWordCountMax: 4,
    existingWordLengthMin: 6,
    existingWordLengthMax: 8,
    centerTileCountMin: 7,
    centerTileCountMax: 10
  },
  5: {
    existingWordCountMin: 3,
    existingWordCountMax: 5,
    existingWordLengthMin: 7,
    existingWordLengthMax: 10,
    centerTileCountMin: 8,
    centerTileCountMax: 11
  }
};

export function clampPracticeDifficulty(value: unknown): PracticeDifficulty {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_PRACTICE_DIFFICULTY;
  }
  const rounded = Math.round(value);
  if (rounded <= 1) return 1;
  if (rounded >= 5) return 5;
  return rounded as PracticeDifficulty;
}

export function getPracticeDifficultyProfile(difficulty: PracticeDifficulty): DifficultyProfile {
  return DIFFICULTY_PROFILES[difficulty];
}

function toLetterCounts(word: string): LetterCounts {
  const counts = new Uint8Array(26);
  for (let index = 0; index < word.length; index += 1) {
    const letterCode = word.charCodeAt(index) - LETTER_A_CODE;
    if (letterCode >= 0 && letterCode < 26) {
      counts[letterCode] += 1;
    }
  }
  return counts;
}

function sumLetterCounts(counts: LetterCounts): number {
  let sum = 0;
  for (let index = 0; index < counts.length; index += 1) {
    sum += counts[index];
  }
  return sum;
}

function containsAllLetters(whole: LetterCounts, part: LetterCounts): boolean {
  for (let index = 0; index < whole.length; index += 1) {
    if (whole[index] < part[index]) {
      return false;
    }
  }
  return true;
}

function subtractLetterCounts(whole: LetterCounts, part: LetterCounts): LetterCounts {
  const diff = new Uint8Array(26);
  for (let index = 0; index < whole.length; index += 1) {
    const value = whole[index] - part[index];
    diff[index] = value > 0 ? value : 0;
  }
  return diff;
}

function randomInt(minInclusive: number, maxInclusive: number): number {
  if (maxInclusive <= minInclusive) return minInclusive;
  return minInclusive + Math.floor(Math.random() * (maxInclusive - minInclusive + 1));
}

function randomFromArray<T>(values: T[]): T {
  return values[Math.floor(Math.random() * values.length)];
}

function shuffleLetters(letters: string[]): string[] {
  const copy = [...letters];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const temp = copy[index];
    copy[index] = copy[swapIndex];
    copy[swapIndex] = temp;
  }
  return copy;
}

function buildEngineState(wordSet: Set<string>): PracticeEngineState {
  const entries: DictionaryEntry[] = Array.from(wordSet)
    .map((word) => normalizeWord(word))
    .filter((word) => word.length >= MIN_WORD_LENGTH && LETTER_PATTERN.test(word))
    .sort((a, b) => a.localeCompare(b))
    .map((word) => ({
      word,
      counts: toLetterCounts(word),
      length: word.length
    }));

  const wordToEntry = new Map(entries.map((entry) => [entry.word, entry]));
  const entriesByLength = new Map<number, DictionaryEntry[]>();
  for (const entry of entries) {
    const existing = entriesByLength.get(entry.length) ?? [];
    existing.push(entry);
    entriesByLength.set(entry.length, existing);
  }

  return {
    entries,
    entriesByLength,
    wordToEntry
  };
}

function parseExistingWords(words: PracticeExistingWord[]): ExistingWordMeta[] {
  return words
    .map((word) => normalizeWord(word.text))
    .filter((text) => text.length >= MIN_WORD_LENGTH && LETTER_PATTERN.test(text))
    .map((text) => ({
      text,
      length: text.length,
      counts: toLetterCounts(text)
    }));
}

function toCenterCounts(centerTiles: Tile[]): LetterCounts {
  const counts = new Uint8Array(26);
  for (const tile of centerTiles) {
    const normalized = normalizeWord(tile.letter);
    if (!normalized || normalized.length !== 1) continue;
    const letterCode = normalized.charCodeAt(0) - LETTER_A_CODE;
    if (letterCode < 0 || letterCode >= 26) continue;
    counts[letterCode] += 1;
  }
  return counts;
}

function compareScoredWords(a: PracticeScoredWord, b: PracticeScoredWord): number {
  if (a.score !== b.score) {
    return b.score - a.score;
  }
  if (a.baseScore !== b.baseScore) {
    return b.baseScore - a.baseScore;
  }
  return a.word.localeCompare(b.word);
}

function recordBestOption(bestByWord: Map<string, PracticeScoredWord>, candidate: PracticeScoredWord) {
  const existing = bestByWord.get(candidate.word);
  if (!existing) {
    bestByWord.set(candidate.word, candidate);
    return;
  }
  if (candidate.score < existing.score) {
    return;
  }
  if (candidate.score > existing.score) {
    bestByWord.set(candidate.word, candidate);
    return;
  }
  if (candidate.source === "steal" && existing.source !== "steal") {
    bestByWord.set(candidate.word, candidate);
    return;
  }
  if (candidate.source === "steal" && existing.source === "steal") {
    const existingStolenFrom = existing.stolenFrom ?? "";
    const candidateStolenFrom = candidate.stolenFrom ?? "";
    if (candidateStolenFrom.localeCompare(existingStolenFrom) < 0) {
      bestByWord.set(candidate.word, candidate);
    }
  }
}

function solvePuzzleWithState(state: PracticeEngineState, puzzle: PracticePuzzle): PracticeScoredWord[] {
  const centerCounts = toCenterCounts(puzzle.centerTiles);
  const existingWords = parseExistingWords(puzzle.existingWords);
  const maxExistingLength = existingWords.reduce((max, word) => Math.max(max, word.length), 0);
  const maxCandidateLength = Math.max(sumLetterCounts(centerCounts), sumLetterCounts(centerCounts) + maxExistingLength);

  const bestByWord = new Map<string, PracticeScoredWord>();
  for (const entry of state.entries) {
    if (entry.length > maxCandidateLength) continue;

    if (containsAllLetters(centerCounts, entry.counts)) {
      const baseScore = entry.length;
      recordBestOption(bestByWord, {
        word: entry.word,
        score: baseScore,
        baseScore,
        stolenLetters: 0,
        source: "center"
      });
    }

    if (existingWords.length === 0) {
      continue;
    }

    for (const existingWord of existingWords) {
      if (entry.length <= existingWord.length) continue;
      if (entry.word.includes(existingWord.text)) continue;
      if (!containsAllLetters(entry.counts, existingWord.counts)) continue;

      const requiredFromCenter = subtractLetterCounts(entry.counts, existingWord.counts);
      const requiredCount = sumLetterCounts(requiredFromCenter);
      if (requiredCount < 1) continue;
      if (!containsAllLetters(centerCounts, requiredFromCenter)) continue;

      const baseScore = entry.length;
      const stolenLetters = existingWord.length;
      recordBestOption(bestByWord, {
        word: entry.word,
        score: baseScore + stolenLetters,
        baseScore,
        stolenLetters,
        source: "steal",
        stolenFrom: existingWord.text
      });
    }
  }

  return Array.from(bestByWord.values()).sort(compareScoredWords);
}

function chooseExistingWords(
  state: PracticeEngineState,
  count: number,
  difficulty: PracticeDifficulty,
  excludedWords: Set<string>
): PracticeExistingWord[] {
  const profile = getPracticeDifficultyProfile(difficulty);
  const pickedWords: PracticeExistingWord[] = [];
  const seenWords = new Set(excludedWords);
  const candidates: DictionaryEntry[] = [];

  for (let length = profile.existingWordLengthMin; length <= profile.existingWordLengthMax; length += 1) {
    const wordsAtLength = state.entriesByLength.get(length);
    if (!wordsAtLength) continue;
    candidates.push(...wordsAtLength);
  }
  if (candidates.length === 0) {
    candidates.push(...state.entries);
  }

  const shuffledCandidates = shuffleLetters(candidates.map((entry) => entry.word));
  for (const word of shuffledCandidates) {
    if (pickedWords.length >= count) break;
    if (seenWords.has(word)) continue;
    seenWords.add(word);
    pickedWords.push({
      id: randomUUID(),
      text: word
    });
  }

  return pickedWords;
}

function chooseCenterTiles(
  state: PracticeEngineState,
  targetTileCount: number,
  difficulty: PracticeDifficulty
): Tile[] {
  if (state.entries.length === 0) {
    return "TEAM".split("").map((letter) => ({
      id: randomUUID(),
      letter
    }));
  }

  const profile = getPracticeDifficultyProfile(difficulty);
  const maxAnchorLength = Math.min(targetTileCount, profile.existingWordLengthMax + 2);
  const minAnchorLength = Math.max(MIN_WORD_LENGTH, Math.min(targetTileCount, profile.existingWordLengthMin));
  const anchorCandidates: DictionaryEntry[] = [];

  for (let length = minAnchorLength; length <= maxAnchorLength; length += 1) {
    const wordsAtLength = state.entriesByLength.get(length);
    if (!wordsAtLength) continue;
    anchorCandidates.push(...wordsAtLength);
  }

  const anchorWord =
    anchorCandidates.length > 0 ? randomFromArray(anchorCandidates).word : randomFromArray(state.entries).word;
  const letters = shuffleLetters(anchorWord.split(""));

  while (letters.length < targetTileCount) {
    const randomWord = randomFromArray(state.entries).word;
    letters.push(randomWord[Math.floor(Math.random() * randomWord.length)]);
  }

  return letters.slice(0, targetTileCount).map((letter) => ({
    id: randomUUID(),
    letter
  }));
}

function fallbackPuzzle(state: PracticeEngineState): PracticePuzzle {
  const fallbackWord = state.entries[0]?.word ?? "TEAM";
  const centerTiles = fallbackWord.split("").map((letter) => ({
    id: randomUUID(),
    letter
  }));

  return {
    id: randomUUID(),
    centerTiles,
    existingWords: []
  };
}

export function solvePracticePuzzle(
  wordSet: Set<string>,
  puzzle: PracticePuzzle
): PracticeScoredWord[] {
  return solvePuzzleWithState(buildEngineState(wordSet), puzzle);
}

export function createPracticePuzzle(
  wordSet: Set<string>,
  difficulty: PracticeDifficulty
): PracticePuzzle {
  const state = buildEngineState(wordSet);
  return createPracticeEngineFromState(state).generatePuzzle(difficulty);
}

function createPracticeEngineFromState(state: PracticeEngineState) {
  return {
    generatePuzzle(difficulty: PracticeDifficulty): PracticePuzzle {
      if (state.entries.length === 0) {
        return fallbackPuzzle(state);
      }

      const clampedDifficulty = clampPracticeDifficulty(difficulty);
      const profile = getPracticeDifficultyProfile(clampedDifficulty);

      for (let attempt = 0; attempt < PRACTICE_GENERATION_ATTEMPTS; attempt += 1) {
        const centerTileCount = randomInt(profile.centerTileCountMin, profile.centerTileCountMax);
        const centerTiles = chooseCenterTiles(state, centerTileCount, clampedDifficulty);
        const existingWordCount = randomInt(profile.existingWordCountMin, profile.existingWordCountMax);
        const excludedWords = new Set<string>();
        const existingWords = chooseExistingWords(
          state,
          existingWordCount,
          clampedDifficulty,
          excludedWords
        );
        const puzzle: PracticePuzzle = {
          id: randomUUID(),
          centerTiles,
          existingWords
        };
        const options = solvePuzzleWithState(state, puzzle);
        if (options.length > 0) {
          return puzzle;
        }
      }

      return fallbackPuzzle(state);
    },
    solvePuzzle(puzzle: PracticePuzzle): PracticeScoredWord[] {
      return solvePuzzleWithState(state, puzzle);
    },
    evaluateSubmission(puzzle: PracticePuzzle, submittedWordRaw: string): PracticeResult {
      const allOptions = solvePuzzleWithState(state, puzzle);
      const bestScore = allOptions[0]?.score ?? 0;
      const submittedWordNormalized = normalizeWord(typeof submittedWordRaw === "string" ? submittedWordRaw : "");

      if (!submittedWordNormalized) {
        return {
          submittedWordRaw,
          submittedWordNormalized,
          isValid: false,
          isBestPlay: false,
          score: 0,
          invalidReason: "Enter a word to submit.",
          bestScore,
          allOptions
        };
      }
      if (!LETTER_PATTERN.test(submittedWordNormalized)) {
        return {
          submittedWordRaw,
          submittedWordNormalized,
          isValid: false,
          isBestPlay: false,
          score: 0,
          invalidReason: "Word must contain only letters A-Z.",
          bestScore,
          allOptions
        };
      }
      if (submittedWordNormalized.length < MIN_WORD_LENGTH) {
        return {
          submittedWordRaw,
          submittedWordNormalized,
          isValid: false,
          isBestPlay: false,
          score: 0,
          invalidReason: `Word must be at least ${MIN_WORD_LENGTH} letters.`,
          bestScore,
          allOptions
        };
      }
      if (!state.wordToEntry.has(submittedWordNormalized)) {
        return {
          submittedWordRaw,
          submittedWordNormalized,
          isValid: false,
          isBestPlay: false,
          score: 0,
          invalidReason: "Word is not in the dictionary.",
          bestScore,
          allOptions
        };
      }

      const matchedOption = allOptions.find((option) => option.word === submittedWordNormalized);
      if (!matchedOption) {
        return {
          submittedWordRaw,
          submittedWordNormalized,
          isValid: false,
          isBestPlay: false,
          score: 0,
          invalidReason: "Word cannot be claimed from this puzzle.",
          bestScore,
          allOptions
        };
      }

      return {
        submittedWordRaw,
        submittedWordNormalized,
        isValid: true,
        isBestPlay: matchedOption.score === bestScore,
        score: matchedOption.score,
        bestScore,
        allOptions
      };
    }
  };
}

export function createPracticeEngine(wordSet: Set<string>) {
  const state = buildEngineState(wordSet);
  return createPracticeEngineFromState(state);
}
