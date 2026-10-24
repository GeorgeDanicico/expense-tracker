/** The board's three fixed columns, in display order. */
export const TODO_STATUSES = ["todo", "in_progress", "done"] as const;

export type TodoStatus = (typeof TODO_STATUSES)[number];

export const TODO_STATUS_LABELS: Record<TodoStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

/** The member a card is assigned to, with the display fields the API joins from the family. */
export type TodoAssignee = {
  memberId: string;
  /** The member's display name; null if none exists. */
  name: string | null;
  /** The palette slot (1..8) chosen for the member, or null for an automatic colour. */
  color: number | null;
  /** The member's picture as an `/api/avatars/…` URL, or null without one. */
  avatarUrl: string | null;
};

/** A card on the family to-do board, as the API returns it. */
export type Todo = {
  id: string;
  title: string;
  notes: string;
  status: TodoStatus;
  /** Fractional-index key ordering the card within its column; compare with `<`, never `localeCompare`. */
  position: string;
  assignee: TodoAssignee | null;
  /** A plain `YYYY-MM-DD` date on the Europe/Bucharest calendar, or null. */
  dueDate: string | null;
  /** The user who added the card; null once that user is deleted. */
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** When the card entered Done; null while it isn't in Done. */
  completedAt: string | null;
  /** The user who moved the card into Done; null while it isn't in Done. */
  completedBy: string | null;
};
