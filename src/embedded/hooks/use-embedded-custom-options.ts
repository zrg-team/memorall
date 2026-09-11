import { useCallback, useEffect, useState } from "react";
import { backgroundJob } from "@/services/background-jobs/background-job";
import { logError } from "@/utils/logger";
import {
	CO_AGENT_DEFAULT_FLOW_ID,
	getSelectedAgentFlowId,
	loadSelectedAgentFlowId,
	setSelectedAgentFlowId as persistSelectedAgentFlowId,
	subscribeToSelectedAgentFlowId,
} from "./selected-agent-flow";

export interface EmbeddedSelectOption {
	id: string;
	name: string;
	/** The agent's OpenUI theme, so a rendered block can use it. */
	openuiTheme?: string;
}

export const useEmbeddedCustomOptions = () => {
	const [topics, setTopics] = useState<EmbeddedSelectOption[]>([]);
	const [agentFlows, setAgentFlows] = useState<EmbeddedSelectOption[]>([]);
	const [selectedTopic, setSelectedTopic] = useState<string>("");
	const [topicsLoading, setTopicsLoading] = useState(true);
	// Shared across the dock and the panel and remembered between pages; see
	// ./selected-agent-flow.
	const [selectedAgentFlowId, setSelectedAgentFlowIdState] = useState<string>(
		() => getSelectedAgentFlowId(),
	);

	useEffect(() => {
		const unsubscribe = subscribeToSelectedAgentFlowId(
			setSelectedAgentFlowIdState,
		);
		void loadSelectedAgentFlowId().then(setSelectedAgentFlowIdState);
		return unsubscribe;
	}, []);

	const setSelectedAgentFlowId = useCallback((flowId: string) => {
		persistSelectedAgentFlowId(flowId);
	}, []);

	useEffect(() => {
		const loadTopics = async () => {
			try {
				setTopicsLoading(true);
				const result = await backgroundJob.createJob(
					"get-topics",
					{},
					{ stream: false },
				);

				if (!("promise" in result)) {
					return;
				}

				const jobResult = await result.promise;
				if (
					jobResult.status === "completed" &&
					jobResult.result &&
					"topics" in jobResult.result
				) {
					const topicList = jobResult.result.topics;
					if (Array.isArray(topicList)) {
						setTopics(
							topicList.map((topic) => ({
								id: topic.id,
								name: topic.name,
							})),
						);
					}
				}
			} catch (error) {
				logError("Failed to load topics:", error);
			} finally {
				setTopicsLoading(false);
			}
		};

		void loadTopics();
	}, []);

	useEffect(() => {
		const loadPredefinedFlows = async () => {
			try {
				const result = await backgroundJob.createJob(
					"get-predefined-flows",
					{ flowKey: "foundation" },
					{ stream: false },
				);

				if (!("promise" in result)) {
					return;
				}

				const jobResult = await result.promise;
				if (
					jobResult.status === "completed" &&
					jobResult.result &&
					"flows" in jobResult.result
				) {
					const flowList = jobResult.result.flows;
					if (Array.isArray(flowList)) {
						// The built-in entry leads: it is the plain co-agent, and the
						// only way to ask for the stock foundation agent. Auto-selecting
						// the most recently edited agent instead is what made a
						// deliberate choice look ignored.
						const flows: EmbeddedSelectOption[] = [
							{ id: CO_AGENT_DEFAULT_FLOW_ID, name: "CoAgent" },
							...(flowList as EmbeddedSelectOption[]).filter(
								(flow) => flow.id !== CO_AGENT_DEFAULT_FLOW_ID,
							),
						];
						setAgentFlows(flows);
					}
				}
			} catch (error) {
				logError("Failed to load predefined flows:", error);
			}
		};

		void loadPredefinedFlows();
	}, []);

	return {
		topics,
		agentFlows,
		selectedTopic,
		setSelectedTopic,
		topicsLoading,
		selectedAgentFlowId,
		setSelectedAgentFlowId,
		hasTopics: topics.length > 0,
	};
};
