import type { FlowRuntimeVars } from "../../runtime/runtime-context.js";

export interface PlanItem {
	id: string;
	description: string;
	checked: boolean;
	notes?: string;
}

export interface Plan {
	title: string;
	items: PlanItem[];
	createdAt: string;
	updatedAt: string;
}

const PLAN_RUNTIME_KEY = "planner.plan";

export const getPlan = (runtime?: FlowRuntimeVars): Plan | null =>
	runtime?.get<Plan>(PLAN_RUNTIME_KEY) ?? null;

export const setPlan = (
	runtime: FlowRuntimeVars | undefined,
	plan: Plan,
): void => {
	runtime?.set(PLAN_RUNTIME_KEY, plan);
};

export const clearPlan = (runtime?: FlowRuntimeVars): void => {
	runtime?.delete(PLAN_RUNTIME_KEY);
};

export function formatPlan(plan: Plan): string {
	const lines = [
		`# ${plan.title}`,
		`Created: ${plan.createdAt}  Updated: ${plan.updatedAt}`,
		"",
	];
	for (const item of plan.items) {
		const box = item.checked ? "[x]" : "[ ]";
		const notes = item.notes ? ` — ${item.notes}` : "";
		lines.push(`${item.id}. ${box} ${item.description}${notes}`);
	}
	const done = plan.items.filter((i) => i.checked).length;
	lines.push("", `Progress: ${done}/${plan.items.length} completed`);
	if (plan.items.length > 0 && done === plan.items.length) {
		lines.push("✓ ALL ITEMS COMPLETE");
	}
	return lines.join("\n");
}
