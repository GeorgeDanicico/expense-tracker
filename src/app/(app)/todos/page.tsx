"use client";

import { TodoBoardScreen } from "@/components/todos/todo-board-screen";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function TodosPage() {
  useDocumentTitle("To-dos");
  return <TodoBoardScreen />;
}
