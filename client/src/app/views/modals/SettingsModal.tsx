import type { UserSettings } from "../../../userSettings";

type SettingsModalModel = {
  editNameDraft: string;
  userSettingsDraft: UserSettings;
};

type SettingsModalActions = {
  onEditNameDraftChange: (value: string) => void;
  onUserSettingsDraftChange: (updater: (current: UserSettings) => UserSettings) => void;
  onClose: () => void;
  onSave: () => void;
};

type Props = {
  model: SettingsModalModel;
  actions: SettingsModalActions;
};

export function SettingsModal({ model, actions }: Props) {
  return (
    <div className="join-overlay">
      <div className="panel join-modal settings-modal" role="dialog" aria-modal="true">
        <h2>Settings</h2>
        <label>
          Display name
          <input
            value={model.editNameDraft}
            onChange={(event) => actions.onEditNameDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                actions.onSave();
              }
            }}
            placeholder="Player name"
            autoFocus
          />
        </label>
        <div className="settings-section">
          <span>Input method</span>
          <label className="settings-option">
            <input
              type="checkbox"
              checked={model.userSettingsDraft.inputMethod === "tile"}
              onChange={(event) =>
                actions.onUserSettingsDraftChange((current) => ({
                  ...current,
                  inputMethod: event.target.checked ? "tile" : "typing"
                }))
              }
            />
            <span>
              <strong>Enable click/tap letter tiles</strong>
            </span>
          </label>
        </div>
        <div className="settings-section">
          <span>Appearance</span>
          <label className="settings-option">
            <input
              type="checkbox"
              checked={model.userSettingsDraft.theme === "dark"}
              onChange={(event) =>
                actions.onUserSettingsDraftChange((current) => ({
                  ...current,
                  theme: event.target.checked ? "dark" : "light"
                }))
              }
            />
            <span>
              <strong>Dark mode</strong>
            </span>
          </label>
        </div>
        <div className="settings-section">
          <span>Chat</span>
          <label className="settings-option">
            <input
              type="checkbox"
              checked={model.userSettingsDraft.chatEnabled}
              onChange={(event) =>
                actions.onUserSettingsDraftChange((current) => ({
                  ...current,
                  chatEnabled: event.target.checked,
                  bottomPanelMode: event.target.checked ? current.bottomPanelMode : "log"
                }))
              }
            />
            <span>
              <strong>Enable in-game chat</strong>
            </span>
          </label>
        </div>
        <div className="button-row">
          <button className="button-secondary" onClick={actions.onClose}>
            Cancel
          </button>
          <button onClick={actions.onSave} disabled={!model.editNameDraft.trim()}>
            Save settings
          </button>
        </div>
      </div>
    </div>
  );
}
