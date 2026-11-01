import { afterEach, describe, expect, it, vi } from "vitest";

import { register } from "@/instrumentation";

const SECRET = "sb_publishable_DO_NOT_PRINT_ME";

/** Makes `process.exit` throw so the test sees the exit and the code after it never runs. */
function stubExit() {
  return vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit ${code}`);
  }) as never);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("register", () => {
  it("stops the web app with a message naming the missing variable and no value", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", SECRET);
    const exit = stubExit();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(register()).rejects.toThrow("exit 1");

    expect(exit).toHaveBeenCalledWith(1);
    const message = String(error.mock.calls[0]?.[0]);
    expect(message).toContain("SUPABASE_URL is empty");
    expect(message).not.toContain("SUPABASE_PUBLISHABLE_KEY");
    expect(message).not.toContain(SECRET);
  });

  it("starts, with one line about the optional features that are off, when the required ones are set", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", SECRET);
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    const exit = stubExit();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await register();

    expect(exit).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]?.[0])).toContain("SUPABASE_SECRET_KEY");
    expect(String(info.mock.calls[0]?.[0])).not.toContain(SECRET);
  });

  it("checks nothing outside the Node.js runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.stubEnv("SUPABASE_URL", "");
    const exit = stubExit();

    await register();

    expect(exit).not.toHaveBeenCalled();
  });
});
