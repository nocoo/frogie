export interface BudgetResult {
  budgets: {
    id: string;
    demand: number;
    remaining: number;
    withinBudget: boolean;
  }[];
}

export function calculate(input: unknown): BudgetResult;
export function run(input: string): string;
export function main(): number;
