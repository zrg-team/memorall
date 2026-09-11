import { BaseProcessHandler } from "./base-process-handler";
import type { ProcessDependencies, BaseJob, ItemHandlerResult } from "./types";
import { handlerRegistry } from "./handler-registry";
import { serviceManager } from "@/services";
import { logInfo } from "@/utils/logger";

const JOB_NAMES = {
	getPredefinedFlows: "get-predefined-flows",
	getFlowConfig: "get-flow-config",
} as const;

export interface GetPredefinedFlowsPayload {
	flowKey?: "foundation";
}

export interface GetPredefinedFlowsResult extends Record<string, unknown> {
	flows: Array<{ id: string; name: string; openuiTheme?: string }>;
}

export interface GetFlowConfigPayload {
	flowId: string;
}

/**
 * An agent's resolved configuration, and whether it is really that agent's.
 *
 * `usedFallback` is the difference between "here is your agent" and "here is
 * the stock config wearing your agent's name" — which a caller has no way to
 * tell apart from the config alone.
 */
export interface GetFlowConfigResult extends Record<string, unknown> {
	config: unknown;
	usedFallback: boolean;
	reason?: string;
}

type FlowOperationsJob = BaseJob & {
	jobType: (typeof JOB_NAMES)[keyof typeof JOB_NAMES];
	payload: GetPredefinedFlowsPayload & Partial<GetFlowConfigPayload>;
};

class FlowOperationsHandler extends BaseProcessHandler<FlowOperationsJob> {
	async process(
		_jobId: string,
		job: FlowOperationsJob,
		_dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		switch (job.jobType) {
			case JOB_NAMES.getPredefinedFlows:
				return this.handleGetPredefinedFlows(job.payload);
			case JOB_NAMES.getFlowConfig:
				return this.handleGetFlowConfig(
					job.payload as unknown as GetFlowConfigPayload,
				);
			default:
				throw new Error(`Unknown flow operations job type: ${job.jobType}`);
		}
	}

	private async handleGetPredefinedFlows(
		payload: GetPredefinedFlowsPayload,
	): Promise<GetPredefinedFlowsResult> {
		const flowKey = payload.flowKey ?? "foundation";
		logInfo(`[FLOW_OPERATIONS_HANDLER] Getting predefined flows: ${flowKey}`);
		const flows =
			await serviceManager.flowBuilderService.listPredefinedFlows(flowKey);
		// The OpenUI theme rides along so a content script can render a block in
		// the agent's theme. It has no service manager of its own, and the theme
		// otherwise only exists as a step config in the database.
		const withThemes = await Promise.all(
			flows.map(async (flow) => {
				let openuiTheme: string | undefined;
				try {
					const config =
						await serviceManager.flowBuilderService.getUnifiedFlowConfig({
							flowId: flow.id,
						});
					const step = config.steps.find(
						(entry) => entry.name === "visualize-response" && entry.enabled,
					);
					const candidate = (step?.config as { theme?: unknown } | undefined)
						?.theme;
					if (typeof candidate === "string" && candidate) {
						openuiTheme = candidate;
					}
				} catch {
					// A missing theme costs the block its styling, not the answer.
				}
				return { id: flow.id, name: flow.name, openuiTheme };
			}),
		);
		return { flows: withThemes };
	}

	private async handleGetFlowConfig(
		payload: GetFlowConfigPayload,
	): Promise<GetFlowConfigResult> {
		const resolved =
			await serviceManager.flowBuilderService.resolveUnifiedFlowConfig({
				flowId: payload.flowId,
			});
		return {
			config: resolved.config,
			usedFallback: resolved.usedFallback,
			reason: resolved.reason,
		};
	}
}

const flowOperationsHandler = new FlowOperationsHandler();
handlerRegistry.register({
	instance: flowOperationsHandler,
	jobs: [JOB_NAMES.getPredefinedFlows, JOB_NAMES.getFlowConfig],
});

declare global {
	interface JobTypeRegistry {
		"get-predefined-flows": GetPredefinedFlowsPayload;
		"get-flow-config": GetFlowConfigPayload;
	}

	interface JobResultRegistry {
		"get-predefined-flows": GetPredefinedFlowsResult;
		"get-flow-config": GetFlowConfigResult;
	}
}
