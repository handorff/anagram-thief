import {
  useEffect,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction
} from "react";
import type {
  PracticeModeState,
  PracticeResult,
  PracticeScoredWord
} from "@shared/types";
import { useUserSettings } from "../../userSettings";
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
  onOpenPracticeDifficultyPicker: () => void;
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
  onOpenPracticeDifficultyPicker,
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
  const [isShareChoiceOpen, setIsShareChoiceOpen] = useState(false);
  const { isTileInputMethodEnabled } = useUserSettings();
  const isResultPhase = practiceState.phase === "result";
  const isTileSelectionEnabled = isTileInputMethodEnabled && practiceState.phase === "puzzle";

  const canShareResult = Boolean(
    isResultPhase &&
      practiceResult &&
      !practiceResult.timedOut &&
      practiceResult.submittedWordNormalized
  );

  const handlePracticeTileSelect = (letter: string) => {
    if (!isTileSelectionEnabled) return;
    const normalizedLetter = letter.trim().slice(0, 1).toUpperCase();
    if (!normalizedLetter) return;
    setPracticeWord((current) => `${current}${normalizedLetter}`);
    if (practiceSubmitError) {
      setPracticeSubmitError(null);
    }
    requestAnimationFrame(() => practiceInputRef.current?.focus());
  };

  useEffect(() => {
    if (!practicePuzzle) {
      setIsShareChoiceOpen(false);
    }
  }, [practicePuzzle]);

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
            {practicePuzzle && (
              <div className="practice-share-action">
                <button
                  className="icon-button practice-share-icon-button"
                  type="button"
                  onClick={() => {
                    if (isResultPhase) {
                      setIsShareChoiceOpen(true);
                      return;
                    }
                    onSharePracticePuzzle();
                  }}
                  aria-label={isResultPhase ? "Share options" : "Share puzzle"}
                  title={isResultPhase ? "Share options" : "Share puzzle"}
                >
                  <span aria-hidden="true">
                    {!isResultPhase && practiceShareStatus === "copied"
                      ? "✓"
                      : !isResultPhase && practiceShareStatus === "failed"
                        ? "!"
                        : "↗"}
                  </span>
                </button>
              </div>
            )}
            <button
              className="icon-button practice-exit-icon-button"
              type="button"
              onClick={onPracticeExit}
              aria-label="Exit practice"
              title="Exit practice"
            >
              <span aria-hidden="true">✕</span>
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
                  <div
                    key={tile.id}
                    className={isTileSelectionEnabled ? "tile tile-selectable" : "tile"}
                    role={isTileSelectionEnabled ? "button" : undefined}
                    tabIndex={isTileSelectionEnabled ? 0 : undefined}
                    onClick={
                      isTileSelectionEnabled ? () => handlePracticeTileSelect(tile.letter) : undefined
                    }
                    onKeyDown={
                      isTileSelectionEnabled
                        ? (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              event.stopPropagation();
                              handlePracticeTileSelect(tile.letter);
                            }
                          }
                        : undefined
                    }
                    aria-label={
                      isTileSelectionEnabled ? `Use letter ${tile.letter.toUpperCase()} for practice word` : undefined
                    }
                  >
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
                      {word.text.split("").map((letter, index) => {
                        const upperLetter = letter.toUpperCase();
                        return (
                          <div
                            key={`${word.id}-${index}`}
                            className={
                              isTileSelectionEnabled
                                ? "tile word-tile tile-selectable"
                                : "tile word-tile"
                            }
                            role={isTileSelectionEnabled ? "button" : undefined}
                            tabIndex={isTileSelectionEnabled ? 0 : undefined}
                            onClick={
                              isTileSelectionEnabled
                                ? () => handlePracticeTileSelect(upperLetter)
                                : undefined
                            }
                            onKeyDown={
                              isTileSelectionEnabled
                                ? (event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      handlePracticeTileSelect(upperLetter);
                                    }
                                  }
                                : undefined
                            }
                            aria-label={
                              isTileSelectionEnabled
                                ? `Use letter ${upperLetter} from existing word ${word.text}`
                                : undefined
                            }
                          >
                            {upperLetter}
                          </div>
                        );
                      })}
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
                    <button className="button-secondary" onClick={onOpenPracticeDifficultyPicker}>
                      Change Difficulty
                    </button>
                    <button className="button-secondary" onClick={onPracticeSkip}>
                      Skip Puzzle
                    </button>
                  </div>
                </>
              )}
            </div>

            {practiceState.phase === "result" && practiceResult && (
              <div className="practice-result-panel">
                <button className="practice-next-puzzle-button" onClick={onPracticeNext}>
                  Next Puzzle
                </button>
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
                  onSharePracticePuzzle();
                }}
              >
                {practiceShareStatus === "copied"
                  ? "Puzzle copied!"
                  : practiceShareStatus === "failed"
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
                  onSharePracticeResult();
                }}
              >
                {practiceResultShareStatus === "copied"
                  ? "Result copied!"
                  : practiceResultShareStatus === "failed"
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
