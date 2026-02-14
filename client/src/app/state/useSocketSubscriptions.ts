import { useEffect } from "react";
import type {
  ChatMessage,
  GameState,
  PracticeModeState,
  RoomState,
  RoomSummary
} from "@shared/types";
import { socket } from "../network/socketClient";

export type SocketHandlers = {
  onConnect: () => void;
  onDisconnect: () => void;
  onRoomList: (rooms: RoomSummary[]) => void;
  onRoomState: (state: RoomState) => void;
  onGameState: (state: GameState) => void;
  onPracticeState: (state: PracticeModeState) => void;
  onChatHistory: (messages: ChatMessage[]) => void;
  onChatMessage: (message: ChatMessage) => void;
  onSessionSelf: (payload: {
    playerId: string;
    name: string;
    roomId: string | null;
    sessionToken?: string;
  }) => void;
  onError: (payload: { message: string }) => void;
};

export function useSocketSubscriptions({
  onConnect,
  onDisconnect,
  onRoomList,
  onRoomState,
  onGameState,
  onPracticeState,
  onChatHistory,
  onChatMessage,
  onSessionSelf,
  onError
}: SocketHandlers): void {
  useEffect(() => {
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:list", onRoomList);
    socket.on("room:state", onRoomState);
    socket.on("game:state", onGameState);
    socket.on("practice:state", onPracticeState);
    socket.on("chat:history", onChatHistory);
    socket.on("chat:message", onChatMessage);
    socket.on("session:self", onSessionSelf);
    socket.on("error", onError);

    if (socket.connected) {
      onConnect();
    }

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:list", onRoomList);
      socket.off("room:state", onRoomState);
      socket.off("game:state", onGameState);
      socket.off("practice:state", onPracticeState);
      socket.off("chat:history", onChatHistory);
      socket.off("chat:message", onChatMessage);
      socket.off("session:self", onSessionSelf);
      socket.off("error", onError);
    };
  }, [
    onConnect,
    onDisconnect,
    onRoomList,
    onRoomState,
    onGameState,
    onPracticeState,
    onChatHistory,
    onChatMessage,
    onSessionSelf,
    onError
  ]);
}
