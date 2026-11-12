import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logged = vi.hoisted(() => [] as string[]);
const mocks = vi.hoisted(() => ({ headers: vi.fn(), cookies: vi.fn() }));
vi.mock("@/lib/log", async (importOriginal) => (await import("@/test/log-lines")).memoryLogModule(await importOriginal(), logged));
vi.mock("next/headers", () => ({ headers: mocks.headers, cookies: mocks.cookies }));

import { LONG_WRITE_TIMEOUT_MS, SUPABASE_TIMEOUT_MS } from "@/lib/log/traced-fetch";
import { createSupabaseAuthAdmin } from "@/lib/supabase/auth-admin";
import { supabaseAccountDataRepository as accountData } from "@/lib/supabase/repositories/account-data";
import { supabaseFamilyRepository as family } from "@/lib/supabase/repositories/family";
import { supabaseImportRepository as imports } from "@/lib/supabase/repositories/imports";

/**
 * The writes that must finish or fail as a whole, and the export's sections, get the long time limit
 * (`withLongTimeLimit`, 30 s) on the real supabase-js clients; everything else keeps 4 s. A client that
 * gives up doesn't stop PostgREST, so one of these could commit after the app said it failed.
 *
 * How it's seen: Supabase refuses every call at once (a 400), and the signal each call was given is
 * aborted when its limit runs out (the limit stays armed after the answer, for the body).
 */

const USER_ID = "6c3f4a8e-2b1d-4c5e-9f70-1a2b3c4d5e6f";
const signals: AbortSignal[] = [];
const fetchStub = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
  if (init?.signal) signals.push(init.signal);
  return new Response(JSON.stringify({ message: "refused", code: "XX000" }), { status: 400, headers: { "content-type": "application/json" } });
});

/** Runs `operation` (which fails against the refusing Supabase) and returns the limit its first call had. */
async function limitOf(operation: () => Promise<unknown>): Promise<"4 s" | "30 s" | "other"> {
  signals.length = 0;
  await operation().catch(() => undefined);
  const signal = signals[0];
  expect(signal).toBeDefined();
  await vi.advanceTimersByTimeAsync(SUPABASE_TIMEOUT_MS);
  if (signal.aborted) return "4 s";
  await vi.advanceTimersByTimeAsync(LONG_WRITE_TIMEOUT_MS - SUPABASE_TIMEOUT_MS);
  return signal.aborted ? "30 s" : "other";
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchStub);
  vi.stubEnv("SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "test-publishable");
  vi.stubEnv("SUPABASE_SECRET_KEY", ["test", "service", "key"].join("-"));
  mocks.headers.mockResolvedValue(new Headers());
  mocks.cookies.mockResolvedValue({ getAll: () => [], set: vi.fn() });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the long time limit", () => {
  it("is 30 s", () => {
    expect(LONG_WRITE_TIMEOUT_MS).toBe(30_000);
  });

  it.each([
    ["deleting your data (delete_my_data)", () => accountData.deleteMyData("DELETE")],
    ["deleting a kid's data (delete_managed_kid_data)", () => accountData.deleteManagedKidData(USER_ID, "Robin")],
    ["an export section (export_my_data)", async () => (await accountData.openExport()).section("expenses")],
    ["saving an import (create_import_batch)", () => imports.createBatch({} as never, [])],
    ["confirming an import (confirm_import_batch)", () => imports.confirm(USER_ID, [])],
    ["undoing an import (undo_import_batch)", () => imports.undo(USER_ID)],
    ["deleting an account's sign-in and picture (the admin API and Storage)", () => createSupabaseAuthAdmin().deleteUser(USER_ID)],
    ["creating a kid's sign-in (the admin API)", () => createSupabaseAuthAdmin().createUser({ email: "kid@example.test", password: "x", username: "kid", displayName: "Kid", managedByFamily: USER_ID, mustChangePassword: true })],
    ["adding the kid to the family (add_managed_kid)", () => family.addManagedKid(USER_ID, {} as never)],
  ])("covers %s", async (_name, operation) => {
    expect(await limitOf(operation)).toBe("30 s");
  });

  it.each([
    ["an import read", () => imports.getBatch(USER_ID)],
    ["discarding a draft", () => imports.discard(USER_ID)],
    ["setting a password (the admin API)", () => createSupabaseAuthAdmin().setPassword(USER_ID, "x")],
  ])("leaves %s at 4 s", async (_name, operation) => {
    expect(await limitOf(operation)).toBe("4 s");
  });
});
