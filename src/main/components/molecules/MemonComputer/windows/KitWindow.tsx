import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { TooltipProvider } from "@/main/components/ui/tooltip";
import type { SelectableModel } from "@/main/hooks/selectable-model";
import { useSelectableModels } from "@/main/hooks/use-selectable-models";
import { ModelSelector } from "@/main/modules/chat/components/input/ModelSelector";
import { useCategoryCurrentModel } from "@/main/modules/studio/hooks/use-category-current-model";
import { studioModeDescriptor } from "@/main/modules/studio/studio-modes";
import { useShellLayoutStore } from "@/main/stores/shell-layout";
import { useStudioStore } from "@/main/stores/studio";
import { useWorkspaceModeStore } from "@/main/stores/workspace-mode";
import { serviceManager } from "@/services";
import { ensureComposioHostAccess } from "@/services/composio/host-access";
import { PROVIDER_TO_SERVICE } from "@/services/llm/constants";
import type {
	MemonControlValue,
	MemonKitText,
} from "@/services/memon/app-kit/types";
import { MEMON_KIT_APPS, type MemonKitAppId } from "@/services/memon/apps";
import {
	MEMON_STUDIO_MODES,
	MEMON_STUDIO_TOOL_IDS,
	type MemonStudioToolId,
} from "@/services/memon/constants";
import type { MemonMachineSnapshot } from "@/services/memon/types";
import { logError } from "@/utils/logger";
import { MemonAppView } from "../kit/MemonAppView";
import type { MemonSend } from "../types";
import { pickFiles, uploadToComputer } from "../upload";

/**
 * Shows a studio in the chat panel, on the session that holds a run if
 * given. The chat panel is opened first: it may be collapsed.
 */
export const openInStudio = async (
	tool: MemonStudioToolId,
	conversationId?: string,
): Promise<void> => {
	const mode = MEMON_STUDIO_MODES[tool];
	useShellLayoutStore.getState().setChatShellCollapsed(false);
	useWorkspaceModeStore.getState().setMode(mode);
	const studio = useStudioStore.getState();
	await studio.loadMode(mode);
	if (conversationId) await studio.openConversation(mode, conversationId);
};

/** As the app shell: below this the workspace covers the whole screen. */
const MOBILE_WORKSPACE_QUERY = "(max-width: 640px)";

const STUDIO_ICONS = Object.fromEntries(
	MEMON_STUDIO_TOOL_IDS.map((tool) => [
		tool,
		studioModeDescriptor(MEMON_STUDIO_MODES[tool]).icon,
	]),
);

const UPLOAD_ACCEPT: Partial<Record<MemonStudioToolId, string>> = {
	transcribe: "audio/*,video/*",
	image: "image/*",
	image_tools: "image/*",
};

/**
 * The model chosen for a studio, changeable here. A change made anywhere
 * (here or on the Studio page) makes the computer read its studios again,
 * so the agent sees it too.
 */
const StudioModelSlot: React.FC<{
	tool: MemonStudioToolId;
	machineKey: string;
	send: MemonSend;
}> = ({ tool, machineKey, send }) => {
	const mode = MEMON_STUDIO_MODES[tool];
	const selectable = useSelectableModels(mode);
	const { current } = useCategoryCurrentModel(mode);
	const modelKey = current ? `${current.serviceName}:${current.modelId}` : "";
	// biome-ignore lint/correctness/useExhaustiveDependencies: the computer reads its studios again whenever the chosen model changes.
	React.useEffect(() => {
		void send("studio.refresh", { key: machineKey });
	}, [modelKey, machineKey, send]);
	const select = async (model: SelectableModel) => {
		await serviceManager.llmService.setCurrentModelFor(
			mode,
			model.provider,
			model.id,
			model.serviceName || PROVIDER_TO_SERVICE[model.provider],
		);
	};
	return (
		<TooltipProvider>
			<ModelSelector
				models={selectable.models}
				byProvider={selectable.byProvider}
				currentModelId={current?.modelId ?? ""}
				isLoading={selectable.isLoading}
				lockedProviders={selectable.lockedProviders}
				onSelect={(model) => void select(model)}
				onOpen={selectable.refresh}
				isNarrow
			/>
		</TooltipProvider>
	);
};

/**
 * A computer app built with the kit: its nodes drawn as the window, its
 * controls sent to the machine as the user's actions. The few things only
 * the user can do (pick a file, open a page, choose a model) are handled
 * here.
 */
export const KitWindow: React.FC<{
	app: MemonKitAppId;
	machineKey: string;
	snapshot: MemonMachineSnapshot;
	send: MemonSend;
}> = ({ app, machineKey, snapshot, send }) => {
	const navigate = useNavigate();
	const { t } = useTranslation("common");
	const kit = MEMON_KIT_APPS[app];
	// The user's language; the agent reads the same nodes in English.
	const text = React.useCallback<MemonKitText>(
		(key, english, values) =>
			t(`memonComputer.${key}`, { defaultValue: english, ...values }),
		[t],
	);
	const nodes = React.useMemo(
		() => kit.view(snapshot, text),
		[kit, snapshot, text],
	);
	const selectedTool = snapshot.studio.selected;

	const onAction = async (id: string, value: MemonControlValue) => {
		// Composio is reached only with host access, which a click must ask for.
		if (app === "connections" && id.startsWith("grant:") && value === true) {
			const item = snapshot.connections.items.find(
				(entry) => entry.key === id.slice("grant:".length),
			);
			if (item?.kind === "composio") {
				await ensureComposioHostAccess().catch(() => false);
			}
		}
		return send("app.action", { key: machineKey, app, id, value });
	};

	const showStudio = (tool: MemonStudioToolId, conversationId?: string) => {
		// On a phone the workspace covers the chat panel; leave it, as closing does.
		if (globalThis.matchMedia?.(MOBILE_WORKSPACE_QUERY).matches) navigate("/");
		void openInStudio(tool, conversationId);
	};

	const onUserAction = (id: string) => {
		// Approving and deleting a task are the user's: the agent never sees
		// those buttons, but the machine carries them out.
		if (app === "tasks") {
			if (
				id.startsWith("delete:") &&
				!window.confirm(t("memonComputer.tasks.deleteConfirm"))
			)
				return;
			void onAction(id, undefined);
			return;
		}
		if (id === "page") {
			navigate(app === "skills" ? "/skills" : "/connections");
			return;
		}
		if (app !== "studio") return;
		if (id === "setup" && selectedTool) {
			showStudio(selectedTool);
			return;
		}
		if (id.startsWith("open:")) {
			const run = snapshot.studio.runs.find(
				(entry) => entry.id === id.slice("open:".length),
			);
			if (run) showStudio(run.tool, run.conversationId);
			return;
		}
		if (id === "upload:path" && selectedTool) {
			void (async () => {
				const picked = await pickFiles({
					accept: UPLOAD_ACCEPT[selectedTool],
					multiple: false,
				});
				if (!picked.length) return;
				const [path] = await uploadToComputer(picked, snapshot.files.cwd);
				if (!path) return;
				await send("files.uploaded", { key: machineKey, paths: [path] });
				await send("app.action", {
					key: machineKey,
					app,
					id: "field:path",
					value: path,
				});
			})().catch((error) => logError("[MEMON] Upload failed:", error));
		}
	};

	return (
		<div className="min-h-0 flex-1 overflow-auto px-3.5 py-3">
			<MemonAppView
				nodes={nodes}
				refPrefix={kit.refPrefix}
				onAction={onAction}
				onUserAction={onUserAction}
				icons={app === "studio" ? STUDIO_ICONS : undefined}
				slots={
					app === "studio" && selectedTool
						? {
								model: (
									<StudioModelSlot
										tool={selectedTool}
										machineKey={machineKey}
										send={send}
									/>
								),
							}
						: undefined
				}
			/>
		</div>
	);
};
