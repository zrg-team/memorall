import { z } from "zod";
import {
  createServiceToken,
  type HarnessPlugin,
} from "@memorall/agent-harness-core";

export interface SkillSummary {
  name: string;
  description: string;
  version?: string;
  author?: string;
  tags?: readonly string[];
  sourceUrl?: string;
}

export interface Skill extends SkillSummary {
  body: string;
}

export interface SkillService {
  list(): Promise<readonly SkillSummary[]>;
  load(name: string): Promise<Skill>;
}

export const SKILL_SERVICE = createServiceToken<SkillService>("skillService", {
  description: "Skill discovery and loading service",
});

export const skillsPlugin = (): HarnessPlugin => ({
  id: "agent-harness.standard.skills",
  version: "0.1.0",
  register: ({ registerTool }) => {
    registerTool("load_skill", (services) => ({
      name: "load_skill",
      description: "Load a named skill and return its complete instructions.",
      schema: z.object({ skill_name: z.string().min(1) }),
      requiredServices: [SKILL_SERVICE],
      annotations: { readOnlyHint: true, idempotentHint: true, parallelSafeHint: true },
      execute: async ({ skill_name }) => {
        try {
          const skill = await services.get(SKILL_SERVICE).load(skill_name);
          return {
            content: `<skill name="${skill.name}">\n${skill.body}\n</skill>`,
            structuredContent: skill as never,
          };
        } catch {
          const available = await services.get(SKILL_SERVICE).list();
          return {
            content: `Skill not found: ${skill_name}`,
            isError: true,
            structuredContent: { available: available.map(({ name }) => name) },
          };
        }
      },
    }));
  },
});
