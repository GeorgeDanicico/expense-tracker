import type * as LogModule from "@/lib/log";

/** A line the shared logger wrote, parsed. */
export type LoggedLine = { time: string; level: string; event: string } & Record<string, unknown>;

/**
 * `@/lib/log` with its process-wide `log` swapped for one that keeps every line, debug included, in
 * `lines`. For a test that checks what code using `log` writes:
 *
 * ```ts
 * const logged = vi.hoisted(() => [] as string[]);
 * vi.mock("@/lib/log", async (importOriginal) => (await import("@/test/log-lines")).memoryLogModule(await importOriginal(), logged));
 * ```
 *
 * The rest of the module is the real one, so the request context still adds `requestId`.
 */
export function memoryLogModule(actual: typeof LogModule, lines: string[]): typeof LogModule {
  const keep = (line: string) => void lines.push(line);
  return { ...actual, log: actual.createLogger({ level: "debug", out: keep, err: keep }) };
}

/** The lines kept by {@link memoryLogModule}, parsed; with `event`, only those of that event. */
export function loggedLines(lines: readonly string[], event?: string): LoggedLine[] {
  const parsed = lines.map((line) => JSON.parse(line) as LoggedLine);
  return event === undefined ? parsed : parsed.filter((line) => line.event === event);
}
