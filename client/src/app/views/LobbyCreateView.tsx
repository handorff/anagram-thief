import type { Dispatch, SetStateAction } from "react";

type Props = {
  createRoomName: string;
  setCreateRoomName: Dispatch<SetStateAction<string>>;
  createPublic: boolean;
  setCreatePublic: Dispatch<SetStateAction<boolean>>;
  createMaxPlayers: number;
  setCreateMaxPlayers: Dispatch<SetStateAction<number>>;
  createFlipTimerEnabled: boolean;
  setCreateFlipTimerEnabled: Dispatch<SetStateAction<boolean>>;
  createFlipTimerSeconds: number;
  setCreateFlipTimerSeconds: Dispatch<SetStateAction<number>>;
  createClaimTimerSeconds: number;
  setCreateClaimTimerSeconds: Dispatch<SetStateAction<number>>;
  createPreStealEnabled: boolean;
  setCreatePreStealEnabled: Dispatch<SetStateAction<boolean>>;
  minFlipTimerSeconds: number;
  maxFlipTimerSeconds: number;
  minClaimTimerSeconds: number;
  maxClaimTimerSeconds: number;
  clampFlipTimerSeconds: (value: number) => number;
  clampClaimTimerSeconds: (value: number) => number;
  onBackToGames: () => void;
  onCreate: () => void;
};

export function LobbyCreateView({
  createRoomName,
  setCreateRoomName,
  createPublic,
  setCreatePublic,
  createMaxPlayers,
  setCreateMaxPlayers,
  createFlipTimerEnabled,
  setCreateFlipTimerEnabled,
  createFlipTimerSeconds,
  setCreateFlipTimerSeconds,
  createClaimTimerSeconds,
  setCreateClaimTimerSeconds,
  createPreStealEnabled,
  setCreatePreStealEnabled,
  minFlipTimerSeconds,
  maxFlipTimerSeconds,
  minClaimTimerSeconds,
  maxClaimTimerSeconds,
  clampFlipTimerSeconds,
  clampClaimTimerSeconds,
  onBackToGames,
  onCreate
}: Props) {
  const minFlipTimerSliderSeconds = Math.max(5, minFlipTimerSeconds);
  const maxFlipTimerSliderSeconds = Math.min(60, maxFlipTimerSeconds);
  const visibleFlipTimerSeconds = Math.min(
    maxFlipTimerSliderSeconds,
    Math.max(minFlipTimerSliderSeconds, createFlipTimerSeconds)
  );

  return (
    <div className="grid">
      <section className="panel panel-narrow">
        <h2>New Game</h2>
        <h3 className="form-section-label">Room</h3>
        <label>
          Room name
          <input
            value={createRoomName}
            onChange={(e) => setCreateRoomName(e.target.value)}
            placeholder="Friday Night"
          />
        </label>
        <label className="row">
          <span>Public room</span>
          <input
            type="checkbox"
            checked={createPublic}
            onChange={(e) => setCreatePublic(e.target.checked)}
          />
        </label>
        <label>
          Max players ({createMaxPlayers})
          <input
            type="range"
            min={2}
            max={8}
            step={1}
            value={createMaxPlayers}
            onChange={(e) => setCreateMaxPlayers(Number(e.target.value))}
          />
        </label>
        <h3 className="form-section-label">Gameplay</h3>
        <label className="row">
          <span>Enable pre-steal</span>
          <input
            type="checkbox"
            checked={createPreStealEnabled}
            onChange={(event) => setCreatePreStealEnabled(event.target.checked)}
          />
        </label>
        <label>
          Claim timer ({createClaimTimerSeconds}s)
          <input
            type="range"
            min={minClaimTimerSeconds}
            max={maxClaimTimerSeconds}
            step={1}
            value={createClaimTimerSeconds}
            onChange={(e) => setCreateClaimTimerSeconds(clampClaimTimerSeconds(Number(e.target.value)))}
          />
        </label>
        <label className="row">
          <span>Enable flip timer</span>
          <input
            type="checkbox"
            checked={createFlipTimerEnabled}
            onChange={(e) => setCreateFlipTimerEnabled(e.target.checked)}
          />
        </label>
        {createFlipTimerEnabled && (
          <label>
            Flip timer ({visibleFlipTimerSeconds}s)
            <input
              type="range"
              min={minFlipTimerSliderSeconds}
              max={maxFlipTimerSliderSeconds}
              step={5}
              value={visibleFlipTimerSeconds}
              onChange={(e) => setCreateFlipTimerSeconds(clampFlipTimerSeconds(Number(e.target.value)))}
            />
          </label>
        )}
        <div className="button-row">
          <button className="button-secondary" onClick={onBackToGames}>
            Back to games
          </button>
          <button onClick={onCreate}>Create game</button>
        </div>
      </section>
    </div>
  );
}
