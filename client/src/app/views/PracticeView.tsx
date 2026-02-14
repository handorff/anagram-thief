import {
  useEffect,
  useState,
  type RefObject
} from "react";
import type {
  PracticeModeState,
  PracticeResult,
  PracticeScoredWord
} from "@shared/types";
import {
  formatPracticeOptionLabel,
  getPracticeOptionClassName
} from "../practice/practiceUtils";

type PracticeResultCategory = {
  key: "perfect" | "amazing" | "great" | "good" | "ok" | "better-luck-next-time";
  label: string;
};

type PracticeViewModel = {
  practiceState: PracticeModeState;
  practicePuzzle: PracticeModeState["puzzle"];
  practiceResult: PracticeResult | null;
  practiceShareStatus: "copied" | "failed" | null;
  practiceResultShareStatus: "copied" | "failed" | null;
  practiceTimerRemainingSeconds: number | null;
  isPracticeTimerWarning: boolean;
  practiceTimerProgress: number;
  practiceWord: string;
  practiceSubmitError: string | null;
  practiceResultCategory: PracticeResultCategory | null;
  visiblePracticeOptions: PracticeScoredWord[];
  hiddenPracticeOptionCount: number;
  showAllPracticeOptions: boolean;
};

type PracticeViewActions = {
  onSharePracticePuzzle: () => void;
  onSharePracticeResult: () => void;
  onOpenPracticeDifficultyPicker: () => void;
  onPracticeNext: () => void;
  onPracticeExit: () => void;
  onPracticeWordChange: (value: string) => void;
  onPracticeSubmitErrorChange: (value: string | null) => void;
  onPracticeSubmit: () => void;
  onPracticeSkip: () => void;
  onShowAllPracticeOptionsChange: (value: boolean) => void;
};

type PracticeViewRefs = {
  practiceInputRef: RefObject<HTMLInputElement>;
};

type Props = {
  model: PracticeViewModel;
  actions: PracticeViewActions;
  refs: PracticeViewRefs;
};

export function PracticeView({ model, actions, refs }: Props) {
  const [isShareChoiceOpen, setIsShareChoiceOpen] = useState(false);
  const isResultPhase = model.practiceState.phase === "result";

  const canShareResult = Boolean(
    isResultPhase &&
      model.practiceResult &&
      !model.practiceResult.timedOut &&
      model.practiceResult.submittedWordNormalized
  );

  useEffect(() => {
    if (!model.practicePuzzle) {
      setIsShareChoiceOpen(false);
    }
  }, [model.practicePuzzle]);

  useEffect(() => {
    if (!isResultPhase) {
      setIsShareChoiceOpen(false);
    }
  }, [isResultPhase]);

  return (
    <div className="practice">
      <section className="panel practice-board">
        <div className="practice-header">
          <div className="practice-header-summary">
            <h2>Practice Mode</h2>
          </div>
          <div className="practice-header-actions">
            {model.practicePuzzle && (
              <div className="practice-share-action">
                <button
                  className="icon-button practice-share-icon-button"
                  type="button"
                  onClick={() => {
                    if (isResultPhase) {
                      setIsShareChoiceOpen(true);
                      return;
                    }
                    actions.onSharePracticePuzzle();
                  }}
                  aria-label={isResultPhase ? "Share options" : "Share puzzle"}
                  title={isResultPhase ? "Share options" : "Share puzzle"}
                >
                  <span aria-hidden="true">
                    {!isResultPhase && model.practiceShareStatus === "copied"
                      ? "✓"
                      : !isResultPhase && model.practiceShareStatus === "failed"
                        ? "!"
                        : "↗"}
                  </span>
                </button>
              </div>
            )}
            <button
              className="icon-button practice-exit-icon-button"
              type="button"
              onClick={actions.onPracticeExit}
              aria-label="Exit practice"
              title="Exit practice"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        </div>

        {model.practicePuzzle ? (
          <div
            className={
              model.practiceState.phase === "result" && model.practiceResult
                ? "practice-content result-layout"
                : "practice-content"
            }
          >
            <div className="practice-puzzle-panel">
              <div>
                <h3>Center Tiles</h3>
              </div>
              <div className="tiles">
                {model.practicePuzzle.centerTiles.map((tile) => (
                  <div key={tile.id} className="tile">
                    {tile.letter}
                  </div>
                ))}
              </div>

              <div className="word-list practice-existing-words">
                <div className="word-header">
                  <span>Existing words</span>
                  <span className="muted">{model.practicePuzzle.existingWords.length}</span>
                </div>
                {model.practicePuzzle.existingWords.length === 0 && (
                  <div className="muted">No existing words in this puzzle.</div>
                )}
                {model.practicePuzzle.existingWords.map((word) => (
                  <div key={word.id} className="word-item">
                    <div className="word-tiles" aria-label={word.text}>
                      {word.text.split("").map((letter, index) => (
                        <div key={`${word.id}-${index}`} className="tile word-tile">
                          {letter.toUpperCase()}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {model.practiceState.phase === "puzzle" && (
                <>
                  {model.practiceTimerRemainingSeconds !== null && (
                    <div
                      className={`practice-puzzle-timer ${model.isPracticeTimerWarning ? "warning" : ""}`}
                      role="progressbar"
                      aria-label="Practice puzzle timer"
                      aria-valuemin={0}
                      aria-valuemax={model.practiceState.timerSeconds}
                      aria-valuenow={model.practiceTimerRemainingSeconds}
                    >
                      <div className="practice-puzzle-timer-header">
                        <span>Time remaining</span>
                        <strong>{model.practiceTimerRemainingSeconds}s</strong>
                      </div>
                      <div className="practice-puzzle-timer-track">
                        <div
                          className="practice-puzzle-timer-progress"
                          style={{ width: `${model.practiceTimerProgress * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <div className="claim-box">
                    <div className="claim-input">
                      <input
                        ref={refs.practiceInputRef}
                        value={model.practiceWord}
                        onChange={(event) => {
                          actions.onPracticeWordChange(event.target.value);
                          if (model.practiceSubmitError) {
                            actions.onPracticeSubmitErrorChange(null);
                          }
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                            event.preventDefault();
                            actions.onPracticeSubmit();
                          }
                        }}
                        placeholder="Enter your best play"
                      />
                      <button onClick={actions.onPracticeSubmit} disabled={!model.practiceWord.trim()}>
                        Submit
                      </button>
                    </div>
                    {model.practiceSubmitError && (
                      <div className="practice-submit-error" role="alert">
                        {model.practiceSubmitError}
                      </div>
                    )}
                  </div>
                  <div className="button-row">
                    <button className="button-secondary" onClick={actions.onOpenPracticeDifficultyPicker}>
                      Change Difficulty
                    </button>
                    <button className="button-secondary" onClick={actions.onPracticeSkip}>
                      Skip Puzzle
                    </button>
                  </div>
                </>
              )}
            </div>

            {model.practiceState.phase === "result" && model.practiceResult && (
              <div className="practice-result-panel">
                <button className="practice-next-puzzle-button" onClick={actions.onPracticeNext}>
                  Next Puzzle
                </button>
                <div className="practice-result">
                  <div className="practice-result-summary">
                    <div className="practice-result-summary-header">
                      <h3>Result</h3>
                      {model.practiceResultCategory && (
                        <span
                          className={`practice-result-badge practice-result-badge-${model.practiceResultCategory.key}`}
                        >
                          {model.practiceResultCategory.label}
                        </span>
                      )}
                    </div>
                    <p>
                      <strong>
                        {model.practiceResult.timedOut
                          ? "Time's up"
                          : model.practiceResult.submittedWordNormalized || "(empty)"}
                      </strong>{" "}
                      ({model.practiceResult.score}/{model.practiceResult.bestScore})
                    </p>
                  </div>

                  <div className="practice-options">
                    {model.visiblePracticeOptions.map((option) => (
                      <div
                        key={`${option.word}-${option.source}-${option.stolenFrom ?? "center"}`}
                        className={getPracticeOptionClassName(
                          option,
                          model.practiceResult?.submittedWordNormalized
                        )}
                      >
                        <div>
                          <strong>{formatPracticeOptionLabel(option)}</strong>
                        </div>
                        <span className="score">{option.score}</span>
                      </div>
                    ))}
                    {model.hiddenPracticeOptionCount > 0 && !model.showAllPracticeOptions && (
                      <button
                        type="button"
                        className="practice-option-more"
                        onClick={() => actions.onShowAllPracticeOptionsChange(true)}
                      >
                        more
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="muted">Loading puzzle...</div>
        )}
      </section>
      {isShareChoiceOpen && (
        <div className="join-overlay practice-share-choice-overlay">
          <div className="panel join-modal practice-share-choice-modal">
            <div className="practice-share-choice-header">
              <h3>Share</h3>
              <button
                type="button"
                className="icon-button practice-share-choice-close"
                onClick={() => setIsShareChoiceOpen(false)}
                aria-label="Close share options"
                title="Close"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
            <p className="muted">What do you want to share?</p>
            <div className="practice-share-choice-actions">
              <button
                type="button"
                onClick={() => {
                  setIsShareChoiceOpen(false);
                  actions.onSharePracticePuzzle();
                }}
              >
                {model.practiceShareStatus === "copied"
                  ? "Puzzle copied!"
                  : model.practiceShareStatus === "failed"
                    ? "Puzzle copy failed"
                    : "Share puzzle"}
              </button>
              <button
                type="button"
                className="button-secondary"
                disabled={!canShareResult}
                onClick={() => {
                  if (!canShareResult) return;
                  setIsShareChoiceOpen(false);
                  actions.onSharePracticeResult();
                }}
              >
                {model.practiceResultShareStatus === "copied"
                  ? "Result copied!"
                  : model.practiceResultShareStatus === "failed"
                    ? "Result copy failed"
                    : "Share result"}
              </button>
            </div>
            {!canShareResult && (
              <p className="muted">Result sharing is available after a valid submission.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
