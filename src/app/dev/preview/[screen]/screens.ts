export const PREVIEW_SCREENS = ["dashboard", "expenses", "investments", "net-worth", "settings"] as const;
export type PreviewScreen = (typeof PREVIEW_SCREENS)[number];

export function isPreviewScreen(value: string): value is PreviewScreen {
  return (PREVIEW_SCREENS as readonly string[]).includes(value);
}
