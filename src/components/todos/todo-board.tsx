"use client";

import {
  closestCenter,
  closestCorners,
  DndContext,
  DragOverlay,
  getFirstCollision,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type PointerSensorOptions,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge, Box, Flex, Heading, Menu, Portal, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { ArrowRightLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { TodoCard } from "@/components/todos/todo-card";
import { TodoQuickAdd } from "@/components/todos/todo-quick-add";
import { IconButton } from "@/components/ui/icon-button";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  columnOf,
  columnsOf,
  isSamePlace,
  moveFor,
  movedAnnouncement,
  moveWithin,
  overAnnouncement,
  placeOf,
  type BoardColumns,
} from "@/lib/todos/board";
import { TODO_STATUSES, TODO_STATUS_LABELS, type Todo, type TodoStatus } from "@/lib/todos/types";
import type { TodoMove } from "@/lib/validation/todo";

/** Mouse and pen drags; touch goes through the long-press `TouchSensor` so the page still scrolls. */
class MouseOrPenSensor extends PointerSensor {
  static activators = [{
    eventName: "onPointerDown" as const,
    handler: (event: PointerEvent, options: PointerSensorOptions) =>
      event.pointerType !== "touch" && PointerSensor.activators[0].handler(event, options),
  }];
}

const SCREEN_READER_INSTRUCTIONS = {
  draggable: "Press Enter to open this card. To move it, press Space to pick it up, use the arrow keys "
    + "to move it within a column or to another column, then press Space or Enter to drop it, or "
    + "Escape to cancel.",
};

export type TodoBoardProps = {
  todos: readonly Todo[];
  /** Adds a card; a returned string is a notice quick add shows (the filters hide the new card). */
  onAdd: (title: string, status: TodoStatus) => Promise<string | void>;
  onMove: (id: string, move: TodoMove) => Promise<unknown>;
  onOpen: (todo: Todo) => void;
  /** Called with true when a drag starts and false when it ends, so polling can wait. */
  onDraggingChange?: (dragging: boolean) => void;
  /** Rendered under the Done column's cards: the "Show older" control. */
  doneFooter?: React.ReactNode;
  /**
   * Phones: one column at a time behind a segmented control, drags stay within it, and each card
   * gets a "Move to…" menu that puts it at the top of another column.
   */
  singleColumn?: boolean;
};

const SEGMENTS = TODO_STATUSES.map((status) => ({ value: status, label: TODO_STATUS_LABELS[status] }));

/** The card to focus once `id` leaves `column`: the one below it, else the one above, else none. */
export function focusAfterLeaving(column: readonly string[], id: string): string | null {
  const index = column.indexOf(id);
  if (index === -1) return null;
  return column[index + 1] ?? column[index - 1] ?? null;
}

/** The move "Move to…" sends: the top of `status`, anchored on nothing. */
export function moveToTop(status: TodoStatus): TodoMove {
  return { status, beforeId: null, afterId: null };
}

/**
 * The three columns with drag and drop: pointer, long-press touch and keyboard, with screen-reader
 * announcements. A drop is reported as the card's column and the visible cards above and below it.
 */
export function TodoBoard({ todos, onAdd, onMove, onOpen, onDraggingChange, doneFooter, singleColumn = false }: TodoBoardProps) {
  const byId = useMemo(() => new Map(todos.map((todo) => [todo.id, todo])), [todos]);
  const saved = useMemo(() => columnsOf(todos), [todos]);
  const [draft, setDraft] = useState<BoardColumns | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Read by the announcements and the collision check, which run outside React's render.
  const live = useRef<BoardColumns>(saved);
  // Where the card would land if dropped now, for "is in … position n of m" while dragging.
  const projected = useRef<BoardColumns>(saved);
  const justDragged = useRef(false);
  const columns = draft ?? saved;
  const [shown, setShown] = useState<TodoStatus>("todo");
  const [moved, setMoved] = useState("");
  // After "Move to…" the card leaves the shown column: focus goes to the card below it (or above,
  // when it was last), else the column's "Add a card", never the page body.
  const single = useRef<HTMLDivElement>(null);
  const focusAfterMove = useRef<{ movedId: string; nextId: string | null } | null>(null);

  useEffect(() => {
    const pending = focusAfterMove.current;
    const container = single.current;
    if (!pending || !container || columns[shown].includes(pending.movedId)) return;
    focusAfterMove.current = null;
    const next = pending.nextId
      ? container.querySelector<HTMLElement>(`[data-todo-id="${globalThis.CSS.escape(pending.nextId)}"]`)
      : null;
    (next ?? container.querySelector<HTMLElement>("section button"))?.focus();
  }, [columns, shown]);

  const sensors = useSensors(
    useSensor(MouseOrPenSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    }),
  );

  const titleOf = (id: UniqueIdentifier) => byId.get(String(id))?.title ?? "The card";

  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const place = placeOf(live.current, String(active.id));
      return place
        ? `Picked up ${titleOf(active.id)} in ${place.label}, position ${place.position} of ${place.count}.`
        : `Picked up ${titleOf(active.id)}.`;
    },
    onDragOver: ({ active }) => overAnnouncement(titleOf(active.id), projected.current, String(active.id)),
    onDragEnd: ({ active, over }) => over
      ? movedAnnouncement(titleOf(active.id), live.current, String(active.id))
      : `${titleOf(active.id)} was dropped outside the board and went back.`,
    onDragCancel: ({ active }) => {
      const place = placeOf(saved, String(active.id));
      return `Cancelled. ${titleOf(active.id)} went back to ${place?.label ?? "its column"}.`;
    },
  };

  // Over a column with cards, aim at its nearest card so the drop lands between cards.
  const collisionDetection: CollisionDetection = (args) => {
    const pointer = pointerWithin(args);
    const hits = pointer.length > 0 ? pointer : rectIntersection(args);
    let overId = getFirstCollision(hits, "id");
    if (overId == null) return closestCorners(args);
    const status = (TODO_STATUSES as readonly UniqueIdentifier[]).includes(overId) ? overId as TodoStatus : null;
    if (status && live.current[status].length > 0) {
      const ids = live.current[status];
      overId = closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((container) => ids.includes(String(container.id))),
      })[0]?.id ?? overId;
    }
    return [{ id: overId }];
  };

  function setDragging(dragging: boolean) {
    onDraggingChange?.(dragging);
  }

  function handleDragStart({ active }: DragStartEvent) {
    setActiveId(String(active.id));
    setDraft(saved);
    live.current = saved;
    projected.current = saved;
    setDragging(true);
  }

  function handleDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    const current = live.current;
    const from = columnOf(current, String(active.id));
    const to = columnOf(current, String(over.id));
    if (!from || !to) return;
    // Within a column the sortable strategy animates the gap; the order is settled on drop.
    if (from === to) {
      projected.current = moveWithin(current, String(active.id), String(over.id));
      return;
    }
    const translated = active.rect.current.translated;
    const below = translated !== null && translated.top > over.rect.top + over.rect.height / 2;
    const next = moveWithin(current, String(active.id), String(over.id), below);
    live.current = next;
    projected.current = next;
    setDraft(next);
  }

  function finish() {
    setActiveId(null);
    setDraft(null);
    setDragging(false);
    justDragged.current = true;
    setTimeout(() => { justDragged.current = false; }, 0);
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    const id = String(active.id);
    if (!over) {
      live.current = saved;
      finish();
      return;
    }
    const final = moveWithin(live.current, id, String(over.id));
    live.current = final;
    const move = moveFor(final, id);
    finish();
    if (move && !isSamePlace(saved, id, move)) void onMove(id, move);
  }

  function handleDragCancel() {
    live.current = saved;
    finish();
  }

  const active = activeId ? byId.get(activeId) : undefined;

  function moveTo(todo: Todo, status: TodoStatus) {
    focusAfterMove.current = { movedId: todo.id, nextId: focusAfterLeaving(columns[todo.status], todo.id) };
    setMoved(`Moved ${todo.title} to the top of ${TODO_STATUS_LABELS[status]}.`);
    void onMove(todo.id, moveToTop(status));
  }

  const column = (status: TodoStatus) => (
    <TodoColumn
      key={status}
      status={status}
      todos={columns[status].map((id) => byId.get(id)).filter((todo): todo is Todo => Boolean(todo))}
      onAdd={onAdd}
      onOpen={(todo) => { if (!justDragged.current) onOpen(todo); }}
      onMoveTo={singleColumn ? moveTo : undefined}
      footer={status === "done" ? doneFooter : null}
    />
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      accessibility={{ announcements, screenReaderInstructions: SCREEN_READER_INSTRUCTIONS }}
    >
      {singleColumn ? (
        <Stack gap="3" ref={single}>
          <SegmentedControl items={SEGMENTS} value={shown} onValueChange={setShown} fullWidth aria-label="Column" />
          {column(shown)}
          <Text role="status" className="sr-only">{moved}</Text>
        </Stack>
      ) : (
        <SimpleGrid columns={{ base: 1, md: 3 }} gap="4" alignItems="start">
          {TODO_STATUSES.map(column)}
        </SimpleGrid>
      )}
      <DragOverlay>
        {active ? <TodoCard todo={active} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function TodoColumn({
  status,
  todos,
  onAdd,
  onOpen,
  onMoveTo,
  footer,
}: {
  status: TodoStatus;
  todos: Todo[];
  onAdd: (title: string, status: TodoStatus) => Promise<string | void>;
  onOpen: (todo: Todo) => void;
  onMoveTo?: (todo: Todo, status: TodoStatus) => void;
  footer?: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const headingId = `todo-column-${status}`;
  const ids = todos.map((todo) => todo.id);

  return (
    <Box
      as="section"
      aria-labelledby={headingId}
      bg="bg.subtle"
      borderWidth="1px"
      borderColor={isOver ? "border.strong" : "border"}
      borderRadius="l3"
      p="3"
      minW="0"
    >
      <Flex align="center" justify="space-between" mb="2" px="1">
        <Heading as="h2" id={headingId} textStyle="sectionTitle">
          {TODO_STATUS_LABELS[status]}
        </Heading>
        <Badge variant="subtle" colorPalette="neutral" aria-label={`${todos.length} ${todos.length === 1 ? "card" : "cards"}`}>
          {todos.length}
        </Badge>
      </Flex>
      <TodoQuickAdd status={status} onAdd={onAdd} />
      <SortableContext id={status} items={ids} strategy={verticalListSortingStrategy}>
        <Stack ref={setNodeRef} as="ul" gap="2" mt="2" minH="16" listStyleType="none" aria-labelledby={headingId}>
          {todos.map((todo) => (
            <SortableTodoCard key={todo.id} todo={todo} onOpen={onOpen} onMoveTo={onMoveTo} />
          ))}
          {todos.length === 0 ? (
            <Text as="li" textStyle="caption" textAlign="center" py="4" borderWidth="1px" borderStyle="dashed" borderColor="border" borderRadius="l3">
              {status === "done" ? "Nothing done yet." : "No cards. Drag one here or add one."}
            </Text>
          ) : null}
        </Stack>
      </SortableContext>
      {footer}
    </Box>
  );
}

function SortableTodoCard({
  todo,
  onOpen,
  onMoveTo,
}: {
  todo: Todo;
  onOpen: (todo: Todo) => void;
  onMoveTo?: (todo: Todo, status: TodoStatus) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: todo.id });

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" && !isDragging) {
      event.preventDefault();
      onOpen(todo);
      return;
    }
    listeners?.onKeyDown?.(event);
  }

  return (
    <Box as="li" position="relative">
      <TodoCard
        ref={setNodeRef}
        todo={todo}
        data-todo-id={todo.id}
        placeholder={isDragging}
        reserveCorner={Boolean(onMoveTo)}
        style={{ transform: CSS.Translate.toString(transform), transition }}
        {...attributes}
        aria-roledescription="draggable card"
        {...listeners}
        onKeyDown={handleKeyDown}
        onClick={() => onOpen(todo)}
      />
      {onMoveTo && !isDragging ? <MoveToMenu todo={todo} onMoveTo={onMoveTo} /> : null}
    </Box>
  );
}

/** "Move to…" on a phone card: the other columns, each putting the card at its top. */
function MoveToMenu({ todo, onMoveTo }: { todo: Todo; onMoveTo: (todo: Todo, status: TodoStatus) => void }) {
  const targets = TODO_STATUSES.filter((status) => status !== todo.status);
  return (
    <Box position="absolute" top="1.5" insetEnd="1.5">
      <Menu.Root
        positioning={{ placement: "bottom-end" }}
        onSelect={({ value }) => onMoveTo(todo, value as TodoStatus)}
      >
        <Menu.Trigger asChild>
          <IconButton aria-label={`Move ${todo.title} to…`} size="xs">
            <ArrowRightLeft size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" />
          </IconButton>
        </Menu.Trigger>
        <Portal>
          <Menu.Positioner>
            <Menu.Content minW="44">
              <Menu.ItemGroup>
                <Menu.ItemGroupLabel>Move to</Menu.ItemGroupLabel>
                {targets.map((status) => (
                  <Menu.Item key={status} value={status}>
                    {TODO_STATUS_LABELS[status]}
                  </Menu.Item>
                ))}
              </Menu.ItemGroup>
            </Menu.Content>
          </Menu.Positioner>
        </Portal>
      </Menu.Root>
    </Box>
  );
}
