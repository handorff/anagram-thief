import type {
  PracticeDifficulty,
  PracticePuzzle,
  PracticeResultSharePayload,
  PracticeSharePayload
} from "./types.js";
import {
  buildPracticeSharePayload,
  decodePracticeSharePayload,
  encodePracticeSharePayload
} from "./practiceShare.js";
import { normalizeWord } from "./wordValidation.js";

const PRACTICE_RESULT_SHARE_VERSION = 1;
const PRACTICE_RESULT_SHARE_PART_SEPARATOR = ".";
const LETTER_PATTERN = /^[A-Z]+$/;
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE64URL_LOOKUP = new Map(
  BASE64URL_ALPHABET.split("").map((character, index) => [character, index])
);

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

function encodeDisplayName(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return bytesToBase64Url(bytes);
}

function decodeDisplayName(value: string): string | null {
  const bytes = base64UrlToBytes(value);
  if (!bytes) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function normalizeResultAnswer(value: string): string {
  return normalizeWord(value);
}

function normalizeSharerName(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function isValidAnswer(value: string): boolean {
  return LETTER_PATTERN.test(value);
}

function isPracticeResultSharePayload(payload: PracticeResultSharePayload): payload is PracticeResultSharePayload {
  if (payload.v !== PRACTICE_RESULT_SHARE_VERSION) return false;
  if (!isValidAnswer(payload.a)) return false;
  if (payload.n !== undefined && payload.n.trim().length === 0) return false;
  return true;
}

export function buildPracticeResultSharePayload(
  difficulty: PracticeDifficulty,
  puzzle: PracticePuzzle,
  submittedWord: string,
  sharerName?: string
): PracticeResultSharePayload {
  const practicePayload: PracticeSharePayload = buildPracticeSharePayload(difficulty, puzzle);
  const normalizedAnswer = normalizeResultAnswer(submittedWord);
  const normalizedName = normalizeSharerName(sharerName);
  return {
    v: PRACTICE_RESULT_SHARE_VERSION,
    p: practicePayload,
    a: normalizedAnswer,
    ...(normalizedName ? { n: normalizedName } : {})
  };
}

export function encodePracticeResultSharePayload(payload: PracticeResultSharePayload): string {
  if (!isPracticeResultSharePayload(payload)) {
    throw new Error("Invalid practice result share payload.");
  }

  const parts = [
    String(PRACTICE_RESULT_SHARE_VERSION),
    encodePracticeSharePayload(payload.p),
    payload.a
  ];
  if (payload.n !== undefined) {
    parts.push(encodeDisplayName(payload.n));
  }
  return parts.join(PRACTICE_RESULT_SHARE_PART_SEPARATOR);
}

export function decodePracticeResultSharePayload(token: string): PracticeResultSharePayload | null {
  if (typeof token !== "string") return null;
  const trimmed = token.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(PRACTICE_RESULT_SHARE_PART_SEPARATOR);
  if (parts.length !== 3 && parts.length !== 4) return null;
  if (parts[0] !== String(PRACTICE_RESULT_SHARE_VERSION)) return null;

  const puzzlePayload = decodePracticeSharePayload(parts[1]);
  if (!puzzlePayload) return null;

  const normalizedAnswer = normalizeResultAnswer(parts[2]);
  if (!isValidAnswer(normalizedAnswer)) return null;

  const decodedName = parts.length === 4 ? decodeDisplayName(parts[3]) : undefined;
  if (parts.length === 4 && decodedName === null) return null;
  const normalizedName = normalizeSharerName(decodedName ?? undefined);

  return {
    v: PRACTICE_RESULT_SHARE_VERSION,
    p: puzzlePayload,
    a: normalizedAnswer,
    ...(normalizedName ? { n: normalizedName } : {})
  };
}
