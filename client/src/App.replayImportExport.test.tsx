import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReplayFileV1,
  parseReplayFile,
  serializeReplayFile
} from "../../shared/replayFile.ts";
import type { ReplayAnalysisResult } from "../../shared/types.ts";
import {
  buildReplayExportFilename,
  getImportedReplayAnalysis,
  toReplayAnalysisMap
} from "./replayImportExport";

function makeReplayAnalysisResult(): ReplayAnalysisResult {
  return {
    requestedStepIndex: 1,
    stepKind: "claim-succeeded",
    basis: "before-claim",
    basisStepIndex: 0,
    bestScore: 5,
    allOptions: [
      {
        word: "TEAMS",
        score: 5,
        baseScore: 5,
        stolenLetters: 0,
        source: "center"
      }
    ]
  };
}

test("buildReplayExportFilename includes expected prefix and json extension", () => {
  const fileName = buildReplayExportFilename(Date.UTC(2026, 1, 7, 9, 5, 3));
  assert.match(fileName, /^anagram-thief-replay-\d{8}-\d{6}\.json$/);
});

test("toReplayAnalysisMap converts numeric keys to string keys", () => {
  const analysis = makeReplayAnalysisResult();
  const mapped = toReplayAnalysisMap({
    1: analysis
  });
  assert.ok(mapped);
  assert.equal(mapped?.["1"]?.bestScore, 5);
  assert.equal(mapped?.["1"]?.requestedStepIndex, 1);
});

test("import parse accepts valid replay export and exposes analysis by step", () => {
  const analysis = makeReplayAnalysisResult();
  const replayFile = buildReplayFileV1({
    replay: {
      steps: [
        {
          index: 0,
          at: 100,
          kind: "flip-revealed",
          state: {
            roomId: "room-1",
            status: "ended",
            bagCount: 10,
            centerTiles: [{ id: "t1", letter: "A" }],
            players: [
              {
                id: "p1",
                name: "Alice",
                score: 0,
                words: [],
                preStealEntries: []
              }
            ],
            turnPlayerId: "p1",
            claimWindow: null,
            claimCooldowns: {},
            pendingFlip: null,
            preStealEnabled: true,
            preStealPrecedenceOrder: ["p1"],
            lastClaimEvent: null
          }
        },
        {
          index: 1,
          at: 101,
          kind: "claim-succeeded",
          state: {
            roomId: "room-1",
            status: "ended",
            bagCount: 9,
            centerTiles: [],
            players: [
              {
                id: "p1",
                name: "Alice",
                score: 5,
                words: [],
                preStealEntries: []
              }
            ],
            turnPlayerId: "p1",
            claimWindow: null,
            claimCooldowns: {},
            pendingFlip: null,
            preStealEnabled: true,
            preStealPrecedenceOrder: ["p1"],
            lastClaimEvent: null
          }
        }
      ]
    },
    analysisByStepIndex: {
      "1": analysis
    },
    sourceRoomId: "room-1",
    app: "anagram-thief-web",
    exportedAt: 1_700_000_000_000
  });

  const parsed = parseReplayFile(serializeReplayFile(replayFile));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const importedAnalysis = getImportedReplayAnalysis(parsed.file, 1);
  assert.ok(importedAnalysis);
  assert.equal(importedAnalysis?.bestScore, 5);
});

test("import parse rejects invalid replay files", () => {
  const parsed = parseReplayFile("{\"kind\":\"anagram-thief-replay\",\"v\":2}");
  assert.equal(parsed.ok, false);
});

test("imported replay analysis returns null when missing", () => {
  const replayFile = buildReplayFileV1({
    replay: {
      steps: [
        {
          index: 0,
          at: 100,
          kind: "flip-revealed",
          state: {
            roomId: "room-1",
            status: "ended",
            bagCount: 10,
            centerTiles: [{ id: "t1", letter: "A" }],
            players: [
              {
                id: "p1",
                name: "Alice",
                score: 0,
                words: [],
                preStealEntries: []
              }
            ],
            turnPlayerId: "p1",
            claimWindow: null,
            claimCooldowns: {},
            pendingFlip: null,
            preStealEnabled: true,
            preStealPrecedenceOrder: ["p1"],
            lastClaimEvent: null
          }
        }
      ]
    }
  });

  const result = getImportedReplayAnalysis(replayFile, 0);
  assert.equal(result, null);
});
