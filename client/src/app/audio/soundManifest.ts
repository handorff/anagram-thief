import type { GameplaySoundId } from "./soundTypes";

export type GameplaySoundConfig = {
  src: string;
  gain: number;
};

export const GAMEPLAY_SOUND_MANIFEST: Record<GameplaySoundId, GameplaySoundConfig> = {
  flipReveal: {
    src: "/audio/flip-reveal.mp3",
    gain: 1
  },
  claimSuccess: {
    src: "/audio/claim-success.mp3",
    gain: 0.92
  },
  stealSuccess: {
    src: "/audio/steal-success.mp3",
    gain: 0.88
  },
  claimExpired: {
    src: "/audio/claim-expired.mp3",
    gain: 0.82
  },
  cooldownSelf: {
    src: "/audio/cooldown-self.mp3",
    gain: 0.78
  },
  gameEnd: {
    src: "/audio/game-end.mp3",
    gain: 0.9
  }
};
