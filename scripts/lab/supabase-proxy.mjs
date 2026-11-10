#!/usr/bin/env node
// The lab's stand-in for the internet between the app server and Supabase (docs/lab.md).
//
//   node scripts/lab/supabase-proxy.mjs --port 54400 --target http://127.0.0.1:54321 --delay-ms 40 --log .lab/supabase-calls.jsonl
//
// The lab app's SUPABASE_URL points here instead of at the local stack. Every request is held for
// half the delay on the way in and half on the way back (when the response headers arrive), so each
// call costs one extra round trip of `--delay-ms`. That is the cheapest a call to a hosted project
// can be: it leaves out new TCP and TLS connections and bandwidth, so a delayed run is a lower bound
// on the network cost, not a copy of production.
//
// It also writes one line per call to --log: the time, the method, which API (`auth`, `rest`,
// `rpc`, `storage`), the path without its query string, the status and the milliseconds. Never a
// header, a query string or a body: those carry keys, tokens and data. The measuring script counts
// Auth calls from this file, which is the only place the proxy's own Auth call (src/proxy.ts) shows.
//
// Both ends must be on this machine: it refuses anything else, like scripts/lab/guard.mjs.

import { appendFileSync } from "node:fs";
import http from "node:http";
import { pathToFileURL } from "node:url";

import { loopbackProblem } from "./guard.mjs";

/** `auth`, `rest`, `rpc` or `storage` and a short name, from a Supabase path (no query string). */
export function classifyCall(path) {
  const match = /^\/(auth|rest|storage)\/v1(\/[^?]*)?/.exec(path);
  if (!match) return { api: "other", name: path.split("?")[0] };
  const [, api, rest = "/"] = match;
  if (api === "rest" && rest.startsWith("/rpc/")) return { api: "rpc", name: rest.slice("/rpc/".length) };
  if (api === "rest") return { api: "rest", name: rest.split("/")[1] ?? "" };
  return { api, name: rest };
}

export function parseArgs(argv) {
  const options = { port: 54400, target: "http://127.0.0.1:54321", delayMs: 0, log: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--port") options.port = Number(value);
    else if (flag === "--target") options.target = value;
    else if (flag === "--delay-ms") options.delayMs = Number(value);
    else if (flag === "--log") options.log = value;
    else throw new Error(`unknown flag ${flag}`);
    index += 1;
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error("--port must be a port number");
  if (!Number.isFinite(options.delayMs) || options.delayMs < 0 || options.delayMs > 5000) throw new Error("--delay-ms must be 0 to 5000");
  const problem = loopbackProblem(options.target);
  if (problem) throw new Error(`--target ${problem}`);
  return options;
}

const wait = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

/** Starts the proxy; resolves with the server once it listens on 127.0.0.1. */
export function startProxy({ port, target, delayMs, log }) {
  const upstream = new URL(target);
  const agent = new http.Agent({ keepAlive: true });
  const half = delayMs / 2;

  const server = http.createServer(async (request, response) => {
    const started = Date.now();
    const path = request.url ?? "/";
    const call = classifyCall(path);
    // Read the body first so the delay is the same however the client sends it.
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    await wait(half);

    const headers = { ...request.headers, host: upstream.host };
    const forward = http.request(
      { hostname: upstream.hostname, port: upstream.port, path, method: request.method, headers, agent },
      async (reply) => {
        await wait(half);
        response.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(response);
        reply.on("end", () => {
          if (log) {
            const line = { t: started, method: request.method, api: call.api, name: call.name, status: reply.statusCode, ms: Date.now() - started };
            appendFileSync(log, `${JSON.stringify(line)}\n`);
          }
        });
      },
    );
    forward.on("error", () => {
      if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain" });
      response.end("lab proxy: the local Supabase stack did not answer");
    });
    forward.end(Buffer.concat(chunks));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    await startProxy(options);
    console.log(`lab proxy: 127.0.0.1:${options.port} -> ${options.target}, +${options.delayMs} ms per call`);
  } catch (error) {
    console.error(`lab proxy: ${error.message}`);
    process.exit(1);
  }
}
