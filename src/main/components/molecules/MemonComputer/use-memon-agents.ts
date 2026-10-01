import React from "react";
import { serviceManager } from "@/services";
import {
	type MemonFeatureConfig,
	memonConfigFromFlow,
} from "@/services/memon/feature-config";
import { logError } from "@/utils/logger";

export interface MemonAgent {
	id: string;
	name: string;
	config: MemonFeatureConfig;
}

/**
 * Active agents with MemonOS Bot turned on, with their computer settings. Read
 * on mount: Runtime remounts when the user comes back from editing an agent.
 */
export const useMemonAgents = (): {
	agents: MemonAgent[];
	loading: boolean;
} => {
	const [agents, setAgents] = React.useState<MemonAgent[]>([]);
	const [loading, setLoading] = React.useState(true);

	React.useEffect(() => {
		let cancelled = false;
		const load = async () => {
			try {
				const flows =
					await serviceManager.flowBuilderService.listPredefinedFlows(
						"foundation",
					);
				const loaded = await Promise.all(
					flows
						.filter((flow) => flow.status === "active")
						.map(async (flow): Promise<MemonAgent | null> => {
							const config =
								await serviceManager.flowBuilderService.getUnifiedFlowConfig({
									flowId: flow.id,
								});
							const memonConfig = memonConfigFromFlow(config);
							return memonConfig
								? { id: flow.id, name: flow.name, config: memonConfig }
								: null;
						}),
				);
				if (!cancelled) {
					setAgents(loaded.filter((agent) => agent !== null));
				}
			} catch (error) {
				logError("[MEMON] Failed to load MemonOS Bot agents:", error);
				if (!cancelled) setAgents([]);
			} finally {
				if (!cancelled) setLoading(false);
			}
		};
		void load();
		return () => {
			cancelled = true;
		};
	}, []);

	return { agents, loading };
};
