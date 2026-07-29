import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, Card, FilterChip, FormField, SectionHeading } from "../../components/ui";
import {
  APPROVED_SCREEN_TITLES,
  PRIMARY_NAVIGATION_ITEMS,
  getRouteNavigation,
} from "../../lib/routeNavigation";

test("the route map uses approved titles and accurate primary destinations", () => {
  assert.deepEqual(PRIMARY_NAVIGATION_ITEMS.map((item) => item.label), [
    "Home",
    "Chat",
    "Calendar",
    "Search",
    "Profile",
  ]);
  for (const path of ["/home", "/match", "/matches", "/messages", "/directory", "/events", "/calendar", "/profile", "/activity-leaderboard"]) {
    assert.ok(APPROVED_SCREEN_TITLES.includes(getRouteNavigation(path).screenTitle as never));
  }
  assert.equal(getRouteNavigation("/messages/thread-1").desktopActiveDestination, "Chat");
  assert.equal(getRouteNavigation("/events").desktopActiveDestination, null);
  assert.equal(getRouteNavigation("/events/new").fallbackRoute, "/events");
  assert.equal(getRouteNavigation("/matches/abc/summary?from=notification").fallbackRoute, "/home");
  assert.equal(getRouteNavigation("/players/player-1").desktopActiveDestination, "Search");
  assert.equal(getRouteNavigation("/invites/invite-1").fallbackRoute, "/messages");
  assert.equal(getRouteNavigation("/forgot-password").fallbackRoute, "/login");
  assert.equal(getRouteNavigation("/privacy").usesStandardApplicationHeader, false);
});

test("shared buttons expose type, loading, variants, and minimum target styling", () => {
  const html = renderToStaticMarkup(
    <>
      <Button>Continue</Button>
      <Button variant="destructive" loading loadingLabel="Deleting">Delete</Button>
    </>
  );
  assert.match(html, /type="button"/);
  assert.match(html, /min-h-11/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, />Deleting</);
  assert.match(html, /--tm-color-error/);
});

test("form, chip, card, and section primitives expose consistent semantics", () => {
  const html = renderToStaticMarkup(
    <Card>
      <SectionHeading title="Players" supportingText="Nearby players" />
      <FormField id="postcode" label="Postcode" error="Enter four digits" />
      <FilterChip selected>Nearby</FilterChip>
    </Card>
  );
  assert.match(html, /<h2/);
  assert.match(html, /for="postcode"/);
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /aria-describedby="postcode-error"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /--tm-radius-card/);
});

test("the standard header foundation includes deterministic back behavior and semantic tokens", () => {
  const backButtonSource = readFileSync("components/ui/BackButton.tsx", "utf8");
  const headerSource = readFileSync("components/ui/PageHeader.tsx", "utf8");
  const tokensSource = readFileSync("app/globals.css", "utf8");

  assert.match(backButtonSource, /window\.history\.length > 1/);
  assert.match(backButtonSource, /router\.push\(fallbackHref\)/);
  assert.match(backButtonSource, /<ArrowLeft/);
  assert.match(headerSource, /min-h-16/);
  assert.match(headerSource, /<h1/);
  for (const token of [
    "--tm-color-brand-primary",
    "--tm-color-brand-accent",
    "--tm-space-4",
    "--tm-text-page-title",
    "--tm-radius-button",
    "--tm-shadow-card",
  ]) {
    assert.match(tokensSource, new RegExp(token));
  }
});

test("high-visibility screens retain their page-specific headers", () => {
  const restoredFiles = [
    "app/home/HomeClient.tsx",
    "components/home/DesktopDashboardHome.tsx",
    "app/match/MatchClient.tsx",
    "app/matches/MatchesPageClient.tsx",
    "components/matches/DesktopMatches.tsx",
    "app/messages/MessagesClient.tsx",
    "components/DirectoryPage.tsx",
    "components/directory/DesktopDirectoryPage.tsx",
    "app/events/page.tsx",
    "components/events/DesktopEventsPage.tsx",
    "app/calendar/page.tsx",
    "components/calendar/DesktopCalendarView.tsx",
    "app/profile/ProfileContent.tsx",
    "components/profile/DesktopProfilePage.tsx",
    "app/profile/DesktopProfileEditPage.tsx",
    "app/activity-leaderboard/ActivityLeaderboardClient.tsx",
  ];

  for (const file of restoredFiles) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /<PageHeader/, `${file} must retain its page-specific header`);
  }

  assert.match(readFileSync("app/home/HomeClient.tsx", "utf8"), /Hello, \{userName\}!/);
  assert.match(readFileSync("app/match/MatchClient.tsx", "utf8"), /Find a Match/);
  assert.match(readFileSync("components/matches/DesktopMatches.tsx", "utf8"), /Match Center/);
  assert.match(readFileSync("components/directory/DesktopDirectoryPage.tsx", "utf8"), />\s*Directory\s*</);
  assert.match(readFileSync("app/events/page.tsx", "utf8"), /Tennis Events/);
  assert.match(readFileSync("components/profile/DesktopProfilePage.tsx", "utf8"), /My Profile/);
  assert.doesNotMatch(readFileSync("app/calendar/page.tsx", "utf8"), /<ClientLayoutWrapper>/);

  const sidebarSource = readFileSync("components/desktop_layout/TMDesktopSidebar.tsx", "utf8");
  assert.match(sidebarSource, /PRIMARY_NAVIGATION_ITEMS/);
  assert.match(sidebarSource, /getRouteNavigation\(pathname\)\.desktopActiveDestination/);
  assert.doesNotMatch(sidebarSource, /active\?:/);
});
