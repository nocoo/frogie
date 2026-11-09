import { describe, expect, it } from "vitest";
import { runL1GateSelftest } from "./l1-gate-selftest.js";

describe("l1 gate selftest", () => {
  it("rejects every unhealthy staged snapshot and accepts a healthy control", async () => {
    const outcomes = await runL1GateSelftest();
    expect(outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "healthy staged snapshot",
          expectedSuccess: true,
          status: 0,
        }),
      ]),
    );
    expect(
      outcomes
        .filter((probe) => !probe.expectedSuccess)
        .every((probe) => probe.status !== 0 || probe.signal !== null),
    ).toBe(true);
  }, 300_000);
});
