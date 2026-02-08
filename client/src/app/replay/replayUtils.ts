import type {
  GameState,
  ReplayStateSnapshot
} from "@shared/types";
import {
  appendPreStealLogContext,
  findReplacedWord,
  getPlayerName,
  getWordSnapshots
} from "../game/gameUtils";
import type { WordSnapshot } from "../types";

export function getReplayClaimWordDiff(
  replaySteps: NonNullable<GameState["replay"]>["steps"],
  stepIndex: number
): {
  currentState: ReplayStateSnapshot;
  addedWords: WordSnapshot[];
  removedWords: WordSnapshot[];
} | null {
  const step = replaySteps[stepIndex];
  if (!step || step.kind !== "claim-succeeded") return null;
  if (stepIndex <= 0) return null;

  const currentState = step.state;
  const previousState = replaySteps[stepIndex - 1]?.state ?? null;
  if (!previousState) return null;

  const previousWords = getWordSnapshots(previousState.players);
  const currentWords = getWordSnapshots(currentState.players);
  const previousWordMap = new Map(previousWords.map((word) => [word.id, word]));
  const removedWords = previousWords.filter(
    (word) => !currentWords.some((currentWord) => currentWord.id === word.id)
  );
  const addedWords = currentWords
    .filter((word) => !previousWordMap.has(word.id))
    .sort((a, b) => a.createdAt - b.createdAt);

  return {
    currentState,
    addedWords,
    removedWords
  };
}

export function buildReplayActionText(
  replaySteps: NonNullable<GameState["replay"]>["steps"],
  stepIndex: number
): string {
  const step = replaySteps[stepIndex];
  if (!step) return "No replay action.";

  const currentState = step.state;
  const previousState = stepIndex > 0 ? replaySteps[stepIndex - 1]?.state ?? null : null;

  if (step.kind === "flip-revealed") {
    const previousCenterTileIds = new Set(previousState?.centerTiles.map((tile) => tile.id) ?? []);
    const addedTiles = currentState.centerTiles.filter((tile) => !previousCenterTileIds.has(tile.id));
    const flipperId = previousState?.pendingFlip?.playerId ?? previousState?.turnPlayerId ?? null;
    const flipperName = getPlayerName(previousState?.players ?? currentState.players, flipperId);
    if (addedTiles.length === 0) {
      return `${flipperName} flipped a tile.`;
    }
    return addedTiles.map((tile) => `${flipperName} flipped ${tile.letter}.`).join(" ");
  }

  if (step.kind === "claim-succeeded") {
    const claimWordDiff = getReplayClaimWordDiff(replaySteps, stepIndex);
    if (!claimWordDiff) {
      return "A word was claimed.";
    }

    const { currentState: claimCurrentState, addedWords, removedWords: claimRemovedWords } = claimWordDiff;
    const removedWords = [...claimRemovedWords];

    const lines: string[] = [];
    for (const addedWord of addedWords) {
      const claimantName = getPlayerName(claimCurrentState.players, addedWord.ownerId);
      const replacedWord = findReplacedWord(addedWord, removedWords);
      if (!replacedWord) {
        lines.push(
          appendPreStealLogContext(
            `${claimantName} claimed ${addedWord.text}.`,
            claimCurrentState,
            addedWord.id
          )
        );
        continue;
      }

      const removedWordIndex = removedWords.findIndex((word) => word.id === replacedWord.id);
      if (removedWordIndex !== -1) {
        removedWords.splice(removedWordIndex, 1);
      }

      if (replacedWord.ownerId === addedWord.ownerId) {
        lines.push(
          appendPreStealLogContext(
            `${claimantName} extended ${replacedWord.text} to ${addedWord.text}.`,
            claimCurrentState,
            addedWord.id
          )
        );
      } else {
        const stolenFromName = getPlayerName(claimCurrentState.players, replacedWord.ownerId);
        lines.push(
          appendPreStealLogContext(
            `${claimantName} stole ${replacedWord.text} from ${stolenFromName} with ${addedWord.text}.`,
            claimCurrentState,
            addedWord.id
          )
        );
      }
    }

    if (lines.length > 0) {
      return lines.join(" ");
    }
    return "A word was claimed.";
  }

  return "Replay action.";
}
