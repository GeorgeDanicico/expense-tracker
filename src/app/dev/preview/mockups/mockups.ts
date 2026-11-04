/**
 * U3's mockups: one route each under /dev/preview/mockups/<id>, phone first and responsive at
 * 1280 px. `taps` are counted from Home on a phone, the way docs/ui-audit.md counts them (a tap is
 * any press; typing doesn't count; Enter counts 1); "today" is the audit's measurement.
 */

export type QuickAddKind = "expense" | "todo" | "reminder" | "event";
export type BarTab = "home" | "money" | "planning" | "more";
export type SidebarItem = "home" | "expenses" | "investments" | "netWorth" | "reminders" | "todos" | "calendar" | "settings";
export type TapCount = { task: string; today: string; here: string; target?: string };

export type Mockup = {
  id: string;
  title: string;
  tab: BarTab;
  sidebar: SidebarItem;
  /** The quick-add sheet opens on this form when the page loads. */
  quickAdd?: QuickAddKind;
  taps: TapCount[];
};

export const MOCKUPS = [
  {
    id: "home",
    title: "Home",
    tab: "home",
    sidebar: "home",
    taps: [
      { task: "Mark a reminder done", today: "3–4", here: "Done: 1", target: "1" },
      { task: "Snooze a reminder", today: "4", here: "Snooze → choice: 2", target: "2" },
      { task: "See this month's spending", today: "0", here: "0", target: "0" },
      { task: "Add an expense", today: "2–6", here: "+ → Save: 2", target: "2" },
    ],
  },
  {
    id: "quick-add-expense",
    title: "Quick add: Expense",
    tab: "home",
    sidebar: "home",
    quickAdd: "expense",
    taps: [
      { task: "Add an expense", today: "6 (7 from Expenses)", here: "+ → Save: 2, category from the suggestion", target: "2" },
      { task: "Change the guessed category", today: "2 (select)", here: "category chip → pick: 2", target: "—" },
      { task: "Add another", today: "the whole form again", here: "Save + new: 1 more each", target: "—" },
    ],
  },
  {
    id: "quick-add-todo",
    title: "Quick add: To-do",
    tab: "home",
    sidebar: "home",
    quickAdd: "todo",
    taps: [{ task: "Add a to-do", today: "4", here: "+ → To-do → Enter: 3 (2 if the sheet remembers To-do)", target: "2" }],
  },
  {
    id: "quick-add-reminder",
    title: "Quick add: Reminder",
    tab: "home",
    sidebar: "home",
    quickAdd: "reminder",
    taps: [{ task: "Add a reminder", today: "4–6", here: "+ → Reminder → Save: 3 (tomorrow 9:00)", target: "3" }],
  },
  {
    id: "quick-add-event",
    title: "Quick add: Event",
    tab: "home",
    sidebar: "home",
    quickAdd: "event",
    taps: [{ task: "Add an event", today: "4 + 2–4 for date and time", here: "+ → Event → day chip → day → Save: 5", target: "—" }],
  },
  {
    id: "money-expenses",
    title: "Money: Expenses",
    tab: "money",
    sidebar: "expenses",
    taps: [
      { task: "Delete an expense", today: "3 (with a confirm)", here: "Money → swipe left: 2, then undo", target: "1 on the list" },
      { task: "Change the month", today: "1", here: "‹ or ›: 1", target: "—" },
      { task: "Switch to the family view", today: "1 (two rows of chips)", here: "Me ▾ → Everyone: 2", target: "—" },
      { task: "Export", today: "1", here: "⋯ → Export: 2", target: "—" },
    ],
  },
  {
    id: "planning-reminders",
    title: "Planning: Reminders",
    tab: "planning",
    sidebar: "reminders",
    taps: [
      { task: "Mark a reminder done", today: "3–4", here: "Planning → swipe right: 2 (Home: 1)", target: "1 on Home" },
      { task: "Snooze a reminder", today: "4", here: "Planning → swipe left → choice: 3", target: "2 on the list" },
    ],
  },
  {
    id: "planning-todos",
    title: "Planning: To-dos",
    tab: "planning",
    sidebar: "todos",
    taps: [
      { task: "Add a to-do", today: "4", here: "Planning → To-dos → Add a card → Enter: 4, or + → To-do → Enter: 3", target: "2" },
      { task: "Delete a to-do", today: "5", here: "Planning → To-dos → swipe left: 3, then undo", target: "1 on the board" },
      { task: "Move a to-do", today: "4", here: "Planning → To-dos → ⋯ → column: 4, or long-press and drag", target: "—" },
    ],
  },
  {
    id: "more",
    title: "More",
    tab: "more",
    sidebar: "settings",
    taps: [
      { task: "Change a setting", today: "4 + a swipe; 5 with a Save", here: "More → row → change: 3", target: "4" },
      { task: "Invite someone", today: "4 + a swipe", here: "More → Invite someone: 2", target: "—" },
    ],
  },
  {
    id: "settings-account",
    title: "Settings: Account",
    tab: "more",
    sidebar: "settings",
    taps: [
      { task: "Change the currency", today: "5", here: "More → Account → Currency → pick → Save: 5", target: "—" },
      { task: "Change your password", today: "not possible", here: "More → Account → Change password: 3 + the form", target: "—" },
    ],
  },
  {
    id: "settings-notifications",
    title: "Settings: Notifications",
    tab: "more",
    sidebar: "settings",
    taps: [
      { task: "Turn reminder notifications off", today: "4 + a swipe", here: "More → Notifications → switch: 3", target: "4" },
      { task: "Send a test", today: "4 + a swipe", here: "More → Notifications → Send a test: 3", target: "—" },
    ],
  },
  {
    id: "settings-family",
    title: "Settings: Family",
    tab: "more",
    sidebar: "settings",
    taps: [
      { task: "Invite someone", today: "4 + a swipe (Manage family)", here: "More → Family → Invite: 3", target: "—" },
      { task: "Change a kid's permissions", today: "5 + a swipe", here: "More → Family → ⋯ → Permissions → switch: 5", target: "—" },
    ],
  },
] as const satisfies readonly Mockup[];

export type MockupId = (typeof MOCKUPS)[number]["id"];

export function mockupById(id: string): Mockup | undefined {
  return MOCKUPS.find((mockup) => mockup.id === id);
}

export const mockupHref = (id: MockupId) => `/dev/preview/mockups/${id}`;
