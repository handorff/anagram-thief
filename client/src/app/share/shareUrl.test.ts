import assert from "node:assert/strict";
import test from "node:test";
import { encodePracticeSharePayload } from "@shared/practiceShare";
import { encodePracticeResultSharePayload } from "@shared/practiceResultShare";
import {
  buildPracticePuzzleFingerprint,
  buildPracticePuzzleFingerprintFromState,
  readPendingPrivateRoomJoinFromUrl,
  readPendingSharedLaunchFromUrl,
  removePracticeShareFromUrl,
  removePrivateRoomJoinFromUrl
} from "./shareUrl";

function withWindowSearch(search: string, run: () => void) {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const location = {
    search,
    pathname: "/",
    hash: "",
    origin: "http://localhost"
  };
  const history = {
    state: null as unknown,
    replaceState: (_state: unknown, _title: string, nextUrl: string) => {
      const queryIndex = nextUrl.indexOf("?");
      location.search = queryIndex >= 0 ? nextUrl.slice(queryIndex) : "";
    }
  };
  (globalThis as { window: unknown }).window = {
    location,
    history
  };

  try {
    run();
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window: unknown }).window = originalWindow;
    }
  }
}

test("buildPracticePuzzleFingerprint formats center and words", () => {
  assert.equal(buildPracticePuzzleFingerprint({ c: "TEAM", w: ["RATE", "ALERT"] }), "TEAM|RATE,ALERT");
});

test("buildPracticePuzzleFingerprintFromState normalizes puzzle values", () => {
  const fingerprint = buildPracticePuzzleFingerprintFromState({
    id: "p1",
    centerTiles: [{ id: "t1", letter: "t" }, { id: "t2", letter: "e" }],
    existingWords: [{ id: "w1", text: "team" }]
  });
  assert.equal(fingerprint, "TE|TEAM");
});

test("readPendingSharedLaunchFromUrl parses practice token", () => {
  const token = encodePracticeSharePayload({ v: 2, d: 3, c: "TEAM", w: ["RATE"] });
  withWindowSearch(`?practice=${encodeURIComponent(token)}`, () => {
    const launch = readPendingSharedLaunchFromUrl();
    assert.equal(launch?.kind, "puzzle");
    assert.equal(launch?.payload.c, "TEAM");
  });
});

test("readPendingSharedLaunchFromUrl parses result token", () => {
  const token = encodePracticeResultSharePayload({
    v: 1,
    p: { v: 2, d: 2, c: "TEAM", w: ["RATE"] },
    a: "TEAMS",
    n: "Paul"
  });
  withWindowSearch(`?practiceResult=${encodeURIComponent(token)}`, () => {
    const launch = readPendingSharedLaunchFromUrl();
    assert.equal(launch?.kind, "result");
    assert.equal(launch?.submittedWord, "TEAMS");
  });
});

test("private room helpers parse and remove query params", () => {
  withWindowSearch("?room=abc123&code=4567", () => {
    const pending = readPendingPrivateRoomJoinFromUrl();
    assert.deepEqual(pending, { roomId: "abc123", code: "4567" });
    removePrivateRoomJoinFromUrl();
    assert.equal((window as { location: { search: string } }).location.search, "");
  });
});

test("removePracticeShareFromUrl strips practice params", () => {
  withWindowSearch("?practice=abc&practiceResult=def", () => {
    removePracticeShareFromUrl();
    assert.equal((window as { location: { search: string } }).location.search, "");
  });
});
