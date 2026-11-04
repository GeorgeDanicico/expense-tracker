import type { ExpenseCategory } from "@/lib/expenses/categories";

/**
 * Made-up data for U3's mockups, from the signed-off HTML mockup (a family of four, a Wednesday in
 * November). Static on purpose: the mockups call no API and save nothing.
 */

export const MOCK_DATE = "Wednesday, 4 November";
export const MOCK_CURRENCY = "EUR";

export type MockMember = { id: string; name: string; slot: number; role: "Parent" | "Kid" };
export const MOCK_MEMBERS: MockMember[] = [
  { id: "ana", name: "Ana", slot: 1, role: "Parent" },
  { id: "mihai", name: "Mihai", slot: 2, role: "Parent" },
  { id: "ioana", name: "Ioana", slot: 3, role: "Kid" },
  { id: "radu", name: "Radu", slot: 4, role: "Kid" },
];
export const MOCK_ME = { fullName: "Ana Popescu", username: "ana", email: "ana@example.com", family: "The Popescus", member: MOCK_MEMBERS[0] };
export const memberById = (id: string) => MOCK_MEMBERS.find((member) => member.id === id) ?? MOCK_MEMBERS[0];

export const MOCK_MONTH = {
  label: "November",
  previous: "October",
  /** What October cost in all; this month's total is the sum of the expenses below. */
  previousTotal: 1155.7,
  /** Against the same four days of October. */
  changePercent: -18,
};

export type MockExpense = {
  id: string;
  description: string;
  category: ExpenseCategory;
  amount: number;
  member: string;
  /** The day it belongs to, as the list groups it. */
  day: string;
};

/** November so far (today is Wednesday 4). */
export const MOCK_EXPENSES: MockExpense[] = [
  { id: "e1", description: "Weekly groceries", category: "groceries", amount: 86.4, member: "ana", day: "Yesterday" },
  { id: "e2", description: "Metro card", category: "transport", amount: 25, member: "mihai", day: "Yesterday" },
  { id: "e3", description: "Rent", category: "housing", amount: 650, member: "ana", day: "Mon 2" },
  { id: "e4", description: "Electricity", category: "utilities", amount: 74.15, member: "mihai", day: "Mon 2" },
  { id: "e5", description: "Cinema", category: "entertainment", amount: 32, member: "ana", day: "Sun 1" },
  { id: "e6", description: "Pharmacy", category: "health", amount: 18.9, member: "ana", day: "Sun 1" },
  { id: "e7", description: "Fuel", category: "car", amount: 61.2, member: "mihai", day: "Sun 1" },
];

export const MOCK_EXPENSE_TABS = ["All", "Holiday in Crete", "House repairs"];

/** Suggestions for "Coff": your own past descriptions with their most used category. */
export const MOCK_SUGGESTIONS: { description: string; category: ExpenseCategory }[] = [
  { description: "Coffee", category: "entertainment" },
  { description: "Coffee beans", category: "groceries" },
  { description: "Coffee machine", category: "shopping" },
];

export type MockReminder = {
  id: string;
  title: string;
  when: string;
  overdue?: boolean;
  repeat?: string;
  kind: "bill" | "appointment" | "car" | "gift" | "school";
  group: "Today" | "Upcoming" | "Done";
};

export const MOCK_REMINDERS: MockReminder[] = [
  { id: "r1", title: "Pay the electricity bill", when: "Overdue · yesterday", overdue: true, kind: "bill", group: "Today" },
  { id: "r2", title: "Dentist for Ioana", when: "Today · 17:30", kind: "appointment", group: "Today" },
  { id: "r3", title: "Renew car insurance", when: "Thu 5 · 9:00", repeat: "Yearly", kind: "car", group: "Upcoming" },
  { id: "r4", title: "Grandma's birthday present", when: "Fri 6 · 18:00", kind: "gift", group: "Upcoming" },
  { id: "r5", title: "School trip money", when: "Mon 9 · 8:00", kind: "school", group: "Upcoming" },
  { id: "r6", title: "Water the plants", when: "Done this morning", repeat: "Every 3 days", kind: "appointment", group: "Done" },
];

export type MockTodoColumn = "todo" | "doing" | "done";
export type MockTodo = { id: string; title: string; column: MockTodoColumn; assignee?: string; due?: string; overdue?: boolean };

export const MOCK_TODO_COLUMNS: { value: MockTodoColumn; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "doing", label: "Doing" },
  { value: "done", label: "Done" },
];

export const MOCK_TODOS: MockTodo[] = [
  { id: "t1", title: "Book the car service", column: "todo", assignee: "ana", due: "Fri 6" },
  { id: "t2", title: "Buy printer ink", column: "todo", assignee: "mihai" },
  { id: "t3", title: "Fix the bathroom tap", column: "todo", assignee: "mihai", due: "Yesterday", overdue: true },
  { id: "t4", title: "Sign Ioana's school form", column: "doing", assignee: "ana", due: "Today" },
  { id: "t5", title: "Plan the Crete holiday", column: "doing" },
  { id: "t6", title: "Return the library books", column: "done", assignee: "radu" },
  { id: "t7", title: "Winter tyres", column: "done", assignee: "mihai" },
];

export const MOCK_EVENTS = [
  { id: "ev1", title: "Ioana's dentist", when: "Today · 17:30", who: ["ana", "ioana"] },
  { id: "ev2", title: "Parents' evening", when: "Thu 5 · 18:00", who: ["ana", "mihai"] },
  { id: "ev3", title: "Grandma's birthday", when: "Sat 7 · all day", who: ["ana", "mihai", "ioana", "radu"] },
];

export const MOCK_SNOOZE_CHOICES = ["For an hour", "Until this evening, 18:00", "Until tomorrow, 9:00", "Choose a time…"];
