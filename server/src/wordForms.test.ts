import assert from "node:assert/strict";
import test from "node:test";
import { areWordsSameFamily, doFamilySignaturesOverlap, getWordFamilySignatures } from "./wordForms.js";

test("areWordsSameFamily detects inflectional and derivational variants", () => {
  assert.equal(areWordsSameFamily("MILE", "MILES"), true);
  assert.equal(areWordsSameFamily("CLAP", "CLAPPING"), true);
  assert.equal(areWordsSameFamily("WALK", "WALKED"), true);
  assert.equal(areWordsSameFamily("HAPPY", "UNHAPPY"), true);
});

test("areWordsSameFamily does not block unrelated containment words", () => {
  assert.equal(areWordsSameFamily("MILE", "SMILE"), false);
  assert.equal(areWordsSameFamily("OUGHT", "THOUGHT"), false);
  assert.equal(areWordsSameFamily("EIGHT", "WEIGHT"), false);
});

test("doFamilySignaturesOverlap compares precomputed signatures", () => {
  const mile = getWordFamilySignatures("MILE");
  const miles = getWordFamilySignatures("MILES");
  const smile = getWordFamilySignatures("SMILE");

  assert.equal(doFamilySignaturesOverlap(mile, miles), true);
  assert.equal(doFamilySignaturesOverlap(mile, smile), false);
});
