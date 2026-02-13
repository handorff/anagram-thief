import type {
  Dispatch,
  SetStateAction
} from "react";
import type { PracticeDifficulty } from "@shared/types";

type Props = {
  title?: string;
  confirmLabel?: string;
  showTimerSettings?: boolean;
  practiceStartDifficulty: PracticeDifficulty | null;
  setPracticeStartDifficulty: Dispatch<SetStateAction<PracticeDifficulty | null>>;
  practiceStartTimerEnabled: boolean;
  setPracticeStartTimerEnabled: Dispatch<SetStateAction<boolean>>;
  practiceStartTimerSeconds: number;
  setPracticeStartTimerSeconds: Dispatch<SetStateAction<number>>;
  minPracticeTimerSeconds: number;
  maxPracticeTimerSeconds: number;
  clampPracticeTimerSeconds: (value: number) => number;
  onCancel: () => void;
  onConfirm: () => void;
};

export function PracticeStartModal({
  title = "Start Practice Mode",
  confirmLabel = "Start practice",
  showTimerSettings = true,
  practiceStartDifficulty,
  setPracticeStartDifficulty,
  practiceStartTimerEnabled,
  setPracticeStartTimerEnabled,
  practiceStartTimerSeconds,
  setPracticeStartTimerSeconds,
  minPracticeTimerSeconds,
  maxPracticeTimerSeconds,
  clampPracticeTimerSeconds,
  onCancel,
  onConfirm
}: Props) {
  return (
    <div className="join-overlay practice-start-overlay">
      <div className="panel join-modal practice-start-modal">
        <h2>{title}</h2>
        <div className="practice-start-difficulty-group">
          <p className="practice-start-difficulty-label">Difficulty</p>
          <div className="practice-start-difficulty-picker" role="group" aria-label="Practice difficulty">
            <div className="practice-difficulty-segmented">
              {[1, 2, 3, 4, 5].map((level) => (
                <button
                  key={level}
                  type="button"
                  className={
                    practiceStartDifficulty === level
                      ? "practice-difficulty-option active"
                      : "practice-difficulty-option"
                  }
                  onClick={() => setPracticeStartDifficulty(level as PracticeDifficulty)}
                  aria-pressed={practiceStartDifficulty === level}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
        </div>
        {showTimerSettings ? (
          <>
            <label className="practice-start-timer-toggle">
              <input
                type="checkbox"
                checked={practiceStartTimerEnabled}
                onChange={(event) => setPracticeStartTimerEnabled(event.target.checked)}
              />
              <span>Enable puzzle timer</span>
            </label>
            {practiceStartTimerEnabled ? (
              <label className="practice-start-timer-seconds">
                <span>
                  Timer seconds ({minPracticeTimerSeconds}-{maxPracticeTimerSeconds})
                </span>
                <div className="practice-start-timer-input-row">
                  <input
                    type="range"
                    min={minPracticeTimerSeconds}
                    max={maxPracticeTimerSeconds}
                    step={1}
                    value={practiceStartTimerSeconds}
                    onChange={(event) =>
                      setPracticeStartTimerSeconds(clampPracticeTimerSeconds(Number(event.target.value)))
                    }
                  />
                  <input
                    type="number"
                    min={minPracticeTimerSeconds}
                    max={maxPracticeTimerSeconds}
                    value={practiceStartTimerSeconds}
                    onChange={(event) =>
                      setPracticeStartTimerSeconds(clampPracticeTimerSeconds(Number(event.target.value)))
                    }
                    onBlur={() =>
                      setPracticeStartTimerSeconds((current) => clampPracticeTimerSeconds(current))
                    }
                  />
                </div>
              </label>
            ) : null}
          </>
        ) : null}
        <div className="button-row">
          <button className="button-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={practiceStartDifficulty === null}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
