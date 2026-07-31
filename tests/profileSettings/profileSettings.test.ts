import assert from "node:assert/strict";
import {existsSync, readFileSync} from "node:fs";
import test from "node:test";

const profileSource = readFileSync("app/profile/ProfileContent.tsx", "utf8");
const settingsSource = readFileSync("components/profile/ProfileSettingsMenu.tsx", "utf8");
const layoutSource = readFileSync("components/ClientLayoutWrapper.tsx", "utf8");

test("Profile settings icon opens the Settings dialog instead of Edit Profile", () => {
  assert.match(profileSource, /onClick=\{\(\) => setSettingsOpen\(true\)\}/);
  assert.match(profileSource, /aria-label="Open settings"/);
  assert.match(profileSource, /aria-haspopup="dialog"/);
  assert.match(profileSource, /<ProfileSettingsMenu open=\{settingsOpen\}/);
});

test("Settings menu exposes the required grouped destinations", () => {
  assert.match(settingsSource, />Account</);
  assert.match(settingsSource, /href="\/profile\?edit=true" label="Edit Profile"/);
  assert.match(settingsSource, />Support</);
  assert.match(settingsSource, /href="\/support" label="Help & Feedback"/);
  assert.match(settingsSource, />Legal</);
  assert.match(settingsSource, /href="\/terms" label="Terms of Use"/);
  assert.match(settingsSource, /href="\/privacy" label="Privacy Policy"/);
});

test("existing query-driven Edit Profile flow remains unchanged", () => {
  assert.match(profileSource, /searchParams\.get\("edit"\) === "true"/);
  assert.match(profileSource, /setEditMode\(wantsEdit\)/);
  assert.match(profileSource, /Edit Profile/);
});

test("Log Out requires explicit confirmation and Cancel does not sign out", () => {
  assert.match(settingsSource, /setConfirmLogout\(true\)/);
  assert.match(settingsSource, />Log out\?</);
  assert.match(settingsSource, /Are you sure you want to log out of TennisMate\?/);
  assert.match(settingsSource, /onClick=\{\(\) => setConfirmLogout\(false\)\}/);
  assert.match(settingsSource, />\s*Cancel\s*</);
  assert.match(settingsSource, /await signOut\(auth\)/);
  assert.match(settingsSource, /router\.replace\("\/login"\)/);
  assert.equal(settingsSource.match(/signOut\(auth\)/g)?.length, 1);
});

test("Settings and logout dialogs expose accessible modal semantics", () => {
  assert.match(settingsSource, /role="dialog"/);
  assert.match(settingsSource, /role="alertdialog"/);
  assert.match(settingsSource, /aria-modal="true"/);
  assert.match(settingsSource, /Close settings/);
  assert.match(settingsSource, /event\.key !== "Escape"/);
});

test("floating feedback implementation and its visibility helper are removed", () => {
  assert.doesNotMatch(layoutSource, /FloatingFeedbackButton|Give Feedback|hideFloatingFeedback/);
  assert.equal(existsSync("components/FloatingFeedbackButton.tsx"), false);
  assert.equal(existsSync("lib/feedbackVisibility.ts"), false);
});
