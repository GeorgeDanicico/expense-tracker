"use client";

import { TodoBoardScreen } from "@/components/todos/todo-board-screen";
import { StreamedSection } from "@/components/ui/streamed-section";
import { TodosSkeleton } from "@/components/ui/skeletons";
import { useDocumentTitle } from "@/hooks/use-document-title";

/** The To-dos page's body. The board streams in as the server's data arrives (the filters live in the URL, and `useSearchParams` needs a boundary too). */
export function TodosClient() {
  useDocumentTitle("To-dos");
  return (
    <StreamedSection fallback={<TodosSkeleton />}>
      <TodoBoardScreen />
    </StreamedSection>
  );
}
