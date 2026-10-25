import type { LogFields, WorkerLog } from "@/lib/notifications/worker";

type Write = (line: string) => void;

/**
 * A `WorkerLog` writing one JSON object per line: `{ time, level, event, ...fields }`. Info goes to
 * stdout and errors to stderr, which `docker logs` shows together.
 */
export function createJsonLog(
  { out = (line) => process.stdout.write(line), err = (line) => process.stderr.write(line), now = () => new Date() }:
  { out?: Write; err?: Write; now?: () => Date } = {},
): WorkerLog {
  const line = (level: "info" | "error", event: string, fields: LogFields = {}) =>
    `${JSON.stringify({ time: now().toISOString(), level, event, ...fields })}\n`;
  return {
    info: (event, fields) => out(line("info", event, fields)),
    error: (event, fields) => err(line("error", event, fields)),
  };
}
