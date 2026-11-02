/**
 * Keeps the shared logger's lines (`src/lib/log`) out of the test output: route tests run thousands
 * of requests, and each writes a `request` line that would bury vitest's own report. Only writes
 * that start like a log line (`{"time":`) are dropped; anything else is printed as usual.
 *
 * Tests that check lines give the logger their own writers, or spy on `process.stdout.write` and
 * `process.stderr.write`, which still sees every call. Set `LOG_IN_TESTS=1` to see the lines.
 */
if (!process.env.LOG_IN_TESTS) {
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream) as (...args: unknown[]) => boolean;
    stream.write = ((chunk: unknown, ...rest: unknown[]) =>
      typeof chunk === "string" && chunk.startsWith('{"time":') ? true : write(chunk, ...rest)) as typeof stream.write;
  }
}
