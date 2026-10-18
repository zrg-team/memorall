import type { UnifiedFlowConfig } from "@memorall/agent-harness-flows/interfaces/config/flow-config";
import { ADD_SKILL_CONTEXT_STEP_NAME } from "@memorall/agent-harness-flows/steps/common/add-skill-context";

export const enabledSkillNamesOf = (config: UnifiedFlowConfig): string[] => {
	const step = config.steps.find(
		(step) => step.name === ADD_SKILL_CONTEXT_STEP_NAME,
	);
	const names = step?.config?.enabledSkillNames;
	return step?.enabled && Array.isArray(names)
		? names.filter((name): name is string => typeof name === "string")
		: [];
};

export const withEnabledSkills = (
	config: UnifiedFlowConfig,
	names: string[],
): UnifiedFlowConfig => {
	const current = config.steps.find(
		(step) => step.name === ADD_SKILL_CONTEXT_STEP_NAME,
	);
	const next = {
		...(current ?? {
			id: `${config.graphType}__${ADD_SKILL_CONTEXT_STEP_NAME}__0`,
			name: ADD_SKILL_CONTEXT_STEP_NAME,
		}),
		enabled: names.length > 0,
		config: { ...current?.config, enabledSkillNames: [...new Set(names)] },
	};
	return {
		...config,
		steps: current
			? config.steps.map((step) => (step === current ? next : step))
			: [...config.steps, next],
	};
};

export interface SkillConfigAccess {
	read(): Promise<UnifiedFlowConfig>;
	save(config: UnifiedFlowConfig): Promise<void>;
}

const writes = new Map<string | null, Promise<unknown>>();
export const flushSkillAssignments = async (
	flowId: string | null,
): Promise<void> => {
	await writes.get(flowId);
};

/** Saves only the skill switch, using the latest saved config, never other UI drafts. */
export const updateSkillAssignment = (
	flowId: string | null,
	name: string,
	enabled: boolean,
	access?: SkillConfigAccess,
): Promise<UnifiedFlowConfig> => {
	const update = async () => {
		const service = access
			? null
			: (await import("@/services")).serviceManager.flowBuilderService;
		const ref = flowId ? { flowId } : { predefinedFlow: "foundation" as const };
		const config = await (access
			? access.read()
			: service!.getUnifiedFlowConfig(ref));
		const current = enabledSkillNamesOf(config);
		const next = withEnabledSkills(
			config,
			enabled
				? [...new Set([...current, name])]
				: current.filter((value) => value !== name),
		);
		await (access
			? access.save(next)
			: service!.saveUnifiedFlowConfig(ref, next));
		return next;
	};
	// Same-agent switches must read after earlier switches have committed. Web
	// Locks also serialize switches from another tab or the offscreen computer.
	const run = () =>
		typeof navigator !== "undefined" && navigator.locks
			? navigator.locks.request(
					`memorall.skills:${flowId ?? "default"}`,
					update,
				)
			: update();
	const result = (writes.get(flowId) ?? Promise.resolve()).then(run);
	const settled = result.then(
		() => undefined,
		() => undefined,
	);
	writes.set(flowId, settled);
	void settled.then(() => {
		if (writes.get(flowId) === settled) writes.delete(flowId);
	});
	return result;
};
