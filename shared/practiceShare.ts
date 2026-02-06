import type { PracticeDifficulty, PracticePuzzle, PracticeSharePayload } from "./types.js";
import { normalizeWord } from "./wordValidation.js";

const PRACTICE_SHARE_VERSION = 2;
const LETTER_PATTERN = /^[A-Z]+$/;

const VERSION_BITS = 3;
const DIFFICULTY_BITS = 3;
const CENTER_LENGTH_BITS = 5;
const WORD_COUNT_BITS = 4;
const WORD_LENGTH_BITS = 5;
const LETTER_BITS = 5;
const LETTER_A_CODE = "A".charCodeAt(0);

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE64URL_LOOKUP = new Map(
  BASE64URL_ALPHABET.split("").map((character, index) => [character, index])
);

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

function letterToCode(letter: string): number {
  return letter.charCodeAt(0) - LETTER_A_CODE;
}

function codeToLetter(code: number): string | null {
  if (code < 0 || code > 25) return null;
  return String.fromCharCode(LETTER_A_CODE + code);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const byte1 = bytes[index];
    const byte2 = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const byte3 = index + 2 < bytes.length ? bytes[index + 2] : 0;

    const chunk = (byte1 << 16) | (byte2 << 8) | byte3;
    output += BASE64URL_ALPHABET[(chunk >>> 18) & 0x3f];
    output += BASE64URL_ALPHABET[(chunk >>> 12) & 0x3f];
    if (index + 1 < bytes.length) {
      output += BASE64URL_ALPHABET[(chunk >>> 6) & 0x3f];
    }
    if (index + 2 < bytes.length) {
      output += BASE64URL_ALPHABET[chunk & 0x3f];
    }
  }
  return output;
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!value) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;

  const remainder = value.length % 4;
  if (remainder === 1) return null;

  const fullQuadCount = Math.floor(value.length / 4);
  const trailingChars = value.length % 4;
  const byteLength = fullQuadCount * 3 + (trailingChars === 2 ? 1 : trailingChars === 3 ? 2 : 0);
  const bytes = new Uint8Array(byteLength);

  let byteIndex = 0;
  for (let index = 0; index < value.length; index += 4) {
    const char1 = value[index];
    const char2 = value[index + 1];
    const char3 = value[index + 2];
    const char4 = value[index + 3];

    const value1 = BASE64URL_LOOKUP.get(char1);
    const value2 = BASE64URL_LOOKUP.get(char2);
    if (value1 === undefined || value2 === undefined) return null;

    const value3 = char3 ? BASE64URL_LOOKUP.get(char3) : undefined;
    const value4 = char4 ? BASE64URL_LOOKUP.get(char4) : undefined;
    if (char3 && value3 === undefined) return null;
    if (char4 && value4 === undefined) return null;

    const chunk = (value1 << 18) | (value2 << 12) | ((value3 ?? 0) << 6) | (value4 ?? 0);
    bytes[byteIndex] = (chunk >>> 16) & 0xff;
    byteIndex += 1;
    if (char3 && byteIndex < bytes.length) {
      bytes[byteIndex] = (chunk >>> 8) & 0xff;
      byteIndex += 1;
    }
    if (char4 && byteIndex < bytes.length) {
      bytes[byteIndex] = chunk & 0xff;
      byteIndex += 1;
    }
  }

  return bytes;
}

class BitWriter {
  private bytes: number[] = [];
  private currentByte = 0;
  private bitsInCurrentByte = 0;

  write(value: number, bitCount: number): void {
    for (let shift = bitCount - 1; shift >= 0; shift -= 1) {
      const bit = (value >>> shift) & 1;
      this.currentByte = (this.currentByte << 1) | bit;
      this.bitsInCurrentByte += 1;
      if (this.bitsInCurrentByte === 8) {
        this.bytes.push(this.currentByte & 0xff);
        this.currentByte = 0;
        this.bitsInCurrentByte = 0;
      }
    }
  }

  finish(): Uint8Array {
    if (this.bitsInCurrentByte > 0) {
      this.bytes.push((this.currentByte << (8 - this.bitsInCurrentByte)) & 0xff);
      this.currentByte = 0;
      this.bitsInCurrentByte = 0;
    }
    return new Uint8Array(this.bytes);
  }
}

class BitReader {
  private byteIndex = 0;
  private bitIndex = 0;

  constructor(private bytes: Uint8Array) {}

  read(bitCount: number): number | null {
    let value = 0;
    for (let index = 0; index < bitCount; index += 1) {
      if (this.byteIndex >= this.bytes.length) return null;
      const byte = this.bytes[this.byteIndex];
      const bit = (byte >>> (7 - this.bitIndex)) & 1;
      value = (value << 1) | bit;

      this.bitIndex += 1;
      if (this.bitIndex === 8) {
        this.bitIndex = 0;
        this.byteIndex += 1;
      }
    }
    return value;
  }

  trailingBitsAreZero(): boolean {
    while (this.byteIndex < this.bytes.length) {
      const bit = (this.bytes[this.byteIndex] >>> (7 - this.bitIndex)) & 1;
      if (bit !== 0) return false;
      this.bitIndex += 1;
      if (this.bitIndex === 8) {
        this.bitIndex = 0;
        this.byteIndex += 1;
      }
    }
    return true;
  }
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
  const writer = new BitWriter();
  writer.write(PRACTICE_SHARE_VERSION, VERSION_BITS);
  writer.write(payload.d, DIFFICULTY_BITS);
  writer.write(payload.c.length, CENTER_LENGTH_BITS);
  writer.write(payload.w.length, WORD_COUNT_BITS);

  for (const word of payload.w) {
    writer.write(word.length, WORD_LENGTH_BITS);
  }

  for (const letter of payload.c) {
    writer.write(letterToCode(letter), LETTER_BITS);
  }
  for (const word of payload.w) {
    for (const letter of word) {
      writer.write(letterToCode(letter), LETTER_BITS);
    }
  }

  return bytesToBase64Url(writer.finish());
}

export function decodePracticeSharePayload(token: string): PracticeSharePayload | null {
  if (typeof token !== "string") return null;
  const trimmed = token.trim();
  if (!trimmed) return null;

  const bytes = base64UrlToBytes(trimmed);
  if (!bytes) return null;

  const reader = new BitReader(bytes);
  const version = reader.read(VERSION_BITS);
  if (version !== PRACTICE_SHARE_VERSION) return null;

  const difficulty = reader.read(DIFFICULTY_BITS);
  if (!isPracticeDifficulty(difficulty)) return null;

  const centerLength = reader.read(CENTER_LENGTH_BITS);
  if (centerLength === null || centerLength < 1) return null;

  const wordCount = reader.read(WORD_COUNT_BITS);
  if (wordCount === null) return null;

  const wordLengths: number[] = [];
  for (let index = 0; index < wordCount; index += 1) {
    const length = reader.read(WORD_LENGTH_BITS);
    if (length === null || length < 1) return null;
    wordLengths.push(length);
  }

  let centerLetters = "";
  for (let index = 0; index < centerLength; index += 1) {
    const code = reader.read(LETTER_BITS);
    if (code === null) return null;
    const letter = codeToLetter(code);
    if (!letter) return null;
    centerLetters += letter;
  }

  const words: string[] = [];
  for (const wordLength of wordLengths) {
    let word = "";
    for (let index = 0; index < wordLength; index += 1) {
      const code = reader.read(LETTER_BITS);
      if (code === null) return null;
      const letter = codeToLetter(code);
      if (!letter) return null;
      word += letter;
    }
    words.push(word);
  }

  if (!reader.trailingBitsAreZero()) return null;
  if (!LETTER_PATTERN.test(centerLetters)) return null;
  if (!words.every((word) => LETTER_PATTERN.test(word))) return null;

  return {
    v: PRACTICE_SHARE_VERSION,
    d: difficulty,
    c: centerLetters,
    w: words
  };
}
