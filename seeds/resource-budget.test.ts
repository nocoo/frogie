import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calculate,
  main,
  run,
} from "../squads/zeppelin/skills/resource-budget/scripts/calculate.mjs";

function budget() {
  return {
    id: "alpha",
    available: 10,
    reserve: 2,
    allocations: [{ id: "fuel", amount: 3 }],
  };
}

describe("resource-budget calculate", () => {
  it("calculates the documented formula without changing the input", () => {
    const input = { budgets: [budget()] };
    const before = structuredClone(input);
    expect(calculate(input)).toEqual({
      budgets: [{ id: "alpha", demand: 3, remaining: 5, withinBudget: true }],
    });
    expect(input).toEqual(before);
  });

  it.each([
    ["empty allocations", { ...budget(), allocations: [] }, 0, 8, true],
    [
      "zero budget",
      { ...budget(), available: 0, reserve: 0, allocations: [] },
      0,
      0,
      true,
    ],
    ["exact exhaustion", { ...budget(), available: 5 }, 3, 0, true],
    ["over budget", { ...budget(), available: 4 }, 3, -1, false],
    [
      "reserve exceeds available",
      { ...budget(), available: 1, allocations: [] },
      0,
      -1,
      false,
    ],
    [
      "sum and precision",
      {
        ...budget(),
        available: 1,
        reserve: 0.1,
        allocations: [
          { id: "fuel", amount: 0.1 },
          { id: "power", amount: 0.2 },
        ],
      },
      0.1 + 0.2,
      1 - 0.1 - (0.1 + 0.2),
      true,
    ],
  ] as const)("handles %s", (_name, input, demand, remaining, withinBudget) => {
    expect(calculate({ budgets: [input] })).toEqual({
      budgets: [{ id: "alpha", demand, remaining, withinBudget }],
    });
  });

  it("preserves budget order and allows allocation IDs to repeat across budgets", () => {
    expect(
      calculate({ budgets: [{ ...budget(), id: "beta" }, budget()] }),
    ).toEqual({
      budgets: [
        { id: "beta", demand: 3, remaining: 5, withinBudget: true },
        { id: "alpha", demand: 3, remaining: 5, withinBudget: true },
      ],
    });
  });

  it.each([
    ["null input", null],
    ["array input", []],
    ["missing budgets", {}],
    ["non-array budgets", { budgets: {} }],
    ["empty budgets", { budgets: [] }],
    ["unknown input field", { budgets: [budget()], extra: true }],
    ["null budget", { budgets: [null] }],
    ["unknown budget field", { budgets: [{ ...budget(), extra: true }] }],
    [
      "missing budget id",
      { budgets: [{ available: 10, reserve: 2, allocations: [] }] },
    ],
    [
      "missing available",
      { budgets: [{ id: "alpha", reserve: 2, allocations: [] }] },
    ],
    [
      "missing reserve",
      { budgets: [{ id: "alpha", available: 10, allocations: [] }] },
    ],
    [
      "missing allocations",
      { budgets: [{ id: "alpha", available: 10, reserve: 2 }] },
    ],
    ["non-array allocations", { budgets: [{ ...budget(), allocations: {} }] }],
    ["null allocation", { budgets: [{ ...budget(), allocations: [null] }] }],
    [
      "unknown allocation field",
      {
        budgets: [
          {
            ...budget(),
            allocations: [{ id: "fuel", amount: 3, extra: true }],
          },
        ],
      },
    ],
    [
      "missing allocation id",
      { budgets: [{ ...budget(), allocations: [{ amount: 3 }] }] },
    ],
    [
      "missing amount",
      { budgets: [{ ...budget(), allocations: [{ id: "fuel" }] }] },
    ],
    ["invalid budget id", { budgets: [{ ...budget(), id: "Alpha" }] }],
    ["non-string budget id", { budgets: [{ ...budget(), id: 1 }] }],
    [
      "invalid allocation id",
      {
        budgets: [
          { ...budget(), allocations: [{ id: "fuel/power", amount: 3 }] },
        ],
      },
    ],
    [
      "non-string allocation id",
      { budgets: [{ ...budget(), allocations: [{ id: 1, amount: 3 }] }] },
    ],
    ["duplicate budget id", { budgets: [budget(), budget()] }],
    [
      "duplicate allocation id",
      {
        budgets: [
          {
            ...budget(),
            allocations: [
              { id: "fuel", amount: 1 },
              { id: "fuel", amount: 2 },
            ],
          },
        ],
      },
    ],
    [
      "demand overflow",
      {
        budgets: [
          {
            ...budget(),
            available: Number.MAX_VALUE,
            reserve: 0,
            allocations: [
              { id: "fuel", amount: Number.MAX_VALUE },
              { id: "power", amount: Number.MAX_VALUE },
            ],
          },
        ],
      },
    ],
    [
      "remaining overflow",
      {
        budgets: [
          {
            ...budget(),
            available: 0,
            reserve: Number.MAX_VALUE,
            allocations: [{ id: "fuel", amount: Number.MAX_VALUE }],
          },
        ],
      },
    ],
  ])("rejects %s", (_name, input) => {
    expect(() => calculate(input)).toThrow(/invalid/i);
  });

  it.each(["available", "reserve", "amount"] as const)(
    "rejects invalid %s numbers",
    (field) => {
      for (const value of [
        -1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        "3",
        null,
      ]) {
        const input =
          field === "amount"
            ? {
                budgets: [
                  { ...budget(), allocations: [{ id: "fuel", amount: value }] },
                ],
              }
            : { budgets: [{ ...budget(), [field]: value }] };
        expect(() => calculate(input)).toThrow(/invalid/i);
      }
    },
  );
});

describe("resource-budget JSON entry", () => {
  it("returns one JSON result from a valid JSON input", () => {
    const output = run(JSON.stringify({ budgets: [budget()] }));
    expect(JSON.parse(output)).toEqual({
      budgets: [{ id: "alpha", demand: 3, remaining: 5, withinBudget: true }],
    });
  });

  it("rejects malformed JSON before calculating", () => {
    expect(() => run('{"budgets":')).toThrow(SyntaxError);
  });
});

describe("resource-budget Node CLI", () => {
  const script = fileURLToPath(
    new URL(
      "../squads/zeppelin/skills/resource-budget/scripts/calculate.mjs",
      import.meta.url,
    ),
  );

  it("reads stdin and prints a single JSON result with exit zero", () => {
    const result = spawnSync(process.execPath, [script], {
      input: JSON.stringify({ budgets: [budget()] }),
      encoding: "utf8",
      timeout: 3_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      budgets: [{ id: "alpha", demand: 3, remaining: 5, withinBudget: true }],
    });
  });

  it("rejects invalid stdin with a nonzero exit and stderr rather than output", () => {
    const result = spawnSync(process.execPath, [script], {
      input: '{"budgets":[]}',
      encoding: "utf8",
      timeout: 3_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/invalid/i);
  });
});

describe("resource-budget main in process", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    syncBuiltinESMExports();
  });

  it("reads stdin and writes the valid result without changing the process exit code", () => {
    const input = vi
      .spyOn(fs, "readFileSync")
      .mockReturnValue(JSON.stringify({ budgets: [budget()] }));
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    syncBuiltinESMExports();
    const exitCode = process.exitCode;
    expect(main()).toBe(0);
    expect(input).toHaveBeenCalledExactlyOnceWith(0, "utf8");
    expect(stdout).toHaveBeenCalledExactlyOnceWith(
      `${JSON.stringify({ budgets: [{ id: "alpha", demand: 3, remaining: 5, withinBudget: true }] })}\n`,
    );
    expect(stderr).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(exitCode);
  });

  it("returns failure and a bounded diagnostic for malformed JSON", () => {
    vi.spyOn(fs, "readFileSync").mockReturnValue('{"budgets":');
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    syncBuiltinESMExports();
    expect(main()).toBe(1);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledExactlyOnceWith(
      "Invalid resource budget input\n",
    );
  });

  it("returns failure without leaking an input read error", () => {
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("Private input failure");
    });
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    syncBuiltinESMExports();
    expect(main()).toBe(1);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledExactlyOnceWith(
      "Invalid resource budget input\n",
    );
  });
});
