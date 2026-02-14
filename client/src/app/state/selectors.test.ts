import assert from "node:assert/strict";
import test from "node:test";
import { createInactivePracticeState } from "../practice/practiceUtils";
import { createInitialAppState } from "./appReducer";
import {
  selectClaimUi,
  selectCurrentPlayers,
  selectInProgressLobbyRooms,
  selectOpenLobbyRooms
} from "./selectors";

function makeState() {
  return createInitialAppState({
    isConnected: true,
    playerName: "Paul",
    userSettings: {
      inputMethod: "typing",
      theme: "light",
      chatEnabled: true,
      bottomPanelMode: "log"
    },
    practiceState: createInactivePracticeState(),
    pendingSharedLaunch: null,
    pendingPrivateRoomJoin: null,
    defaultFlipTimerSeconds: 3,
    defaultClaimTimerSeconds: 10,
    defaultPracticeDifficulty: 2,
    defaultPracticeTimerSeconds: 90
  });
}

test("lobby selectors split room list by status", () => {
  const state = makeState();
  state.server.roomList = [
    { id: "1", name: "A", status: "lobby", playerCount: 1, maxPlayers: 8, isPublic: true },
    { id: "2", name: "B", status: "in-game", playerCount: 2, maxPlayers: 8, isPublic: true }
  ] as any;

  assert.equal(selectOpenLobbyRooms(state).length, 1);
  assert.equal(selectInProgressLobbyRooms(state).length, 1);
});

test("selectCurrentPlayers prefers game players when game state exists", () => {
  const state = makeState();
  state.server.roomState = {
    id: "room",
    name: "Room",
    status: "lobby",
    hostId: "host",
    players: [{ id: "room-player", name: "Room Player", connected: true }],
    isPublic: true,
    maxPlayers: 8,
    code: null,
    claimTimer: { seconds: 10 },
    flipTimer: { enabled: false, seconds: 0 },
    preSteal: { enabled: true }
  } as any;
  state.server.gameState = {
    players: [{ id: "game-player", name: "Game Player", connected: true }]
  } as any;

  const players = selectCurrentPlayers(state);
  assert.equal(players[0]?.id, "game-player");
});

test("selectClaimUi returns spectator status when self is not in game", () => {
  const state = makeState();
  state.connection.selfPlayerId = "self";
  state.server.roomState = { status: "in-game", claimTimer: { seconds: 12 } } as any;
  state.server.gameState = {
    players: [{ id: "other", name: "Other", connected: true }],
    claimWindow: null,
    claimCooldowns: {},
    pendingFlip: null
  } as any;

  const claimUi = selectClaimUi(state);
  assert.equal(claimUi.claimStatus, "Spectating (read-only)");
});
