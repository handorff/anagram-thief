import natural from "natural";
import { normalizeWord } from "../../shared/wordValidation.js";

const { PorterStemmer } = natural;

const LETTER_PATTERN = /^[A-Z]+$/;
const STEMMABLE_PATTERN = /^[A-Z]{2,}$/;
const VOWELS = new Set(["A", "E", "I", "O", "U"]);

const PREFIXES = [
  "UNDER",
  "OVER",
  "POST",
  "OUT",
  "NON",
  "MIS",
  "PRE",
  "DIS",
  "UN",
  "RE",
  "DE",
  "IM",
  "IL",
  "IR",
  "IN"
] as const;

const SUFFIXES = [
  "NESS",
  "MENT",
  "TION",
  "SION",
  "ABLE",
  "IBLE",
  "IAL",
  "ING",
  "EST",
  "FUL",
  "LESS",
  "IES",
  "LY",
  "ED",
  "ER",
  "EN",
  "ES",
  "AL",
  "IC",
  "Y",
  "S"
] as const;

type SuffixRule = (typeof SUFFIXES)[number];

function normalizeAlphabeticWord(word: string): string {
  const normalized = normalizeWord(word);
  if (!LETTER_PATTERN.test(normalized)) return "";
  return normalized;
}

function maybeCollapseTrailingDoubleConsonant(word: string): string | null {
  if (word.length < 2) return null;
  const tail = word[word.length - 1];
  if (tail !== word[word.length - 2]) return null;
  if (VOWELS.has(tail)) return null;
  const collapsed = word.slice(0, -1);
  return STEMMABLE_PATTERN.test(collapsed) ? collapsed : null;
}

function normalizeAfterSuffixStrip(root: string, suffix: SuffixRule): string[] {
  const variants = new Set<string>();
  if (STEMMABLE_PATTERN.test(root)) {
    variants.add(root);
  }

  if (suffix === "IES") {
    const iesToY = `${root}Y`;
    if (STEMMABLE_PATTERN.test(iesToY)) {
      variants.add(iesToY);
    }
  }

  if (root.endsWith("I")) {
    const iToY = `${root.slice(0, -1)}Y`;
    if (STEMMABLE_PATTERN.test(iToY)) {
      variants.add(iToY);
    }
  }

  const collapsed = maybeCollapseTrailingDoubleConsonant(root);
  if (collapsed) {
    variants.add(collapsed);
  }

  if (suffix === "ED" || suffix === "ING" || suffix === "ER" || suffix === "EST") {
    const withSilentE = `${root}E`;
    if (STEMMABLE_PATTERN.test(withSilentE)) {
      variants.add(withSilentE);
    }
  }

  return Array.from(variants);
}

function collectPrefixCandidates(normalizedWord: string): string[] {
  const candidates = new Set<string>([normalizedWord]);
  for (const prefix of PREFIXES) {
    if (!normalizedWord.startsWith(prefix)) continue;
    const stripped = normalizedWord.slice(prefix.length);
    if (!STEMMABLE_PATTERN.test(stripped)) continue;
    candidates.add(stripped);
  }
  return Array.from(candidates);
}

function collectDerivationCandidates(normalizedWord: string): string[] {
  const candidates = new Set<string>();
  for (const base of collectPrefixCandidates(normalizedWord)) {
    candidates.add(base);
    for (const suffix of SUFFIXES) {
      if (!base.endsWith(suffix)) continue;
      const root = base.slice(0, -suffix.length);
      for (const variant of normalizeAfterSuffixStrip(root, suffix)) {
        candidates.add(variant);
      }
    }
  }
  return Array.from(candidates);
}

export function getWordFamilySignatures(word: string): readonly string[] {
  const normalizedWord = normalizeAlphabeticWord(word);
  if (!normalizedWord) return [];

  const signatures = new Set<string>();
  for (const candidate of collectDerivationCandidates(normalizedWord)) {
    if (!STEMMABLE_PATTERN.test(candidate)) continue;
    const stem = normalizeWord(PorterStemmer.stem(candidate.toLowerCase()));
    if (!STEMMABLE_PATTERN.test(stem)) continue;
    signatures.add(stem);
  }

  return Array.from(signatures).sort((a, b) => a.localeCompare(b));
}

export function doFamilySignaturesOverlap(
  left: readonly string[],
  right: readonly string[]
): boolean {
  if (left.length === 0 || right.length === 0) return false;
  const rightSet = new Set(right);
  for (const signature of left) {
    if (rightSet.has(signature)) {
      return true;
    }
  }
  return false;
}

export function areWordsSameFamily(a: string, b: string): boolean {
  const left = getWordFamilySignatures(a);
  const right = getWordFamilySignatures(b);
  return doFamilySignaturesOverlap(left, right);
}
