import type {
  GameReplay,
  PracticeSharePayload,
  ReplayFileV1
} from "@shared/types";

export type PendingSharedLaunch =
  | {
      kind: "puzzle";
      payload: PracticeSharePayload;
    }
  | {
      kind: "challenge";
      payload: PracticeSharePayload;
      submittedWord: string;
      sharerName?: string;
      expectedPuzzleFingerprint: string;
    }
  | {
      kind: "result";
      payload: PracticeSharePayload;
      submittedWord: string;
      sharerName?: string;
      expectedPuzzleFingerprint: string;
    };

export type PendingResultAutoSubmit = {
  submittedWord: string;
  expectedPuzzleFingerprint: string;
  expiresAt: number;
};

export type PendingPrivateRoomJoin = {
  roomId: string;
  code: string;
};

export type GameLogKind = "event" | "error";

export type GameLogEntry = {
  id: string;
  timestamp: number;
  text: string;
  kind: GameLogKind;
};

export type WordSnapshot = {
  id: string;
  text: string;
  tileIds: string[];
  ownerId: string;
  createdAt: number;
};

export type PendingGameLogEntry = {
  text: string;
  kind: GameLogKind;
  timestamp?: number;
};

export type ClaimFailureContext = {
  message: string;
  at: number;
};

export type WordHighlightKind = "claim" | "steal";

export type EditorPuzzleDraft = {
  payload: PracticeSharePayload | null;
  validationMessage: string | null;
  normalizedCenter: string;
  normalizedExistingWords: string[];
};

export type ReplaySource =
  | {
      kind: "room";
      replay: GameReplay;
    }
  | {
      kind: "imported";
      file: ReplayFileV1;
    };
