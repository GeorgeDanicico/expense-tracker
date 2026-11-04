"use client";

import type { MockupId } from "../mockups";
import { HomeMockup } from "./home";
import { MoneyMockup } from "./money";
import { PlanningMockup } from "./planning";
import { MoreMockup, SettingsMockup } from "./settings";

const SCREENS: Record<MockupId, () => React.ReactNode> = {
  home: HomeMockup,
  // The quick-add mockups are Home with the sheet open (the shell opens it).
  "quick-add-expense": HomeMockup,
  "quick-add-todo": HomeMockup,
  "quick-add-reminder": HomeMockup,
  "quick-add-event": HomeMockup,
  "money-expenses": MoneyMockup,
  "planning-reminders": () => <PlanningMockup initial="reminders" />,
  "planning-todos": () => <PlanningMockup initial="todos" />,
  more: MoreMockup,
  "settings-account": () => <SettingsMockup page="account" />,
  "settings-notifications": () => <SettingsMockup page="notifications" />,
  "settings-family": () => <SettingsMockup page="family" />,
};

export function MockupScreen({ id }: { id: string }) {
  const Screen = SCREENS[id as MockupId];
  return <Screen />;
}
