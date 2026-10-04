import React from "react";
import { platform } from "@/platform/current";
import { loadReportedSpend } from "../services/usage-repository";

export const USAGE_BUDGET_STORAGE_KEY = "memorall.usage.monthlyBudget";

const isBudget = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * The monthly budget the user set (USD), and this month's reported spend so
 * far. The month is the calendar month, whatever range the page shows.
 */
export const useUsageBudget = (reloadKey: number) => {
	const [budget, setBudgetState] = React.useState<number | null>(null);
	const [spend, setSpend] = React.useState<number | null>(null);

	React.useEffect(() => {
		let cancelled = false;
		platform.persistentStore
			.get<number>(USAGE_BUDGET_STORAGE_KEY)
			.then((stored) => {
				if (!cancelled) setBudgetState(isBudget(stored) ? stored : null);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, []);

	React.useEffect(() => {
		let cancelled = false;
		const now = new Date();
		loadReportedSpend(new Date(now.getFullYear(), now.getMonth(), 1))
			.then((value) => {
				if (!cancelled) setSpend(value);
			})
			.catch(() => {
				if (!cancelled) setSpend(null);
			});
		return () => {
			cancelled = true;
		};
	}, [reloadKey]);

	const setBudget = React.useCallback((value: number | null) => {
		const next = isBudget(value) ? value : null;
		setBudgetState(next);
		const store = platform.persistentStore;
		void (
			next === null
				? store.remove(USAGE_BUDGET_STORAGE_KEY)
				: store.set(USAGE_BUDGET_STORAGE_KEY, next)
		).catch(() => undefined);
	}, []);

	return { budget, spend, setBudget };
};
