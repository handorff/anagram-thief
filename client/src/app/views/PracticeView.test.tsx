import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  PracticeModeState,
  PracticeResult
} from "@shared/types";
import {
  buildUserSettingsContextValue,
  DEFAULT_USER_SETTINGS,
  UserSettingsContext
} from "../../userSettings";
import { PracticeView } from "./PracticeView";

const basePracticeState: PracticeModeState = {
  active: true,
  phase: "puzzle",
  currentDifficulty: 3,
  queuedDifficulty: 3,
  timerEnabled: false,
  timerSeconds: 60,
  puzzleTimerEndsAt: null,
  puzzle: {
    id: "puzzle-1",
    centerTiles: [
      { id: "tile-a", letter: "A" },
      { id: "tile-b", letter: "B" }
    ],
    existingWords: [
      { id: "word-1", text: "cat" }
    ]
  },
  result: null
};

const completedResult: PracticeResult = {
  submittedWordRaw: "cab",
  submittedWordNormalized: "CAB",
  isValid: true,
  isBestPlay: false,
  timedOut: false,
  score: 3,
  bestScore: 4,
  allOptions: []
};

function renderPracticeView(options: {
  inputMethod: "typing" | "tile";
  phase?: PracticeModeState["phase"];
}) {
  const practiceState: PracticeModeState = {
    ...basePracticeState,
    phase: options.phase ?? "puzzle",
    result: options.phase === "result" ? completedResult : null
  };

  return renderToStaticMarkup(
    <UserSettingsContext.Provider
      value={buildUserSettingsContextValue({
        ...DEFAULT_USER_SETTINGS,
        inputMethod: options.inputMethod
      })}
    >
      <PracticeView
        practiceState={practiceState}
        practicePuzzle={practiceState.puzzle}
        practiceResult={practiceState.result}
        practiceShareStatus={null}
        practiceResultShareStatus={null}
        onSharePracticePuzzle={() => {}}
        onSharePracticeResult={() => {}}
        onOpenPracticeDifficultyPicker={() => {}}
        onPracticeNext={() => {}}
        onPracticeExit={() => {}}
        practiceTimerRemainingSeconds={null}
        isPracticeTimerWarning={false}
        practiceTimerProgress={0}
        practiceWord=""
        setPracticeWord={() => {}}
        practiceSubmitError={null}
        setPracticeSubmitError={() => {}}
        onPracticeSubmit={() => {}}
        onPracticeSkip={() => {}}
        practiceInputRef={{ current: null }}
        practiceResultCategory={null}
        visiblePracticeOptions={[]}
        hiddenPracticeOptionCount={0}
        showAllPracticeOptions={false}
        setShowAllPracticeOptions={() => {}}
      />
    </UserSettingsContext.Provider>
  );
}

test("PracticeView renders selectable tiles in puzzle phase when tile input is enabled", () => {
  const html = renderPracticeView({ inputMethod: "tile" });
  assert.match(html, /tile-selectable/);
  assert.match(html, /Use letter A for practice word/);
  assert.match(html, /Use letter C from existing word cat/i);
});

test("PracticeView renders non-selectable tiles in puzzle phase when tile input is disabled", () => {
  const html = renderPracticeView({ inputMethod: "typing" });
  assert.doesNotMatch(html, /tile-selectable/);
  assert.doesNotMatch(html, /Use letter [A-Z] for practice word/);
});

test("PracticeView does not render selectable tiles during result phase", () => {
  const html = renderPracticeView({ inputMethod: "tile", phase: "result" });
  assert.doesNotMatch(html, /tile-selectable/);
});
