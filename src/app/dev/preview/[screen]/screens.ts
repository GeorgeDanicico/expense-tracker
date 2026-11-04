export const PREVIEW_SCREENS = ["dashboard", "insights", "more", "expenses", "investments", "net-worth", "settings", "todos", "reminders", "calendar", "notifications", "ai-settings", "import", "change-password"] as const;
export type PreviewScreen = (typeof PREVIEW_SCREENS)[number];

export function isPreviewScreen(value: string): value is PreviewScreen {
  return (PREVIEW_SCREENS as readonly string[]).includes(value);
}
