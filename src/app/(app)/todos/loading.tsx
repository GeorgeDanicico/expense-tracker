import { TodosSkeleton } from "@/components/ui/skeletons";

/** Shown at once when you open To-dos, while the page loads; the page's own loading state is the same skeleton. */
export default function Loading() {
  return <TodosSkeleton />;
}
