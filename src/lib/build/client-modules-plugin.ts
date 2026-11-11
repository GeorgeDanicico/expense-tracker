// A webpack plugin that writes which modules went into each browser chunk, for `scripts/server-only-check.mjs`.
//
//   BUNDLE_MODULES=1 npm run build        writes .next/diagnostics/client-modules.json
//
// Only the browser's compilation is recorded (the server's chunks never reach a browser). It is off unless
// `BUNDLE_MODULES` is set, so an ordinary build is untouched and needs no dependency (PF9).
//
// It lives under `src/` and not in `scripts/` because `next.config.ts` imports it and the Docker build
// context leaves `scripts/` out (`.dockerignore`).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type StatsModule = { name?: string; identifier?: string; size?: number; modules?: StatsModule[] };
type StatsChunk = { files?: string[]; modules?: StatsModule[] };
type Compiler = {
  hooks: { done: { tap: (name: string, callback: (stats: { toJson: (options: Record<string, unknown>) => { chunks?: StatsChunk[] } }) => void) => void } };
};

/** The file a module came from: without the loaders in front, the `./` and the "+ N modules" webpack adds to a merged one. */
function moduleName(name: string): string {
  return name.replace(/^.*!/, "").replace(/^\.\//, "").replace(/ \+ \d+ modules$/, "").replace(/\|.*$/, "");
}

export class ClientModulesPlugin {
  private readonly outputDirectory: string;

  constructor(outputDirectory: string) {
    this.outputDirectory = outputDirectory;
  }

  apply(compiler: Compiler) {
    compiler.hooks.done.tap("ClientModulesPlugin", (stats) => {
      const json = stats.toJson({
        all: false,
        chunks: true,
        chunkModules: true,
        nestedModules: true,
        modules: true,
        ids: true,
        cachedModules: true,
        orphanModules: true,
        dependentModules: true,
        chunkModulesSpace: Infinity,
        nestedModulesSpace: Infinity,
        modulesSpace: Infinity,
      });
      const chunks: Record<string, { name: string; size: number }[]> = {};
      for (const chunk of json.chunks ?? []) {
        const modules: { name: string; size: number }[] = [];
        const visit = (module: StatsModule) => {
          if (module.modules?.length) module.modules.forEach(visit);
          else if (module.name || module.identifier) modules.push({ name: moduleName(module.name || module.identifier || ""), size: module.size ?? 0 });
        };
        (chunk.modules ?? []).forEach(visit);
        for (const file of (chunk.files ?? []).filter((name) => name.endsWith(".js"))) chunks[file] = modules;
      }
      mkdirSync(this.outputDirectory, { recursive: true });
      writeFileSync(join(this.outputDirectory, "client-modules.json"), JSON.stringify({ chunks }));
    });
  }
}
