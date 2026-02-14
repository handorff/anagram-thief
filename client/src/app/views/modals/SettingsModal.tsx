import type {
  Dispatch,
  SetStateAction
} from "react";
import type { UserSettings } from "../../../userSettings";

type Props = {
  editNameDraft: string;
  setEditNameDraft: Dispatch<SetStateAction<string>>;
  userSettingsDraft: UserSettings;
  setUserSettingsDraft: Dispatch<SetStateAction<UserSettings>>;
  onClose: () => void;
  onSave: () => void;
};

export function SettingsModal({
  editNameDraft,
  setEditNameDraft,
  userSettingsDraft,
  setUserSettingsDraft,
  onClose,
  onSave
}: Props) {
  return (
    <div className="join-overlay">
      <div className="panel join-modal settings-modal" role="dialog" aria-modal="true">
        <h2>Settings</h2>
        <label>
          Display name
          <input
            value={editNameDraft}
            onChange={(event) => setEditNameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                onSave();
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
              checked={userSettingsDraft.inputMethod === "tile"}
              onChange={(event) =>
                setUserSettingsDraft((current) => ({
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
              checked={userSettingsDraft.theme === "dark"}
              onChange={(event) =>
                setUserSettingsDraft((current) => ({
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
              checked={userSettingsDraft.chatEnabled}
              onChange={(event) =>
                setUserSettingsDraft((current) => ({
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
        <div className="settings-section">
          <span>Sound</span>
          <label className="settings-option">
            <input
              type="checkbox"
              checked={userSettingsDraft.soundEnabled}
              onChange={(event) =>
                setUserSettingsDraft((current) => ({
                  ...current,
                  soundEnabled: event.target.checked
                }))
              }
            />
            <span>
              <strong>Enable gameplay sound effects</strong>
            </span>
          </label>
          <label className="settings-sound-volume">
            <span>Volume: {Math.round(userSettingsDraft.soundVolume * 100)}%</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(userSettingsDraft.soundVolume * 100)}
              disabled={!userSettingsDraft.soundEnabled}
              onChange={(event) =>
                setUserSettingsDraft((current) => ({
                  ...current,
                  soundVolume: Math.max(0, Math.min(1, Number(event.target.value) / 100))
                }))
              }
            />
          </label>
        </div>
        <div className="button-row">
          <button className="button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button onClick={onSave} disabled={!editNameDraft.trim()}>
            Save settings
          </button>
        </div>
      </div>
    </div>
  );
}
