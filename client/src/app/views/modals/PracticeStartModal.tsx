import type { PracticeDifficulty } from "@shared/types";

type PracticeStartModalModel = {
  title?: string;
  confirmLabel?: string;
  showTimerSettings?: boolean;
  difficulty: PracticeDifficulty | null;
  timerEnabled: boolean;
  timerSeconds: number;
};

type PracticeStartModalLimits = {
  minPracticeTimerSeconds: number;
  maxPracticeTimerSeconds: number;
  clampPracticeTimerSeconds: (value: number) => number;
};

type PracticeStartModalActions = {
  onDifficultyChange: (difficulty: PracticeDifficulty) => void;
  onTimerEnabledChange: (enabled: boolean) => void;
  onTimerSecondsChange: (seconds: number | ((current: number) => number)) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

type Props = {
  model: PracticeStartModalModel;
  limits: PracticeStartModalLimits;
  actions: PracticeStartModalActions;
};

export function PracticeStartModal({ model, limits, actions }: Props) {
  const title = model.title ?? "Start Practice Mode";
  const confirmLabel = model.confirmLabel ?? "Start practice";
  const showTimerSettings = model.showTimerSettings ?? true;

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
                    model.difficulty === level
                      ? "practice-difficulty-option active"
                      : "practice-difficulty-option"
                  }
                  onClick={() => actions.onDifficultyChange(level as PracticeDifficulty)}
                  aria-pressed={model.difficulty === level}
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
                checked={model.timerEnabled}
                onChange={(event) => actions.onTimerEnabledChange(event.target.checked)}
              />
              <span>Enable puzzle timer</span>
            </label>
            {model.timerEnabled ? (
              <label className="practice-start-timer-seconds">
                <span>
                  Timer seconds ({limits.minPracticeTimerSeconds}-{limits.maxPracticeTimerSeconds})
                </span>
                <div className="practice-start-timer-input-row">
                  <input
                    type="range"
                    min={limits.minPracticeTimerSeconds}
                    max={limits.maxPracticeTimerSeconds}
                    step={1}
                    value={model.timerSeconds}
                    onChange={(event) =>
                      actions.onTimerSecondsChange(limits.clampPracticeTimerSeconds(Number(event.target.value)))
                    }
                  />
                  <input
                    type="number"
                    min={limits.minPracticeTimerSeconds}
                    max={limits.maxPracticeTimerSeconds}
                    value={model.timerSeconds}
                    onChange={(event) =>
                      actions.onTimerSecondsChange(limits.clampPracticeTimerSeconds(Number(event.target.value)))
                    }
                    onBlur={() =>
                      actions.onTimerSecondsChange((current) => limits.clampPracticeTimerSeconds(current))
                    }
                  />
                </div>
              </label>
            ) : null}
          </>
        ) : null}
        <div className="button-row">
          <button className="button-secondary" onClick={actions.onCancel}>
            Cancel
          </button>
          <button onClick={actions.onConfirm} disabled={model.difficulty === null}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
