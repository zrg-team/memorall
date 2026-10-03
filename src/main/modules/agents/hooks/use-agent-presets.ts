import React from "react";
import { serviceManager } from "@/services";
import { logError } from "@/utils/logger";
import {
	createAgentPresetDraft,
	metadataWithAgentIconScreen,
	type AgentPresetDraft,
	type AgentPresetStatus,
} from "../types";
import type { Flow } from "@/services/database/types";
import { topicService } from "@/main/modules/topics/services/topic-service";
import {
	DEFAULT_GROW_TYPE,
	DEFAULT_RECALL_TYPE,
	type GrowType,
	type RecallType,
} from "@/services/database/entities/topic-types";

const memonClient = () =>
	import("@/services/memon/memon-client").then((module) => module.memonClient);

/**
 * Makes the agent's home, `/agents/<agent name>`, with Bot.md and Memory.md.
 * A failure is only logged: the home is also made on the agent's first run.
 */
const prepareAgentHome = async (agentId: string): Promise<void> => {
	try {
		await (await memonClient()).request("agent.home", { agentId });
	} catch (err) {
		logError("[Agents] Failed to make the agent's home folder:", err);
	}
};

/** Moves the agent's home folder after a rename, and its computer with it. */
const moveAgentHome = async (
	agentId: string,
	from: string,
	to: string,
): Promise<void> => {
	try {
		await (await memonClient()).request("agent.renamed", { agentId, from, to });
	} catch (err) {
		logError("[Agents] Failed to move the agent's home folder:", err);
	}
};

type CreatePresetOptions = {
	growType: GrowType;
	recallType: RecallType;
	status?: AgentPresetStatus;
};

interface UseAgentPresetsResult {
	presets: Flow[];
	filteredPresets: Flow[];
	selectedPreset: Flow | null;
	selectedPresetId: string | null;
	searchQuery: string;
	metadataDraft: AgentPresetDraft;
	hasMetadataChanges: boolean;
	isLoading: boolean;
	isCreating: boolean;
	isDeleting: boolean;
	isSavingMetadata: boolean;
	error: string | null;
	canDeleteSelectedPreset: boolean;
	setSearchQuery: (value: string) => void;
	selectPreset: (presetId: string) => void;
	updateMetadataField: <K extends keyof AgentPresetDraft>(
		field: K,
		value: AgentPresetDraft[K],
	) => void;
	refreshPresets: (preferredPresetId?: string | null) => Promise<string | null>;
	createPreset: (
		name: string,
		options?: CreatePresetOptions,
	) => Promise<Flow | null>;
	saveMetadata: () => Promise<Flow | null>;
	revertMetadata: () => void;
	deleteSelectedPreset: () => Promise<void>;
}

const createEmptyDraft = (): AgentPresetDraft => ({
	name: "",
	description: "",
	status: "active",
	iconScreen: null,
});

const hasDraftChanges = (
	saved: AgentPresetDraft,
	draft: AgentPresetDraft,
): boolean =>
	saved.name !== draft.name ||
	saved.description !== draft.description ||
	saved.status !== draft.status ||
	JSON.stringify(saved.iconScreen) !== JSON.stringify(draft.iconScreen);

export const useAgentPresets = (): UseAgentPresetsResult => {
	const [presets, setPresets] = React.useState<Flow[]>([]);
	const [selectedPresetId, setSelectedPresetId] = React.useState<string | null>(
		null,
	);
	const [searchQuery, setSearchQuery] = React.useState("");
	const [savedMetadata, setSavedMetadata] =
		React.useState<AgentPresetDraft>(createEmptyDraft);
	const [metadataDraft, setMetadataDraft] =
		React.useState<AgentPresetDraft>(createEmptyDraft);
	const [isLoading, setIsLoading] = React.useState(true);
	const [isCreating, setIsCreating] = React.useState(false);
	const [isDeleting, setIsDeleting] = React.useState(false);
	const [isSavingMetadata, setIsSavingMetadata] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const selectedPresetIdRef = React.useRef<string | null>(null);

	React.useEffect(() => {
		selectedPresetIdRef.current = selectedPresetId;
	}, [selectedPresetId]);

	const syncSelection = React.useCallback(
		(nextPresets: Flow[], preferredPresetId?: string | null): string | null => {
			const nextSelectedPreset =
				nextPresets.find((preset) => preset.id === preferredPresetId) ??
				nextPresets.find(
					(preset) => preset.id === selectedPresetIdRef.current,
				) ??
				nextPresets[0] ??
				null;

			const nextDraft = createAgentPresetDraft(nextSelectedPreset);
			setSelectedPresetId(nextSelectedPreset?.id ?? null);
			setSavedMetadata(nextDraft);
			setMetadataDraft(nextDraft);

			return nextSelectedPreset?.id ?? null;
		},
		[],
	);

	const refreshPresets = React.useCallback(
		async (preferredPresetId?: string | null) => {
			setIsLoading(true);
			setError(null);

			try {
				const nextPresets =
					await serviceManager.flowBuilderService.listPredefinedFlows(
						"foundation",
					);
				setPresets(nextPresets);
				return syncSelection(nextPresets, preferredPresetId);
			} catch (err) {
				logError("[Agents] Failed to load presets:", err);
				setError(err instanceof Error ? err.message : "Failed to load agents");
				setPresets([]);
				setSelectedPresetId(null);
				const emptyDraft = createEmptyDraft();
				setSavedMetadata(emptyDraft);
				setMetadataDraft(emptyDraft);
				return null;
			} finally {
				setIsLoading(false);
			}
		},
		[syncSelection],
	);

	React.useEffect(() => {
		void refreshPresets();
	}, [refreshPresets]);

	const filteredPresets = React.useMemo(() => {
		const normalizedQuery = searchQuery.trim().toLowerCase();
		if (!normalizedQuery) {
			return presets;
		}

		return presets.filter((preset) => {
			const name = preset.name.toLowerCase();
			const description = (preset.description ?? "").toLowerCase();
			return (
				name.includes(normalizedQuery) || description.includes(normalizedQuery)
			);
		});
	}, [presets, searchQuery]);

	const selectedPreset = React.useMemo(
		() => presets.find((preset) => preset.id === selectedPresetId) ?? null,
		[presets, selectedPresetId],
	);

	const selectPreset = React.useCallback(
		(presetId: string) => {
			const nextPreset = presets.find((preset) => preset.id === presetId);
			if (!nextPreset) {
				return;
			}

			const nextDraft = createAgentPresetDraft(nextPreset);
			setSelectedPresetId(nextPreset.id);
			setSavedMetadata(nextDraft);
			setMetadataDraft(nextDraft);
			setError(null);
		},
		[presets],
	);

	const updateMetadataField = React.useCallback(
		<K extends keyof AgentPresetDraft>(
			field: K,
			value: AgentPresetDraft[K],
		) => {
			setMetadataDraft((prev) => ({
				...prev,
				[field]: value,
			}));
		},
		[],
	);

	const createPreset = React.useCallback(
		async (
			name: string,
			options: CreatePresetOptions = {
				growType: DEFAULT_GROW_TYPE,
				recallType: DEFAULT_RECALL_TYPE,
				status: "active",
			},
		) => {
			setIsCreating(true);
			setError(null);

			try {
				const created =
					await serviceManager.flowBuilderService.createPredefinedFlow(
						"foundation",
						name,
						options.status ?? "active",
					);
				// The name may have a number added: agents' names are unique.
				await prepareAgentHome(created.id);
				if ((options.status ?? "active") === "active") {
					try {
						await topicService.createTopic({
							name: created.name,
							description: "",
							agentId: created.id,
							growType: options.growType,
							recallType: options.recallType,
						});
					} catch (topicErr) {
						logError(
							"[Agents] Failed to create memory zone for agent:",
							topicErr,
						);
					}
				}
				await refreshPresets(created.id);
				return created;
			} catch (err) {
				logError("[Agents] Failed to create preset:", err);
				setError(err instanceof Error ? err.message : "Failed to create agent");
				return null;
			} finally {
				setIsCreating(false);
			}
		},
		[refreshPresets],
	);

	const saveMetadata = React.useCallback(async () => {
		if (!selectedPresetId) {
			return null;
		}
		const selectedPreset = presets.find(
			(preset) => preset.id === selectedPresetId,
		);

		setIsSavingMetadata(true);
		setError(null);

		try {
			const updated =
				await serviceManager.flowBuilderService.updateFlowMetadata(
					selectedPresetId,
					{
						name: metadataDraft.name,
						description: metadataDraft.description,
						status: metadataDraft.status,
						metadata: metadataWithAgentIconScreen(
							selectedPreset?.metadata,
							metadataDraft.iconScreen,
						),
					},
				);

			if (selectedPreset && selectedPreset.name !== updated.name) {
				await moveAgentHome(updated.id, selectedPreset.name, updated.name);
			}
			setPresets((prev) =>
				prev.map((preset) =>
					preset.id === updated.id ? { ...preset, ...updated } : preset,
				),
			);

			const nextDraft = createAgentPresetDraft(updated);
			setSavedMetadata(nextDraft);
			setMetadataDraft(nextDraft);
			return updated;
		} catch (err) {
			logError("[Agents] Failed to save metadata:", err);
			setError(err instanceof Error ? err.message : "Failed to save agent");
			return null;
		} finally {
			setIsSavingMetadata(false);
		}
	}, [
		metadataDraft.description,
		metadataDraft.iconScreen,
		metadataDraft.name,
		metadataDraft.status,
		presets,
		selectedPresetId,
	]);

	const revertMetadata = React.useCallback(() => {
		setMetadataDraft(savedMetadata);
	}, [savedMetadata]);

	const deleteSelectedPreset = React.useCallback(async () => {
		if (!selectedPresetId || presets.length <= 1) {
			return;
		}

		setIsDeleting(true);
		setError(null);

		try {
			const selectedIndex = presets.findIndex(
				(preset) => preset.id === selectedPresetId,
			);
			const nextSelectedPresetId =
				presets[selectedIndex + 1]?.id ??
				presets[selectedIndex - 1]?.id ??
				null;

			await serviceManager.flowBuilderService.deleteFlow(selectedPresetId);
			await refreshPresets(nextSelectedPresetId);
		} catch (err) {
			logError("[Agents] Failed to delete preset:", err);
			setError(err instanceof Error ? err.message : "Failed to delete agent");
		} finally {
			setIsDeleting(false);
		}
	}, [presets, refreshPresets, selectedPresetId]);

	return {
		presets,
		filteredPresets,
		selectedPreset,
		selectedPresetId,
		searchQuery,
		metadataDraft,
		hasMetadataChanges: hasDraftChanges(savedMetadata, metadataDraft),
		isLoading,
		isCreating,
		isDeleting,
		isSavingMetadata,
		error,
		canDeleteSelectedPreset: presets.length > 1 && Boolean(selectedPresetId),
		setSearchQuery,
		selectPreset,
		updateMetadataField,
		refreshPresets,
		createPreset,
		saveMetadata,
		revertMetadata,
		deleteSelectedPreset,
	};
};
