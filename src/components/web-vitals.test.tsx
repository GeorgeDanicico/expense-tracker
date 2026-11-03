import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useReportWebVitals = vi.hoisted(() => vi.fn());

vi.mock("next/web-vitals", () => ({ useReportWebVitals }));

import { reportWebVital } from "@/lib/client-log";

import { WebVitals } from "./web-vitals";

beforeEach(() => useReportWebVitals.mockClear());

describe("WebVitals", () => {
  it("hands the same callback to Next on every render, so metrics aren't reported twice", () => {
    renderToStaticMarkup(<WebVitals />);
    renderToStaticMarkup(<WebVitals />);

    expect(useReportWebVitals).toHaveBeenCalledTimes(2);
    expect(useReportWebVitals.mock.calls[0][0]).toBe(reportWebVital);
    expect(useReportWebVitals.mock.calls[1][0]).toBe(reportWebVital);
  });

  it("renders nothing", () => {
    expect(renderToStaticMarkup(<WebVitals />)).toBe("");
  });
});
