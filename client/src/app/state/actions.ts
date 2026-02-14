import type { AppState } from "./types";

export type SetStateValue<T> = T | ((current: T) => T);

export type SliceUpdater<S> = Partial<S> | ((current: S) => S);

export type AppAction =
  | { type: "connection/patch"; updater: SliceUpdater<AppState["connection"]> }
  | { type: "server/patch"; updater: SliceUpdater<AppState["server"]> }
  | { type: "identity/patch"; updater: SliceUpdater<AppState["identity"]> }
  | { type: "settings/patch"; updater: SliceUpdater<AppState["settings"]> }
  | { type: "lobby/patch"; updater: SliceUpdater<AppState["lobby"]> }
  | { type: "practice/patch"; updater: SliceUpdater<AppState["practiceUi"]> }
  | { type: "game/patch"; updater: SliceUpdater<AppState["gameUi"]> }
  | { type: "replay/patch"; updater: SliceUpdater<AppState["replayUi"]> }
  | { type: "clock/tick"; now: number }
  | { type: "app/set-pending-private-room-join"; value: AppState["pendingPrivateRoomJoin"] }
  | { type: "app/set-private-invite-copy-status"; value: AppState["privateInviteCopyStatus"] }
  | { type: "game/clear-log-and-chat" }
  | { type: "replay/reset" }
  | { type: "practice/reset-inputs" }
  | { type: "lobby/reset-practice-start-prompt" }
  | { type: "app/reset-on-leave-room" };

export function applyUpdater<S extends object>(current: S, updater: SliceUpdater<S>): S {
  if (typeof updater === "function") {
    return (updater as (value: S) => S)(current);
  }
  return { ...current, ...updater };
}

export function resolveSetStateValue<T>(
  current: T,
  nextValue: SetStateValue<T>
): T {
  if (typeof nextValue === "function") {
    return (nextValue as (value: T) => T)(current);
  }
  return nextValue;
}
