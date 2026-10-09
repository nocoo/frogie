import { readFileSync } from "node:fs";

function invalid() {
  throw new Error("Invalid resource budget input");
}

function object(value, keys) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    invalid();
}

function identifier(value, seen) {
  if (
    typeof value !== "string" ||
    !/^[a-z][a-z0-9-]*$/.test(value) ||
    seen.has(value)
  )
    invalid();
  seen.add(value);
}

function amount(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    invalid();
  return value;
}

export function calculate(input) {
  object(input, ["budgets"]);
  if (!Array.isArray(input.budgets) || input.budgets.length === 0) invalid();
  const budgetIds = new Set();
  return {
    budgets: input.budgets.map((budget) => {
      object(budget, ["id", "available", "reserve", "allocations"]);
      identifier(budget.id, budgetIds);
      const available = amount(budget.available);
      const reserve = amount(budget.reserve);
      if (!Array.isArray(budget.allocations)) invalid();
      const allocationIds = new Set();
      const demand = budget.allocations.reduce((total, allocation) => {
        object(allocation, ["id", "amount"]);
        identifier(allocation.id, allocationIds);
        return total + amount(allocation.amount);
      }, 0);
      const remaining = available - reserve - demand;
      if (!Number.isFinite(demand) || !Number.isFinite(remaining)) invalid();
      return { id: budget.id, demand, remaining, withinBudget: remaining >= 0 };
    }),
  };
}

export function run(input) {
  return JSON.stringify(calculate(JSON.parse(input)));
}

export function main() {
  try {
    process.stdout.write(`${run(readFileSync(0, "utf8"))}\n`);
    return 0;
  } catch {
    process.stderr.write("Invalid resource budget input\n");
    return 1;
  }
}

if (import.meta.main) process.exitCode = main();
