import { createLogger } from "@/lib/log";
import type { Write } from "@/lib/log";
import type { WorkerLog } from "@/lib/notifications/worker";

/**
 * A `WorkerLog` writing one JSON object per line, `{ time, level, event, ...fields }`, through the
 * shared logger (`src/lib/log`). `debug` and `info` go to stdout and `warn` and `error` to stderr,
 * which `docker logs` shows together; `LOG_LEVEL` sets the lowest level written.
 */
export function createJsonLog(
  { out, err, now }: { out?: Write; err?: Write; now?: () => Date } = {},
): WorkerLog {
  const { debug, info, warn, error } = createLogger({ out, err, now });
  return { debug, info, warn, error };
}
