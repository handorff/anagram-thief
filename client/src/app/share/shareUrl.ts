import type {
  PracticeModeState,
  PracticeResultSharePayload,
  PracticeSharePayload
} from "@shared/types";
import { decodePracticeSharePayload } from "@shared/practiceShare";
import { decodePracticeResultSharePayload } from "@shared/practiceResultShare";
import {
  PRACTICE_CHALLENGE_QUERY_PARAM,
  PRACTICE_RESULT_SHARE_QUERY_PARAM,
  PRACTICE_SHARE_QUERY_PARAM,
  PRIVATE_ROOM_CODE_QUERY_PARAM,
  PRIVATE_ROOM_QUERY_PARAM
} from "../constants";
import type {
  PendingPrivateRoomJoin,
  PendingSharedLaunch
} from "../types";
import { normalizeEditorText } from "../practice/practiceUtils";

export function buildPracticePuzzleFingerprint(payload: Pick<PracticeSharePayload, "c" | "w">): string {
  return `${payload.c}|${payload.w.join(",")}`;
}

export function buildPracticePuzzleFingerprintFromState(puzzle: PracticeModeState["puzzle"]): string | null {
  if (!puzzle) return null;
  const center = puzzle.centerTiles.map((tile) => normalizeEditorText(tile.letter)).join("");
  const words = puzzle.existingWords.map((word) => normalizeEditorText(word.text));
  return buildPracticePuzzleFingerprint({
    c: center,
    w: words
  });
}

function parseResultSharePayloadFromUrl(token: string): PracticeResultSharePayload | null {
  return decodePracticeResultSharePayload(token);
}

export function readPendingSharedLaunchFromUrl(): PendingSharedLaunch | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const challengeToken = params.get(PRACTICE_CHALLENGE_QUERY_PARAM);
  if (challengeToken) {
    const parsed = parseResultSharePayloadFromUrl(challengeToken);
    if (parsed) {
      return {
        kind: "challenge",
        payload: parsed.p,
        submittedWord: parsed.a,
        sharerName: parsed.n,
        expectedPuzzleFingerprint: buildPracticePuzzleFingerprint(parsed.p)
      };
    }
  }

  const resultToken = params.get(PRACTICE_RESULT_SHARE_QUERY_PARAM);
  if (resultToken) {
    const parsed = parseResultSharePayloadFromUrl(resultToken);
    if (parsed) {
      return {
        kind: "result",
        payload: parsed.p,
        submittedWord: parsed.a,
        sharerName: parsed.n,
        expectedPuzzleFingerprint: buildPracticePuzzleFingerprint(parsed.p)
      };
    }
  }

  const practiceToken = params.get(PRACTICE_SHARE_QUERY_PARAM);
  if (!practiceToken) return null;
  const puzzlePayload = decodePracticeSharePayload(practiceToken);
  if (!puzzlePayload) return null;
  return {
    kind: "puzzle",
    payload: puzzlePayload
  };
}

export function readPendingPrivateRoomJoinFromUrl(): PendingPrivateRoomJoin | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get(PRIVATE_ROOM_QUERY_PARAM)?.trim();
  const code = params.get(PRIVATE_ROOM_CODE_QUERY_PARAM)?.trim();
  if (!roomId || !code) return null;
  return { roomId, code };
}

export function removePracticeShareFromUrl() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (
    !params.has(PRACTICE_SHARE_QUERY_PARAM) &&
    !params.has(PRACTICE_RESULT_SHARE_QUERY_PARAM) &&
    !params.has(PRACTICE_CHALLENGE_QUERY_PARAM)
  ) {
    return;
  }
  params.delete(PRACTICE_SHARE_QUERY_PARAM);
  params.delete(PRACTICE_RESULT_SHARE_QUERY_PARAM);
  params.delete(PRACTICE_CHALLENGE_QUERY_PARAM);
  const search = params.toString();
  const nextUrl = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", nextUrl);
}

export function removePrivateRoomJoinFromUrl() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (!params.has(PRIVATE_ROOM_QUERY_PARAM) && !params.has(PRIVATE_ROOM_CODE_QUERY_PARAM)) return;
  params.delete(PRIVATE_ROOM_QUERY_PARAM);
  params.delete(PRIVATE_ROOM_CODE_QUERY_PARAM);
  const search = params.toString();
  const nextUrl = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", nextUrl);
}

export function buildPrivateRoomInviteUrl(roomId: string, code: string): string {
  const inviteUrl = new URL(window.location.origin + window.location.pathname);
  inviteUrl.searchParams.set(PRIVATE_ROOM_QUERY_PARAM, roomId);
  inviteUrl.searchParams.set(PRIVATE_ROOM_CODE_QUERY_PARAM, code);
  return inviteUrl.toString();
}
