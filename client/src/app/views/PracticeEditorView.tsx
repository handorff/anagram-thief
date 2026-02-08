import type {
  Dispatch,
  SetStateAction
} from "react";
import type { PracticeDifficulty } from "@shared/types";

type Props = {
  editorDifficulty: PracticeDifficulty;
  setEditorDifficulty: Dispatch<SetStateAction<PracticeDifficulty>>;
  editorCenterInput: string;
  setEditorCenterInput: Dispatch<SetStateAction<string>>;
  editorExistingWordsInput: string;
  setEditorExistingWordsInput: Dispatch<SetStateAction<string>>;
  editorPuzzleDraft: {
    normalizedCenter: string;
    normalizedExistingWords: string[];
  };
  editorTotalCharacters: number;
  customPuzzleCenterLetterMax: number;
  customPuzzleExistingWordCountMax: number;
  customPuzzleTotalCharactersMax: number;
  editorValidationMessage: string | null;
  lobbyError: string | null;
  isEditorPuzzleReady: boolean;
  isEditorShareValidationInFlight: boolean;
  editorShareStatus: "copied" | "failed" | null;
  onBackToLobby: () => void;
  onPlayPuzzle: () => void;
  onSharePuzzle: () => void;
};

export function PracticeEditorView({
  editorDifficulty,
  setEditorDifficulty,
  editorCenterInput,
  setEditorCenterInput,
  editorExistingWordsInput,
  setEditorExistingWordsInput,
  editorPuzzleDraft,
  editorTotalCharacters,
  customPuzzleCenterLetterMax,
  customPuzzleExistingWordCountMax,
  customPuzzleTotalCharactersMax,
  editorValidationMessage,
  lobbyError,
  isEditorPuzzleReady,
  isEditorShareValidationInFlight,
  editorShareStatus,
  onBackToLobby,
  onPlayPuzzle,
  onSharePuzzle
}: Props) {
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
                    editorDifficulty === level ? "practice-difficulty-option active" : "practice-difficulty-option"
                  }
                  onClick={() => setEditorDifficulty(level as PracticeDifficulty)}
                  aria-pressed={editorDifficulty === level}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          <label>
            Center tiles (A-Z)
            <input
              value={editorCenterInput}
              onChange={(event) => setEditorCenterInput(event.target.value)}
              placeholder="TEAM"
            />
          </label>

          <label>
            Existing words (one per line)
            <textarea
              value={editorExistingWordsInput}
              onChange={(event) => setEditorExistingWordsInput(event.target.value)}
              placeholder={"RATE\nALERT"}
              rows={6}
            />
          </label>

          <p className="muted practice-editor-stats">
            Center: {editorPuzzleDraft.normalizedCenter.length}/{customPuzzleCenterLetterMax} letters ·
            Existing words: {editorPuzzleDraft.normalizedExistingWords.length}/
            {customPuzzleExistingWordCountMax} · Total chars: {editorTotalCharacters}/
            {customPuzzleTotalCharactersMax}
          </p>

          {(editorValidationMessage || lobbyError) && (
            <div className="practice-editor-error" role="alert">
              {editorValidationMessage ?? lobbyError}
            </div>
          )}
        </div>

        <div className="button-row">
          <button className="button-secondary" onClick={onBackToLobby}>
            Back to lobby
          </button>
          <button onClick={onPlayPuzzle} disabled={!isEditorPuzzleReady}>
            Play puzzle
          </button>
          <button
            className="button-secondary"
            onClick={onSharePuzzle}
            disabled={!isEditorPuzzleReady || isEditorShareValidationInFlight}
          >
            {isEditorShareValidationInFlight
              ? "Validating..."
              : editorShareStatus === "copied"
                ? "Copied!"
                : editorShareStatus === "failed"
                  ? "Copy failed"
                  : "Share link"}
          </button>
        </div>
      </section>
    </div>
  );
}
