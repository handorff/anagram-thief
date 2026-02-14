import assert from "node:assert/strict";
import test from "node:test";
import { createInactivePracticeState } from "../practice/practiceUtils";
import { appReducer, createInitialAppState } from "./appReducer";

function makeState() {
  return createInitialAppState({
    isConnected: true,
    playerName: "Paul",
    userSettings: {
      inputMethod: "typing",
      theme: "light",
      chatEnabled: true,
      bottomPanelMode: "log"
    },
    practiceState: createInactivePracticeState(),
    pendingSharedLaunch: null,
    pendingPrivateRoomJoin: null,
    defaultFlipTimerSeconds: 3,
    defaultClaimTimerSeconds: 10,
    defaultPracticeDifficulty: 2,
    defaultPracticeTimerSeconds: 90
  });
}

test("app/reset-on-leave-room clears replay and game ui transient state", () => {
  const initial = makeState();
  const prepared = appReducer(initial, {
    type: "game/patch",
    updater: {
      claimWord: "STEAL",
      queuedTileClaimLetters: "AB",
      chatDraft: "hello",
      gameLogEntries: [{ id: "1", timestamp: 1, text: "x", kind: "event" }]
    }
  });
  const prepared2 = appReducer(prepared, {
    type: "replay/patch",
    updater: {
      isReplayMode: true,
      replayStepIndex: 5,
      importReplayError: "bad"
    }
  });

  const next = appReducer(prepared2, { type: "app/reset-on-leave-room" });

  assert.equal(next.gameUi.claimWord, "");
  assert.equal(next.gameUi.queuedTileClaimLetters, "");
  assert.equal(next.gameUi.chatDraft, "");
  assert.equal(next.gameUi.gameLogEntries.length, 0);
  assert.equal(next.replayUi.isReplayMode, false);
  assert.equal(next.replayUi.replayStepIndex, 0);
  assert.equal(next.replayUi.importReplayError, null);
});

test("replay/reset clears replay slice but preserves unrelated slices", () => {
  const initial = makeState();
  const prepared = appReducer(initial, {
    type: "replay/patch",
    updater: {
      isReplayMode: true,
      replayStepIndex: 3,
      analysisError: "failed"
    }
  });

  const next = appReducer(prepared, { type: "replay/reset" });

  assert.equal(next.replayUi.isReplayMode, false);
  assert.equal(next.replayUi.replayStepIndex, 0);
  assert.equal(next.replayUi.analysisError, null);
  assert.equal(next.identity.playerName, "Paul");
});

test("practice/reset-inputs clears draft submit state and deactivates practice", () => {
  const initial = makeState();
  const prepared = appReducer(initial, {
    type: "practice/patch",
    updater: {
      practiceWord: "TEAM",
      submitError: "oops",
      pendingResultAutoSubmit: {
        submittedWord: "TEAM",
        expectedPuzzleFingerprint: "abc",
        expiresAt: Date.now() + 5000
      }
    }
  });

  const next = appReducer(prepared, { type: "practice/reset-inputs" });

  assert.equal(next.practiceUi.practiceWord, "");
  assert.equal(next.practiceUi.submitError, null);
  assert.equal(next.practiceUi.pendingResultAutoSubmit, null);
  assert.equal(next.server.practiceState.active, false);
});
