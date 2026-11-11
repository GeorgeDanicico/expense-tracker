import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs scripts/deploy.sh against a fake `docker` that writes down every call and answers "yes" to
// everything, so no container, image or network is touched. It checks the heap limit
// (NODE_OPTIONS=--max-old-space-size, PF12): what each container gets, and which inputs are refused
// before anything is built or stopped.

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "deploy.sh");

let dir;
let calls;
let envFile;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "deploy-test-"));
  calls = join(dir, "calls.txt");
  envFile = join(dir, "env");
  writeFileSync(envFile, "SUPABASE_URL=http://127.0.0.1:9\n");
  // A container that does not exist yet (so nothing is renamed or stopped) but is running and
  // healthy once started: `inspect` with a --format answers, plain `inspect` fails.
  writeFileSync(
    join(dir, "docker"),
    [
      "#!/usr/bin/env bash",
      'echo "$*" >> "$CALLS"',
      'if [[ "$1 $2" == "container inspect" ]]; then',
      '  [[ "$*" == *RestartCount* ]] && { echo "true 0"; exit 0; }',
      '  [[ "$*" == *State.Running* ]] && { echo true; exit 0; }',
      "  exit 1",
      "fi",
      "exit 0",
    ].join("\n"),
  );
  chmodSync(join(dir, "docker"), 0o755);
  // The script waits for the worker and between health checks; the tests don't need to.
  writeFileSync(join(dir, "sleep"), "#!/usr/bin/env bash\n");
  chmodSync(join(dir, "sleep"), 0o755);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const deploy = (env = {}) => {
  writeFileSync(calls, "");
  const result = spawnSync("bash", [SCRIPT], {
    encoding: "utf8",
    env: { PATH: `${dir}:${process.env.PATH}`, CALLS: calls, DEPLOY_ENV_FILE: envFile, LOG_DRIVER: "json-file", WORKER_STARTUP_SECONDS: "1", HEALTHCHECK_INTERVAL_SECONDS: "1", ...env },
  });
  const lines = readFileSync(calls, "utf8").split("\n");
  // The two `docker run --detach` calls: the web container, then the worker.
  const started = lines.filter((line) => line.startsWith("run ") && line.includes(" --detach "));
  const web = started.find((line) => !line.includes("node worker.js"));
  const worker = started.find((line) => line.includes("node worker.js"));
  return { ...result, lines, web, worker };
};

const heapFlag = (line) => line?.match(/NODE_OPTIONS=(\S+)/)?.[1];

describe("scripts/deploy.sh heap limit", () => {
  it("leaves the web container on Node's own limit and gives the worker 60% of its memory limit", () => {
    const { status, web, worker } = deploy();
    expect(status).toBe(0);
    expect(web).toBeDefined();
    expect(worker).toBeDefined();
    expect(heapFlag(web)).toBeUndefined();
    expect(heapFlag(worker)).toBe("--max-old-space-size=153");
  });

  it("follows the memory limit in any unit, and takes WEB_HEAP_MB and WORKER_HEAP_MB as they are", () => {
    const sized = deploy({ WORKER_MEMORY_LIMIT: "1g" });
    expect(heapFlag(sized.worker)).toBe("--max-old-space-size=614");
    const small = deploy({ WORKER_MEMORY_LIMIT: "131072k" });
    expect(heapFlag(small.worker)).toBe("--max-old-space-size=76");
    const set = deploy({ WEB_HEAP_MB: "400", WORKER_HEAP_MB: "120" });
    expect(heapFlag(set.web)).toBe("--max-old-space-size=400");
    expect(heapFlag(set.worker)).toBe("--max-old-space-size=120");
  });

  it.each([
    [{ WEB_HEAP_MB: "abc" }, "WEB_HEAP_MB must be a positive integer"],
    [{ WEB_HEAP_MB: "0" }, "WEB_HEAP_MB must be a positive integer"],
    [{ WORKER_HEAP_MB: "-5" }, "WORKER_HEAP_MB must be a positive integer"],
    [{ WEB_HEAP_MB: "768" }, "WEB_HEAP_MB must be smaller than WEB_MEMORY_LIMIT (768m)"],
    [{ WORKER_HEAP_MB: "300" }, "WORKER_HEAP_MB must be smaller than WORKER_MEMORY_LIMIT (256m)"],
    [{ WEB_MEMORY_LIMIT: "512m", WEB_HEAP_MB: "512" }, "WEB_HEAP_MB must be smaller than WEB_MEMORY_LIMIT (512m)"],
  ])("refuses %j before it builds or stops anything", (env, message) => {
    const { status, stderr, lines } = deploy(env);
    expect(status).toBe(1);
    expect(stderr).toContain(message);
    expect(lines.some((line) => /^(build|run|stop|rename|rm) /.test(line))).toBe(false);
  });
});
