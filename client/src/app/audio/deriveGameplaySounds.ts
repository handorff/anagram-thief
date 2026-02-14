import type { GameState } from "@shared/types";
import {
  findReplacedWord,
  getWordSnapshots
} from "../game/gameUtils";
import type { GameplaySoundId } from "./soundTypes";

export type DeriveGameplaySoundsInput = {
  previousState: GameState;
  nextState: GameState;
  selfPlayerId: string | null;
  now: number;
};

export function deriveGameplaySounds({
  previousState,
  nextState,
  selfPlayerId,
  now
}: DeriveGameplaySoundsInput): GameplaySoundId[] {
  const sounds: GameplaySoundId[] = [];

  const previousCenterTileIds = new Set(previousState.centerTiles.map((tile) => tile.id));
  const addedTiles = nextState.centerTiles.filter((tile) => !previousCenterTileIds.has(tile.id));
  if (addedTiles.length > 0 && nextState.bagCount < previousState.bagCount) {
    sounds.push("flipReveal");
  }

  const previousWords = getWordSnapshots(previousState.players);
  const currentWords = getWordSnapshots(nextState.players);
  const previousWordMap = new Map(previousWords.map((word) => [word.id, word]));
  const removedWords = previousWords.filter(
    (word) => !currentWords.some((currentWord) => currentWord.id === word.id)
  );
  const addedWords = currentWords
    .filter((word) => !previousWordMap.has(word.id))
    .sort((a, b) => a.createdAt - b.createdAt);

  for (const addedWord of addedWords) {
    const replacedWord = findReplacedWord(addedWord, removedWords);
    if (replacedWord) {
      const removedWordIndex = removedWords.findIndex((word) => word.id === replacedWord.id);
      if (removedWordIndex !== -1) {
        removedWords.splice(removedWordIndex, 1);
      }
    }

    if (!replacedWord || replacedWord.ownerId === addedWord.ownerId) {
      sounds.push("claimSuccess");
      continue;
    }

    sounds.push("stealSuccess");
  }

  const previousClaimWindow = previousState.claimWindow;
  if (previousClaimWindow && !nextState.claimWindow) {
    const isClaimWindowExpired =
      previousClaimWindow.endsAt <= now &&
      previousClaimWindow.playerId in nextState.claimCooldowns;
    if (isClaimWindowExpired) {
      sounds.push("claimExpired");
    }
  }

  if (selfPlayerId) {
    const previousSelfCooldown = previousState.claimCooldowns[selfPlayerId];
    const nextSelfCooldown = nextState.claimCooldowns[selfPlayerId];
    if (typeof nextSelfCooldown === "number" && previousSelfCooldown !== nextSelfCooldown) {
      sounds.push("cooldownSelf");
    }
  }

  if (previousState.status !== "ended" && nextState.status === "ended") {
    sounds.push("gameEnd");
  }

  return sounds;
}
