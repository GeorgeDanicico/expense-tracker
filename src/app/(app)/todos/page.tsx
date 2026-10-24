"use client";

import { Suspense } from "react";

import { TodoBoardScreen } from "@/components/todos/todo-board-screen";
import { DataLoading } from "@/components/ui/data-state";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function TodosPage() {
  useDocumentTitle("To-dos");
  // The filters live in the URL, and `useSearchParams` needs a boundary above it.
  return (
    <Suspense fallback={<DataLoading label="Loading the board…" />}>
      <TodoBoardScreen />
    </Suspense>
  );
}
