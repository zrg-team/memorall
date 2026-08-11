import { z } from "zod";
import type { BaseTool, HarnessPlugin, RunContext } from "@memorall/agent-harness-core";

export interface PlanItem {
  id: string;
  description: string;
  checked: boolean;
}

export interface Plan {
  title: string;
  items: PlanItem[];
  createdAt: string;
  updatedAt: string;
}

const PLAN_KEY = "agent-harness.plan";

const getPlan = (runtime: RunContext): Plan | undefined => runtime.get<Plan>(PLAN_KEY);
const setPlan = (runtime: RunContext, plan: Plan): void => runtime.set(PLAN_KEY, plan);
const render = (plan: Plan): string =>
  [`# ${plan.title}`, ...plan.items.map((item) => `- [${item.checked ? "x" : " "}] ${item.id}. ${item.description}`)].join("\n");

const updatePlan = (plan: Plan, now: number, items: PlanItem[]): Plan => ({
  ...plan,
  items,
  updatedAt: new Date(now).toISOString(),
});

export const createPlannerTools = (): BaseTool<any>[] => [
  {
    name: "planner_create",
    description: "Create or replace the run-local execution plan.",
    schema: z.object({ title: z.string().min(1), items: z.string() }),
    annotations: { idempotentHint: true },
    execute: async ({ title, items }, { runtime, platform }) => {
      const now = new Date(platform.now()).toISOString();
      const plan: Plan = {
        title,
        items: (items as string).split(";").map((value: string) => value.trim()).filter(Boolean).map((description: string, index: number) => ({
          id: String(index + 1), description, checked: false,
        })),
        createdAt: now,
        updatedAt: now,
      };
      setPlan(runtime, plan);
      return { content: render(plan), structuredContent: plan as never };
    },
  },
  {
    name: "planner_get",
    description: "Read the current run-local plan.",
    schema: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true },
    execute: async (_input, { runtime }) => {
      const plan = getPlan(runtime);
      return plan
        ? { content: render(plan), structuredContent: plan as never }
        : { content: "No plan exists.", structuredContent: { plan: null } };
    },
  },
  {
    name: "planner_add_item",
    description: "Append an item to the current plan.",
    schema: z.object({ description: z.string().min(1) }),
    execute: async ({ description }, { runtime, platform }) => {
      const plan = getPlan(runtime);
      if (!plan) return { content: "No plan exists. Call planner_create first.", isError: true };
      const next = updatePlan(plan, platform.now(), [
        ...plan.items,
        { id: String(plan.items.length + 1), description, checked: false },
      ]);
      setPlan(runtime, next);
      return { content: render(next), structuredContent: next as never };
    },
  },
  {
    name: "planner_check_item",
    description: "Mark a plan item complete or incomplete.",
    schema: z.object({ id: z.string().min(1), checked: z.boolean().optional() }),
    annotations: { idempotentHint: true },
    execute: async ({ id, checked = true }, { runtime, platform }) => {
      const plan = getPlan(runtime);
      if (!plan) return { content: "No plan exists.", isError: true };
      if (!plan.items.some((item) => item.id === id)) return { content: `Plan item not found: ${id}`, isError: true };
      const next = updatePlan(plan, platform.now(), plan.items.map((item) => item.id === id ? { ...item, checked } : item));
      setPlan(runtime, next);
      return { content: render(next), structuredContent: next as never };
    },
  },
  {
    name: "planner_remove_item",
    description: "Remove an item from the current plan.",
    schema: z.object({ id: z.string().min(1) }),
    annotations: { destructiveHint: true, idempotentHint: true },
    execute: async ({ id }, { runtime, platform }) => {
      const plan = getPlan(runtime);
      if (!plan) return { content: "No plan exists.", isError: true };
      const items = plan.items.filter((item) => item.id !== id);
      if (items.length === plan.items.length) return { content: `Plan item not found: ${id}`, isError: true };
      const next = updatePlan(plan, platform.now(), items);
      setPlan(runtime, next);
      return { content: render(next), structuredContent: next as never };
    },
  },
];

export const plannerPlugin = (): HarnessPlugin => ({
  id: "agent-harness.standard.planner",
  version: "0.1.0",
  register: ({ registerTool }) => {
    for (const tool of createPlannerTools()) registerTool(tool.name, () => tool);
  },
});
