import type { PracticeDifficulty } from "@shared/types";

type PracticeEditorModel = {
  difficulty: PracticeDifficulty;
  centerInput: string;
  existingWordsInput: string;
  puzzleDraft: {
    normalizedCenter: string;
    normalizedExistingWords: string[];
  };
  totalCharacters: number;
  validationMessage: string | null;
  lobbyError: string | null;
  isPuzzleReady: boolean;
  isShareValidationInFlight: boolean;
  shareStatus: "copied" | "failed" | null;
};

type PracticeEditorLimits = {
  customPuzzleCenterLetterMax: number;
  customPuzzleExistingWordCountMax: number;
  customPuzzleTotalCharactersMax: number;
};

type PracticeEditorActions = {
  onDifficultyChange: (difficulty: PracticeDifficulty) => void;
  onCenterInputChange: (value: string) => void;
  onExistingWordsInputChange: (value: string) => void;
  onBackToLobby: () => void;
  onPlayPuzzle: () => void;
  onSharePuzzle: () => void;
};

type Props = {
  model: PracticeEditorModel;
  limits: PracticeEditorLimits;
  actions: PracticeEditorActions;
};

export function PracticeEditorView({ model, limits, actions }: Props) {
  return (
    <div className="grid">
      <section className="panel panel-narrow practice-editor">
        <h2>Custom Practice Puzzle</h2>
        <p className="muted">
          Pick center tiles and existing words, then play this exact puzzle or share it as a link.
        </p>

        <div className="practice-editor-fields">
          <div className="practice-difficulty-control" aria-label="Custom puzzle difficulty">
            <span>Difficulty</span>
            <div className="practice-difficulty-segmented" role="group" aria-label="Custom puzzle difficulty">
              {[1, 2, 3, 4, 5].map((level) => (
                <button
                  key={level}
                  type="button"
                  className={
                    model.difficulty === level ? "practice-difficulty-option active" : "practice-difficulty-option"
                  }
                  onClick={() => actions.onDifficultyChange(level as PracticeDifficulty)}
                  aria-pressed={model.difficulty === level}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          <label>
            Center tiles (A-Z)
            <input
              value={model.centerInput}
              onChange={(event) => actions.onCenterInputChange(event.target.value)}
              placeholder="TEAM"
            />
          </label>

          <label>
            Existing words (one per line)
            <textarea
              value={model.existingWordsInput}
              onChange={(event) => actions.onExistingWordsInputChange(event.target.value)}
              placeholder={"RATE\nALERT"}
              rows={6}
            />
          </label>

          <p className="muted practice-editor-stats">
            Center: {model.puzzleDraft.normalizedCenter.length}/{limits.customPuzzleCenterLetterMax} letters ·
            Existing words: {model.puzzleDraft.normalizedExistingWords.length}/
            {limits.customPuzzleExistingWordCountMax} · Total chars: {model.totalCharacters}/
            {limits.customPuzzleTotalCharactersMax}
          </p>

          {(model.validationMessage || model.lobbyError) && (
            <div className="practice-editor-error" role="alert">
              {model.validationMessage ?? model.lobbyError}
            </div>
          )}
        </div>

        <div className="button-row">
          <button className="button-secondary" onClick={actions.onBackToLobby}>
            Back to lobby
          </button>
          <button onClick={actions.onPlayPuzzle} disabled={!model.isPuzzleReady}>
            Play puzzle
          </button>
          <button
            className="button-secondary"
            onClick={actions.onSharePuzzle}
            disabled={!model.isPuzzleReady || model.isShareValidationInFlight}
          >
            {model.isShareValidationInFlight
              ? "Validating..."
              : model.shareStatus === "copied"
                ? "Copied!"
                : model.shareStatus === "failed"
                  ? "Copy failed"
                  : "Share link"}
          </button>
        </div>
      </section>
    </div>
  );
}
