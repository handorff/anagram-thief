import type { GameState } from "@shared/types";
import type {
  WordHighlightKind,
  WordSnapshot
} from "../types";

export function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function formatLogTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

export function getPlayerName<TPlayer extends { id: string; name: string }>(
  players: TPlayer[],
  playerId: string | null | undefined
) {
  if (!playerId) return "Unknown";
  return players.find((player) => player.id === playerId)?.name ?? "Unknown";
}

export function getWordSnapshots(
  players: Array<{ id: string; words: { id: string; text: string; tileIds: string[]; createdAt: number }[] }>
): WordSnapshot[] {
  const snapshots: WordSnapshot[] = [];
  for (const player of players) {
    for (const word of player.words) {
      snapshots.push({
        id: word.id,
        text: word.text,
        tileIds: word.tileIds,
        ownerId: player.id,
        createdAt: word.createdAt
      });
    }
  }
  return snapshots;
}

export function findReplacedWord(addedWord: WordSnapshot, removedWords: WordSnapshot[]) {
  const matches = removedWords.filter((word) =>
    word.tileIds.every((tileId) => addedWord.tileIds.includes(tileId))
  );
  if (matches.length === 0) return null;

  matches.sort((a, b) => {
    if (a.tileIds.length !== b.tileIds.length) {
      return b.tileIds.length - a.tileIds.length;
    }
    return a.createdAt - b.createdAt;
  });

  return matches[0];
}

export function appendPreStealLogContext(
  text: string,
  state: Pick<GameState, "lastClaimEvent">,
  wordId: string
): string {
  const claimEvent = state.lastClaimEvent;
  if (!claimEvent || claimEvent.wordId !== wordId || claimEvent.source !== "pre-steal") {
    return text;
  }

  const textWithoutPeriod = text.endsWith(".") ? text.slice(0, -1) : text;
  if (claimEvent.movedToBottomOfPreStealPrecedence) {
    return `${textWithoutPeriod} via pre-steal. Moved to bottom of pre-steal precedence.`;
  }
  return `${textWithoutPeriod} via pre-steal.`;
}

export function reorderEntriesById<T extends { id: string }>(items: T[], draggedId: string, targetId: string): T[] {
  if (draggedId === targetId) return items;
  const sourceIndex = items.findIndex((item) => item.id === draggedId);
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (sourceIndex === -1 || targetIndex === -1) return items;

  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

export function getWordItemClassName(highlightKind: WordHighlightKind | undefined) {
  if (highlightKind === "steal") {
    return "word-item word-item-steal";
  }
  if (highlightKind === "claim") {
    return "word-item word-item-claim";
  }
  return "word-item";
}
