import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_USER_SETTINGS,
  normalizeUserSettings
} from "./userSettings";

test("normalizeUserSettings defaults new sound fields for legacy stored settings", () => {
  const normalized = normalizeUserSettings({
    inputMethod: "tile",
    theme: "dark",
    bottomPanelMode: "chat",
    chatEnabled: true
  });

  assert.equal(normalized.soundEnabled, true);
  assert.equal(normalized.soundVolume, DEFAULT_USER_SETTINGS.soundVolume);
});

test("normalizeUserSettings clamps sound volume into [0, 1]", () => {
  assert.equal(normalizeUserSettings({ soundVolume: 2 }).soundVolume, 1);
  assert.equal(normalizeUserSettings({ soundVolume: -0.25 }).soundVolume, 0);
  assert.equal(normalizeUserSettings({ soundVolume: 0.32 }).soundVolume, 0.32);
});

test("normalizeUserSettings falls back for invalid sound types", () => {
  const normalized = normalizeUserSettings({
    soundEnabled: "yes",
    soundVolume: "loud"
  });

  assert.equal(normalized.soundEnabled, true);
  assert.equal(normalized.soundVolume, DEFAULT_USER_SETTINGS.soundVolume);
});
