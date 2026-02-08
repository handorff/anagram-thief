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
  return (
    <div className="grid">
      <section className="panel panel-narrow">
        <h2>New Game</h2>
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
          Max players (2-8)
          <input
            type="number"
            min={2}
            max={8}
            value={createMaxPlayers}
            onChange={(e) => setCreateMaxPlayers(Number(e.target.value))}
          />
        </label>
        <label className="row">
          <span>Flip timer</span>
          <input
            type="checkbox"
            checked={createFlipTimerEnabled}
            onChange={(e) => setCreateFlipTimerEnabled(e.target.checked)}
          />
        </label>
        <label>
          Flip timer seconds (1-60)
          <input
            type="number"
            min={minFlipTimerSeconds}
            max={maxFlipTimerSeconds}
            value={createFlipTimerSeconds}
            onChange={(e) => setCreateFlipTimerSeconds(Number(e.target.value))}
            onBlur={() =>
              setCreateFlipTimerSeconds((current) => clampFlipTimerSeconds(current))
            }
            disabled={!createFlipTimerEnabled}
          />
        </label>
        <label>
          Claim timer seconds (1-10)
          <input
            type="number"
            min={minClaimTimerSeconds}
            max={maxClaimTimerSeconds}
            value={createClaimTimerSeconds}
            onChange={(e) => setCreateClaimTimerSeconds(Number(e.target.value))}
            onBlur={() =>
              setCreateClaimTimerSeconds((current) => clampClaimTimerSeconds(current))
            }
          />
        </label>
        <label className="row">
          <span>Enable pre-steal</span>
          <input
            type="checkbox"
            checked={createPreStealEnabled}
            onChange={(event) => setCreatePreStealEnabled(event.target.checked)}
          />
        </label>
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
