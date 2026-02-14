type LobbyCreateModel = {
  roomName: string;
  isPublic: boolean;
  maxPlayers: number;
  flipTimerEnabled: boolean;
  flipTimerSeconds: number;
  claimTimerSeconds: number;
  preStealEnabled: boolean;
};

type LobbyCreateLimits = {
  minFlipTimerSeconds: number;
  maxFlipTimerSeconds: number;
  minClaimTimerSeconds: number;
  maxClaimTimerSeconds: number;
  clampFlipTimerSeconds: (value: number) => number;
  clampClaimTimerSeconds: (value: number) => number;
};

type LobbyCreateActions = {
  onRoomNameChange: (value: string) => void;
  onPublicChange: (value: boolean) => void;
  onMaxPlayersChange: (value: number) => void;
  onFlipTimerEnabledChange: (value: boolean) => void;
  onFlipTimerSecondsChange: (value: number) => void;
  onClaimTimerSecondsChange: (value: number) => void;
  onPreStealEnabledChange: (value: boolean) => void;
  onBackToGames: () => void;
  onCreate: () => void;
};

type Props = {
  model: LobbyCreateModel;
  limits: LobbyCreateLimits;
  actions: LobbyCreateActions;
};

export function LobbyCreateView({ model, limits, actions }: Props) {
  const minFlipTimerSliderSeconds = Math.max(5, limits.minFlipTimerSeconds);
  const maxFlipTimerSliderSeconds = Math.min(60, limits.maxFlipTimerSeconds);
  const visibleFlipTimerSeconds = Math.min(
    maxFlipTimerSliderSeconds,
    Math.max(minFlipTimerSliderSeconds, model.flipTimerSeconds)
  );

  return (
    <div className="grid">
      <section className="panel panel-narrow">
        <h2>New Game</h2>
        <h3 className="form-section-label">Room</h3>
        <label>
          Room name
          <input
            value={model.roomName}
            onChange={(event) => actions.onRoomNameChange(event.target.value)}
            placeholder="Friday Night"
          />
        </label>
        <label className="row">
          <span>Public room</span>
          <input
            type="checkbox"
            checked={model.isPublic}
            onChange={(event) => actions.onPublicChange(event.target.checked)}
          />
        </label>
        <label>
          Max players ({model.maxPlayers})
          <input
            type="range"
            min={2}
            max={8}
            step={1}
            value={model.maxPlayers}
            onChange={(event) => actions.onMaxPlayersChange(Number(event.target.value))}
          />
        </label>
        <h3 className="form-section-label">Gameplay</h3>
        <label className="row">
          <span>Enable pre-steal</span>
          <input
            type="checkbox"
            checked={model.preStealEnabled}
            onChange={(event) => actions.onPreStealEnabledChange(event.target.checked)}
          />
        </label>
        <label>
          Claim timer ({model.claimTimerSeconds}s)
          <input
            type="range"
            min={limits.minClaimTimerSeconds}
            max={limits.maxClaimTimerSeconds}
            step={1}
            value={model.claimTimerSeconds}
            onChange={(event) =>
              actions.onClaimTimerSecondsChange(
                limits.clampClaimTimerSeconds(Number(event.target.value))
              )
            }
          />
        </label>
        <label className="row">
          <span>Enable flip timer</span>
          <input
            type="checkbox"
            checked={model.flipTimerEnabled}
            onChange={(event) => actions.onFlipTimerEnabledChange(event.target.checked)}
          />
        </label>
        {model.flipTimerEnabled && (
          <label>
            Flip timer ({visibleFlipTimerSeconds}s)
            <input
              type="range"
              min={minFlipTimerSliderSeconds}
              max={maxFlipTimerSliderSeconds}
              step={5}
              value={visibleFlipTimerSeconds}
              onChange={(event) =>
                actions.onFlipTimerSecondsChange(
                  limits.clampFlipTimerSeconds(Number(event.target.value))
                )
              }
            />
          </label>
        )}
        <div className="button-row">
          <button className="button-secondary" onClick={actions.onBackToGames}>
            Back to games
          </button>
          <button onClick={actions.onCreate}>Create game</button>
        </div>
      </section>
    </div>
  );
}
