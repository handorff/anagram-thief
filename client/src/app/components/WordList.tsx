import type { Player } from "@shared/types";
import { useUserSettings } from "../../userSettings";
import { getWordItemClassName } from "../game/gameUtils";
import type { WordHighlightKind } from "../types";

type Props = {
  player: Player;
  isSelf: boolean;
  highlightedWordIds: Record<string, WordHighlightKind>;
  onTileLetterSelect: (letter: string) => void;
};

export function WordList({
  player,
  isSelf,
  highlightedWordIds,
  onTileLetterSelect
}: Props) {
  const { isTileInputMethodEnabled } = useUserSettings();

  return (
    <div className={isSelf ? "word-list word-list-self" : "word-list"}>
      <div className="word-header">
        <span>{player.name}'s words</span>
        <span className="muted">{player.words.length}</span>
      </div>
      {player.words.length === 0 && <div className="muted">No words yet.</div>}
      {player.words.length > 0 && (
        <div className="word-list-words">
          {player.words.map((word) => (
            <div key={word.id} className={getWordItemClassName(highlightedWordIds[word.id])}>
              <div className="word-tiles" aria-label={word.text}>
                {word.text.split("").map((letter, index) => (
                  <div
                    key={`${word.id}-${index}`}
                    className={isTileInputMethodEnabled ? "tile word-tile tile-selectable" : "tile word-tile"}
                    role={isTileInputMethodEnabled ? "button" : undefined}
                    tabIndex={isTileInputMethodEnabled ? 0 : undefined}
                    onClick={
                      isTileInputMethodEnabled ? () => onTileLetterSelect(letter.toUpperCase()) : undefined
                    }
                    onKeyDown={
                      isTileInputMethodEnabled
                        ? (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              event.stopPropagation();
                              onTileLetterSelect(letter.toUpperCase());
                            }
                          }
                        : undefined
                    }
                    aria-label={
                      isTileInputMethodEnabled
                        ? `Use letter ${letter.toUpperCase()} from ${player.name}'s word`
                        : undefined
                    }
                  >
                    {letter.toUpperCase()}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
