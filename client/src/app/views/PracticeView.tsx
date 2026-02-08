import type {
  Dispatch,
  RefObject,
  SetStateAction
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

type Props = {
  practiceState: PracticeModeState;
  practicePuzzle: PracticeModeState["puzzle"];
  practiceResult: PracticeResult | null;
  practiceShareStatus: "copied" | "failed" | null;
  practiceResultShareStatus: "copied" | "failed" | null;
  onSharePracticePuzzle: () => void;
  onSharePracticeResult: () => void;
  onPracticeDifficultyChange: (value: number) => void;
  onPracticeNext: () => void;
  onPracticeExit: () => void;
  practiceTimerRemainingSeconds: number | null;
  isPracticeTimerWarning: boolean;
  practiceTimerProgress: number;
  practiceWord: string;
  setPracticeWord: Dispatch<SetStateAction<string>>;
  practiceSubmitError: string | null;
  setPracticeSubmitError: Dispatch<SetStateAction<string | null>>;
  onPracticeSubmit: () => void;
  onPracticeSkip: () => void;
  practiceInputRef: RefObject<HTMLInputElement>;
  practiceResultCategory: PracticeResultCategory | null;
  visiblePracticeOptions: PracticeScoredWord[];
  hiddenPracticeOptionCount: number;
  showAllPracticeOptions: boolean;
  setShowAllPracticeOptions: Dispatch<SetStateAction<boolean>>;
};

export function PracticeView({
  practiceState,
  practicePuzzle,
  practiceResult,
  practiceShareStatus,
  practiceResultShareStatus,
  onSharePracticePuzzle,
  onSharePracticeResult,
  onPracticeDifficultyChange,
  onPracticeNext,
  onPracticeExit,
  practiceTimerRemainingSeconds,
  isPracticeTimerWarning,
  practiceTimerProgress,
  practiceWord,
  setPracticeWord,
  practiceSubmitError,
  setPracticeSubmitError,
  onPracticeSubmit,
  onPracticeSkip,
  practiceInputRef,
  practiceResultCategory,
  visiblePracticeOptions,
  hiddenPracticeOptionCount,
  showAllPracticeOptions,
  setShowAllPracticeOptions
}: Props) {
  return (
    <div className="practice">
      <section className="panel practice-board">
        <div className="practice-header">
          <div>
            <h2>Practice Mode</h2>
            <p className="muted">Current puzzle difficulty: {practiceState.currentDifficulty}</p>
          </div>
          <div className="practice-header-actions">
            {practicePuzzle && (
              <div className="practice-share-action">
                <button className="button-secondary" type="button" onClick={onSharePracticePuzzle}>
                  {practiceShareStatus === "copied"
                    ? "Copied!"
                    : practiceShareStatus === "failed"
                      ? "Copy failed"
                      : "Share"}
                </button>
              </div>
            )}
            {practicePuzzle &&
              practiceState.phase === "result" &&
              practiceResult &&
              !practiceResult.timedOut &&
              practiceResult.submittedWordNormalized && (
              <div className="practice-share-action">
                <button className="button-secondary" type="button" onClick={onSharePracticeResult}>
                  {practiceResultShareStatus === "copied"
                    ? "Copied!"
                    : practiceResultShareStatus === "failed"
                      ? "Copy failed"
                      : "Share result"}
                </button>
              </div>
            )}
            {practiceState.phase === "result" && practiceResult && (
              <>
                <div className="practice-difficulty-control" aria-label="Next puzzle difficulty">
                  <div className="practice-difficulty-segmented" role="group">
                    {[1, 2, 3, 4, 5].map((level) => (
                      <button
                        key={level}
                        type="button"
                        className={
                          practiceState.queuedDifficulty === level
                            ? "practice-difficulty-option active"
                            : "practice-difficulty-option"
                        }
                        onClick={() => onPracticeDifficultyChange(level)}
                        aria-pressed={practiceState.queuedDifficulty === level}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                </div>
                <button onClick={onPracticeNext}>Next Puzzle</button>
              </>
            )}
            <button className="button-secondary" onClick={onPracticeExit}>
              Exit Practice
            </button>
          </div>
        </div>

        {practicePuzzle ? (
          <div
            className={
              practiceState.phase === "result" && practiceResult
                ? "practice-content result-layout"
                : "practice-content"
            }
          >
            <div className="practice-puzzle-panel">
              <div>
                <h3>Center Tiles</h3>
              </div>
              <div className="tiles">
                {practicePuzzle.centerTiles.map((tile) => (
                  <div key={tile.id} className="tile">
                    {tile.letter}
                  </div>
                ))}
              </div>

              <div className="word-list practice-existing-words">
                <div className="word-header">
                  <span>Existing words</span>
                  <span className="muted">{practicePuzzle.existingWords.length}</span>
                </div>
                {practicePuzzle.existingWords.length === 0 && (
                  <div className="muted">No existing words in this puzzle.</div>
                )}
                {practicePuzzle.existingWords.map((word) => (
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

              {practiceState.phase === "puzzle" && (
                <>
                  {practiceTimerRemainingSeconds !== null && (
                    <div
                      className={`practice-puzzle-timer ${isPracticeTimerWarning ? "warning" : ""}`}
                      role="progressbar"
                      aria-label="Practice puzzle timer"
                      aria-valuemin={0}
                      aria-valuemax={practiceState.timerSeconds}
                      aria-valuenow={practiceTimerRemainingSeconds}
                    >
                      <div className="practice-puzzle-timer-header">
                        <span>Time remaining</span>
                        <strong>{practiceTimerRemainingSeconds}s</strong>
                      </div>
                      <div className="practice-puzzle-timer-track">
                        <div
                          className="practice-puzzle-timer-progress"
                          style={{ width: `${practiceTimerProgress * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <div className="claim-box">
                    <div className="claim-input">
                      <input
                        ref={practiceInputRef}
                        value={practiceWord}
                        onChange={(event) => {
                          setPracticeWord(event.target.value);
                          if (practiceSubmitError) {
                            setPracticeSubmitError(null);
                          }
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                            event.preventDefault();
                            onPracticeSubmit();
                          }
                        }}
                        placeholder="Enter your best play"
                      />
                      <button onClick={onPracticeSubmit} disabled={!practiceWord.trim()}>
                        Submit
                      </button>
                    </div>
                    {practiceSubmitError && (
                      <div className="practice-submit-error" role="alert">
                        {practiceSubmitError}
                      </div>
                    )}
                  </div>
                  <div className="button-row">
                    <button className="button-secondary" onClick={onPracticeSkip}>
                      Skip Puzzle
                    </button>
                    <button className="button-secondary" onClick={onPracticeExit}>
                      Exit Practice
                    </button>
                  </div>
                </>
              )}
            </div>

            {practiceState.phase === "result" && practiceResult && (
              <div className="practice-result-panel">
                <div className="practice-result">
                  <div className="practice-result-summary">
                    <div className="practice-result-summary-header">
                      <h3>Result</h3>
                      {practiceResultCategory && (
                        <span
                          className={`practice-result-badge practice-result-badge-${practiceResultCategory.key}`}
                        >
                          {practiceResultCategory.label}
                        </span>
                      )}
                    </div>
                    <p>
                      <strong>
                        {practiceResult.timedOut
                          ? "Time's up"
                          : practiceResult.submittedWordNormalized || "(empty)"}
                      </strong>{" "}
                      ({practiceResult.score}/{practiceResult.bestScore})
                    </p>
                  </div>

                  <div className="practice-options">
                    {visiblePracticeOptions.map((option) => (
                      <div
                        key={`${option.word}-${option.source}-${option.stolenFrom ?? "center"}`}
                        className={getPracticeOptionClassName(option, practiceResult.submittedWordNormalized)}
                      >
                        <div>
                          <strong>{formatPracticeOptionLabel(option)}</strong>
                        </div>
                        <span className="score">{option.score}</span>
                      </div>
                    ))}
                    {hiddenPracticeOptionCount > 0 && !showAllPracticeOptions && (
                      <button
                        type="button"
                        className="practice-option-more"
                        onClick={() => setShowAllPracticeOptions(true)}
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
    </div>
  );
}
