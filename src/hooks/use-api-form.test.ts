import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/client";
import { apiFormError, IDLE_API_FORM_STATE, runApiSubmit, type ApiFormState } from "./use-api-form";

function harness() {
  const inFlight = { current: false };
  let state: ApiFormState = IDLE_API_FORM_STATE;
  const setState = (update: (current: ApiFormState) => ApiFormState) => {
    state = update(state);
  };
  return {
    inFlight,
    get state() {
      return state;
    },
    run: (fn: () => Promise<void>, fallback = "Fallback.", action?: string) =>
      runApiSubmit(inFlight, setState, fn, { fallback, action }),
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("apiFormError", () => {
  it("keeps an ApiError's message and field errors", () => {
    const error = new ApiError("Check the highlighted fields.", 400, { amount: ["Too large."] });
    expect(apiFormError(error, "Fallback.")).toEqual({
      error: "Check the highlighted fields.",
      fieldErrors: { amount: ["Too large."] },
    });
  });

  it("uses a plain Error's message without field errors", () => {
    expect(apiFormError(new Error("Boom."), "Fallback.")).toEqual({ error: "Boom.", fieldErrors: undefined });
  });

  it("falls back for values that are not errors", () => {
    expect(apiFormError("nope", "Fallback.")).toEqual({ error: "Fallback.", fieldErrors: undefined });
  });
});

describe("runApiSubmit", () => {
  it("is pending while the submission runs and idle after success", async () => {
    const form = harness();
    const request = deferred();
    const running = form.run(() => request.promise);
    expect(form.state).toEqual({ pendingAction: "submit", error: "", fieldErrors: undefined });
    request.resolve();
    await running;
    expect(form.state).toEqual({ pendingAction: null, error: "", fieldErrors: undefined });
  });

  it("records the error and field errors when the submission fails", async () => {
    const form = harness();
    await form.run(async () => {
      throw new ApiError("Invalid.", 400, { name: ["Required."] });
    });
    expect(form.state).toEqual({ pendingAction: null, error: "Invalid.", fieldErrors: { name: ["Required."] } });
  });

  it("uses the per-call fallback message", async () => {
    const form = harness();
    await form.run(() => Promise.reject(42), "The item could not be archived.");
    expect(form.state.error).toBe("The item could not be archived.");
  });

  it("clears the previous error when a new submission starts", async () => {
    const form = harness();
    await form.run(() => Promise.reject(new ApiError("Invalid.", 400, { name: ["Required."] })));
    const request = deferred();
    const running = form.run(() => request.promise);
    expect(form.state.error).toBe("");
    expect(form.state.fieldErrors).toBeUndefined();
    request.resolve();
    await running;
  });

  it("ignores a second submission while one is in flight", async () => {
    const form = harness();
    const request = deferred();
    let calls = 0;
    const first = form.run(() => {
      calls += 1;
      return request.promise;
    });
    await form.run(async () => {
      calls += 1;
    });
    expect(calls).toBe(1);
    request.resolve();
    await first;
    await form.run(async () => {
      calls += 1;
    });
    expect(calls).toBe(2);
  });

  it("releases the guard after a failure", async () => {
    const form = harness();
    await form.run(() => Promise.reject(new Error("Boom.")));
    expect(form.inFlight.current).toBe(false);
  });

  it("reports which action is pending", async () => {
    const form = harness();
    const request = deferred();
    const running = form.run(() => request.promise, "Fallback.", "archive");
    expect(form.state.pendingAction).toBe("archive");
    request.resolve();
    await running;
    expect(form.state.pendingAction).toBeNull();
  });
});
