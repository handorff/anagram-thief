import assert from "node:assert/strict";
import test from "node:test";
import type { Player, PreStealEntry, Tile, Word } from "../../shared/types.js";
import {
  executeClaim,
  isPreStealEntryValid,
  maybeRunAutoPreSteal,
  revalidateAllPreStealEntries
} from "./index.js";

function makeTile(letter: string, id: string): Tile {
  return {
    id,
    letter
  };
}

function makeWord(text: string, ownerId: string, id: string): Word {
  return {
    id,
    text,
    ownerId,
    tileIds: text.split("").map((_, index) => `${id}-tile-${index}`),
    createdAt: Date.now()
  };
}

function makeEntry(id: string, triggerLetters: string, claimWord: string): PreStealEntry {
  return {
    id,
    triggerLetters,
    claimWord,
    createdAt: Date.now()
  };
}

function makePlayer(
  id: string,
  name: string,
  words: Word[] = [],
  preStealEntries: PreStealEntry[] = [],
  connected = true
): Player {
  return {
    id,
    name,
    connected,
    words,
    preStealEntries,
    score: words.reduce((sum, word) => sum + word.text.length, 0)
  };
}

function makeGame({
  players,
  centerLetters = "",
  preStealEnabled = true,
  precedenceOrder
}: {
  players: Player[];
  centerLetters?: string;
  preStealEnabled?: boolean;
  precedenceOrder?: string[];
}): any {
  const now = Date.now();
  return {
    roomId: "room-1",
    status: "in-game" as const,
    bag: [makeTile("Z", "bag-0")],
    centerTiles: centerLetters.split("").map((letter, index) => makeTile(letter, `center-${index}`)),
    players,
    turnOrder: players.map((player) => player.id),
    turnIndex: 0,
    turnPlayerId: players[0]?.id ?? "",
    lastClaimAt: null as number | null,
    endTimer: undefined as NodeJS.Timeout | undefined,
    endTimerEndsAt: undefined as number | undefined,
    flipTimer: {
      enabled: false,
      seconds: 15
    },
    flipTimerTimeout: undefined as NodeJS.Timeout | undefined,
    flipTimerEndsAt: undefined as number | undefined,
    flipTimerToken: undefined as string | undefined,
    pendingFlip: null,
    pendingFlipTimeout: undefined as NodeJS.Timeout | undefined,
    claimTimer: {
      seconds: 3
    },
    claimWindow: null,
    claimWindowTimeout: undefined as NodeJS.Timeout | undefined,
    claimCooldowns: {} as Record<string, number>,
    claimCooldownTimeouts: new Map<string, NodeJS.Timeout>(),
    preStealEnabled,
    preStealPrecedenceOrder: precedenceOrder ?? players.map((player) => player.id),
    lastClaimEvent: null as any,
    createdAtForTests: now
  };
}

test("isPreStealEntryValid accepts and rejects based on same-word forms", () => {
  const sourceWord = makeWord("RATE", "p-source", "w-rate");
  const owner = makePlayer("p-owner", "Owner", [], []);
  const source = makePlayer("p-source", "Source", [sourceWord], []);
  const game = makeGame({
    players: [owner, source]
  });

  assert.equal(isPreStealEntryValid(game as any, makeEntry("e-ok", "S", "STARE")), true);
  assert.equal(isPreStealEntryValid(game as any, makeEntry("e-bad", "Z", "STARE")), false);
  assert.equal(isPreStealEntryValid(game as any, makeEntry("e-same-form", "S", "RATES")), false);
});

test("revalidateAllPreStealEntries removes invalid entries when source words change", () => {
  const sourceWord = makeWord("RATE", "p-source", "w-rate");
  const entry = makeEntry("e-1", "S", "STARE");
  const owner = makePlayer("p-owner", "Owner", [], [entry]);
  const source = makePlayer("p-source", "Source", [sourceWord], []);
  const game = makeGame({
    players: [owner, source]
  });

  assert.equal(owner.preStealEntries.length, 1);
  source.words = [makeWord("MATE", "p-source", "w-mate")];
  revalidateAllPreStealEntries(game as any);
  assert.equal(owner.preStealEntries.length, 0);
});

test("maybeRunAutoPreSteal uses entry order for a single player", () => {
  const source = makePlayer("p-source", "Source", [makeWord("RATE", "p-source", "w-rate")], []);
  const owner = makePlayer(
    "p-owner",
    "Owner",
    [],
    [makeEntry("e-first", "S", "TARES"), makeEntry("e-second", "S", "STARE")]
  );
  const game = makeGame({
    players: [owner, source],
    centerLetters: "S",
    precedenceOrder: ["p-owner", "p-source"]
  });

  const didRun = maybeRunAutoPreSteal(game as any);
  assert.equal(didRun, true);
  assert.equal(owner.words.length, 1);
  assert.equal(owner.words[0].text, "TARES");
  assert.equal(game.lastClaimEvent?.source, "pre-steal");
});

test("maybeRunAutoPreSteal respects precedence and moves winner to bottom", () => {
  const source = makePlayer("p-source", "Source", [makeWord("RATE", "p-source", "w-rate")], []);
  const alice = makePlayer("p-alice", "Alice", [], [makeEntry("e-alice", "S", "STARE")]);
  const bob = makePlayer("p-bob", "Bob", [], [makeEntry("e-bob", "S", "TARES")]);
  const game = makeGame({
    players: [alice, bob, source],
    centerLetters: "S",
    precedenceOrder: ["p-bob", "p-alice", "p-source"]
  });

  const didRun = maybeRunAutoPreSteal(game as any);
  assert.equal(didRun, true);
  assert.equal(bob.words.length, 1);
  assert.equal(alice.words.length, 0);
  assert.deepEqual(game.preStealPrecedenceOrder, ["p-alice", "p-source", "p-bob"]);
  assert.equal(game.lastClaimEvent?.movedToBottomOfPreStealPrecedence, true);
});

test("maybeRunAutoPreSteal skips disconnected players and performs one auto-claim only", () => {
  const source = makePlayer(
    "p-source",
    "Source",
    [makeWord("RATE", "p-source", "w-rate"), makeWord("MATE", "p-source", "w-mate")],
    []
  );
  const disconnected = makePlayer(
    "p-disconnected",
    "Disconnected",
    [],
    [makeEntry("e-disconnected", "S", "STARE")],
    false
  );
  const connected = makePlayer("p-connected", "Connected", [], [makeEntry("e-connected", "S", "STEAM")]);
  const another = makePlayer("p-another", "Another", [], [makeEntry("e-another", "S", "TARES")]);
  const game = makeGame({
    players: [disconnected, connected, another, source],
    centerLetters: "SS",
    precedenceOrder: ["p-disconnected", "p-connected", "p-another", "p-source"]
  });

  const didRun = maybeRunAutoPreSteal(game as any);
  assert.equal(didRun, true);
  assert.equal(connected.words.length, 1);
  assert.equal(another.words.length, 0);
  assert.equal(game.players.find((player: Player) => player.id === "p-another")?.preStealEntries.length, 1);
});

test("executeClaim supports manual claims with and without pre-steal mode", () => {
  const manualPlayer = makePlayer("p-manual", "Manual");

  const disabledGame = makeGame({
    players: [manualPlayer],
    centerLetters: "TEAM",
    preStealEnabled: false
  });
  const disabledResult = executeClaim(disabledGame as any, manualPlayer, "TEAM", "manual");
  assert.ok(disabledResult);
  assert.equal(manualPlayer.words.length, 1);
  assert.equal(disabledGame.lastClaimEvent?.source, "manual");
  assert.equal(disabledGame.lastClaimEvent?.movedToBottomOfPreStealPrecedence, false);

  const enabledPlayer = makePlayer("p-enabled", "Enabled");
  const enabledGame = makeGame({
    players: [enabledPlayer],
    centerLetters: "TEAM",
    preStealEnabled: true
  });
  const enabledResult = executeClaim(enabledGame as any, enabledPlayer, "TEAM", "manual");
  assert.ok(enabledResult);
  assert.equal(enabledPlayer.words.length, 1);
  assert.equal(enabledGame.lastClaimEvent?.source, "manual");
  assert.equal(enabledGame.lastClaimEvent?.movedToBottomOfPreStealPrecedence, false);
});

test("executeClaim blocks same-family steals and allows unrelated containment steals", () => {
  const source = makePlayer("p-source", "Source", [makeWord("MILE", "p-source", "w-mile")], []);
  const claimant = makePlayer("p-claimant", "Claimant");
  const game = makeGame({
    players: [claimant, source],
    centerLetters: "S"
  });

  const blocked = executeClaim(game as any, claimant, "MILES", "manual");
  assert.equal(blocked, null);
  assert.equal(claimant.words.length, 0);
  assert.equal(source.words.length, 1);

  const allowed = executeClaim(game as any, claimant, "SMILE", "manual");
  assert.ok(allowed);
  assert.equal(claimant.words.length, 1);
  assert.equal(claimant.words[0].text, "SMILE");
  assert.equal(source.words.length, 0);
});
