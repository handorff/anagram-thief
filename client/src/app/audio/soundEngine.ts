import { GAMEPLAY_SOUND_MANIFEST } from "./soundManifest";
import type { GameplaySoundId } from "./soundTypes";

type PlayGameplaySoundOptions = {
  enabled: boolean;
  volume: number;
};

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export class GameplaySoundEngine {
  private baseAudioById = new Map<GameplaySoundId, HTMLAudioElement>();
  private warnedKeys = new Set<string>();
  private brokenSoundIds = new Set<GameplaySoundId>();
  private isUnlocked = false;
  private readonly handleUnlockGesture = () => {
    this.unlock();
  };

  constructor() {
    if (typeof window === "undefined") return;
    for (const [soundId, config] of Object.entries(GAMEPLAY_SOUND_MANIFEST) as [
      GameplaySoundId,
      (typeof GAMEPLAY_SOUND_MANIFEST)[GameplaySoundId]
    ][]) {
      const audio = new Audio(config.src);
      audio.preload = "auto";
      audio.addEventListener("error", () => {
        this.brokenSoundIds.add(soundId);
        this.warnOnce(
          `audio-load:${soundId}`,
          `Failed to load gameplay sound "${soundId}" from ${config.src}.`
        );
      });
      try {
        audio.load();
      } catch {
        this.brokenSoundIds.add(soundId);
        this.warnOnce(
          `audio-load:${soundId}`,
          `Failed to initialize gameplay sound "${soundId}" from ${config.src}.`
        );
      }
      this.baseAudioById.set(soundId, audio);
    }

    window.addEventListener("pointerdown", this.handleUnlockGesture);
    window.addEventListener("keydown", this.handleUnlockGesture);
  }

  play(soundId: GameplaySoundId, options: PlayGameplaySoundOptions) {
    if (typeof window === "undefined") return;
    if (!options.enabled) return;
    if (this.brokenSoundIds.has(soundId)) return;

    const config = GAMEPLAY_SOUND_MANIFEST[soundId];
    const baseAudio = this.baseAudioById.get(soundId);
    if (!config || !baseAudio) return;

    const finalVolume = clamp01(options.volume) * clamp01(config.gain);
    if (finalVolume <= 0) return;

    const playback = baseAudio.cloneNode(true) as HTMLAudioElement;
    playback.volume = finalVolume;
    playback.currentTime = 0;

    const playPromise = playback.play();
    if (!playPromise) return;

    playPromise.catch(() => {
      if (!this.isUnlocked) return;
      this.warnOnce(`audio-play:${soundId}`, `Failed to play gameplay sound "${soundId}".`);
    });
  }

  dispose() {
    if (typeof window !== "undefined") {
      window.removeEventListener("pointerdown", this.handleUnlockGesture);
      window.removeEventListener("keydown", this.handleUnlockGesture);
    }
    this.baseAudioById.clear();
    this.brokenSoundIds.clear();
  }

  private unlock() {
    if (typeof window === "undefined") return;
    if (this.isUnlocked) return;
    this.isUnlocked = true;
    window.removeEventListener("pointerdown", this.handleUnlockGesture);
    window.removeEventListener("keydown", this.handleUnlockGesture);

    for (const baseAudio of this.baseAudioById.values()) {
      const playback = baseAudio.cloneNode(true) as HTMLAudioElement;
      playback.muted = true;
      playback.volume = 0;
      playback.currentTime = 0;
      const playPromise = playback.play();
      if (!playPromise) continue;
      void playPromise
        .then(() => {
          playback.pause();
          playback.currentTime = 0;
        })
        .catch(() => {
          // Ignore unlock failures.
        });
    }
  }

  private warnOnce(key: string, message: string) {
    if (this.warnedKeys.has(key)) return;
    this.warnedKeys.add(key);
    console.warn(message);
  }
}
