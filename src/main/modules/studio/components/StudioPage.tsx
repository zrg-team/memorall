import { History, Loader2, Settings2 } from "lucide-react";
import type React from "react";
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@/main/components/ui/button";
import { useWorkspaceHeaderSlot } from "@/main/components/workspace-header-slot";
import { TooltipProvider } from "@/main/components/ui/tooltip";
import type { SelectableModel } from "@/main/hooks/selectable-model";
import { useSelectableModels } from "@/main/hooks/use-selectable-models";
import { serviceManager } from "@/services";
import { PROVIDER_TO_SERVICE } from "@/services/llm/constants";
import { isResidentLocalProvider } from "@/services/llm/provider-registry";
import { ModelSelector } from "@/main/modules/chat/components/input/ModelSelector";
import { useStudioStore } from "@/main/stores/studio";
import type { MediaCategory } from "@/services/llm/interfaces/model-category";
import { useStudioModel } from "../hooks/use-studio-model";
import { useStudioModelInfo } from "../hooks/use-studio-model-info";
import { studioModeDescriptor } from "../studio-modes";
import { StudioModelStatus } from "./shared/StudioModelStatus";
import { StudioModelPickerContext } from "./shared/studio-model-picker";
import type { StudioCanvasProps } from "./studio-canvas";
import { StudioHistoryRail } from "./StudioHistoryRail";
import { StudioNoModels } from "./StudioNoModels";

const SpeechStudio = lazy(() =>
	import("./speech/SpeechStudio").then((module) => ({
		default: module.SpeechStudio,
	})),
);
const TranscriptionStudio = lazy(() =>
	import("./transcription/TranscriptionStudio").then((module) => ({
		default: module.TranscriptionStudio,
	})),
);
const ImageGenerationStudio = lazy(() =>
	import("./image-generation/ImageGenerationStudio").then((module) => ({
		default: module.ImageGenerationStudio,
	})),
);
const ImageToolsStudio = lazy(() =>
	import("./image-tools/ImageToolsStudio").then((module) => ({
		default: module.ImageToolsStudio,
	})),
);
const TextToolsStudio = lazy(() =>
	import("./text-tools/TextToolsStudio").then((module) => ({
		default: module.TextToolsStudio,
	})),
);

const CANVASES: Record<
	MediaCategory,
	React.ComponentType<StudioCanvasProps>
> = {
	"text-to-speech": SpeechStudio,
	"text-to-audio": SpeechStudio,
	"speech-to-text": TranscriptionStudio,
	"image-generation": ImageGenerationStudio,
	"image-tools": ImageToolsStudio,
	"text-tools": TextToolsStudio,
};

interface StudioPageProps {
	mode: MediaCategory;
	isNarrow?: boolean;
}

export const StudioPage: React.FC<StudioPageProps> = ({
	mode,
	isNarrow = false,
}) => {
	const { t } = useTranslation("studio");
	const navigate = useNavigate();
	const descriptor = studioModeDescriptor(mode);
	const { current, loading, load, ensureReady } = useStudioModel(mode);
	const modelInfo = useStudioModelInfo(current);
	const selectable = useSelectableModels(mode);
	const modeState = useStudioStore((store) => store.modes[mode]);
	const loadMode = useStudioStore((store) => store.loadMode);
	const [historyOpen, setHistoryOpen] = useState(false);
	const headerSlot = useWorkspaceHeaderSlot();
	const pendingLoad = useRef<string | null>(null);

	// Picking a local model loads it right away, through the studio's loader so
	// its download and load show as progress instead of a silent busy input.
	const selectModel = async (model: SelectableModel) => {
		if (!isResidentLocalProvider(model.provider)) {
			await selectable.selectModel(model);
			return;
		}
		const serviceName =
			model.serviceName || PROVIDER_TO_SERVICE[model.provider];
		pendingLoad.current = `${serviceName}:${model.id}`.toLowerCase();
		await serviceManager.llmService.setCurrentModelFor(
			mode,
			model.provider,
			model.id,
			serviceName,
		);
	};

	useEffect(() => {
		if (
			current &&
			pendingLoad.current ===
				`${current.serviceName}:${current.modelId}`.toLowerCase()
		) {
			pendingLoad.current = null;
			void ensureReady().catch(() => undefined);
		}
	}, [current, ensureReady]);

	useEffect(() => {
		void loadMode(mode);
		setHistoryOpen(false);
	}, [loadMode, mode]);

	const Canvas = CANVASES[mode];

	// Chat picks its model in the composer; so does every studio (see
	// StudioComposer). The first-run page, which has no composer, shows it too.
	const modelPicker = (
		<ModelSelector
			models={selectable.models}
			byProvider={selectable.byProvider}
			currentModelId={current?.modelId ?? ""}
			isLoading={selectable.isLoading}
			lockedProviders={selectable.lockedProviders}
			onSelect={(model) => void selectModel(model)}
			onOpen={selectable.refresh}
			isNarrow={isNarrow}
		/>
	);

	const headerControls = (
		<>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				className="h-8 w-8 text-muted-foreground"
				onClick={() => navigate(`/llm?category=${mode}`)}
				aria-label={t("model.manage", {
					defaultValue: "Manage models",
				})}
				title={t("model.manage", { defaultValue: "Manage models" })}
			>
				<Settings2 size={15} />
			</Button>
		</>
	);
	const showRail = !isNarrow;

	return (
		<TooltipProvider>
			<div
				className="relative flex h-full min-h-0 bg-background text-foreground [background-image:linear-gradient(180deg,hsl(var(--muted)/0.28)_0%,transparent_190px)]"
				data-studio-mode={mode}
				data-copilot="studio-center"
				data-studio-model-id={current?.modelId ?? ""}
				data-studio-model-provider={current?.provider ?? ""}
			>
				{showRail ? <StudioHistoryRail mode={mode} /> : null}

				<div className="chat-panel-container relative flex min-w-0 flex-1 flex-col overflow-hidden">
					{/* Sessions open as a drawer on narrow panels, like chat's history. */}
					{!showRail && historyOpen ? (
						<>
							<button
								type="button"
								className="absolute inset-0 z-40 bg-black/45 backdrop-blur-[1px]"
								onClick={() => setHistoryOpen(false)}
								aria-label={t("history.close", {
									defaultValue: "Close sessions",
								})}
							/>
							<div
								className="absolute inset-y-0 left-0 z-50 w-[min(88%,22rem)] max-w-full bg-background shadow-2xl"
								role="dialog"
								aria-modal="true"
							>
								<StudioHistoryRail
									mode={mode}
									onClose={() => setHistoryOpen(false)}
								/>
							</div>
						</>
					) : null}
					{!showRail && current ? (
						<div className="absolute left-2 top-2 z-30">
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="h-8 w-8 text-muted-foreground hover:bg-muted hover:text-foreground"
								onClick={() => setHistoryOpen(true)}
								aria-label={t("history.open", {
									defaultValue: "Show sessions",
								})}
								data-studio-history-toggle
							>
								<History size={16} />
							</Button>
						</div>
					) : null}

					{/* Loading status and "manage models" sit beside the mode switcher
					    on wide panels; a narrow header has no room beside the app's
					    floating navigation, and the picker lives in the composer. */}
					{headerSlot ? (
						isNarrow ? null : (
							createPortal(headerControls, headerSlot)
						)
					) : (
						<div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 px-3">
							<h1 className="truncate text-sm font-semibold">
								{t(`modes.${mode}.label`, { defaultValue: descriptor.label })}
							</h1>
							<div className="ml-auto flex min-w-0 items-center gap-1">
								{headerControls}
							</div>
						</div>
					)}

					{current ? (
						<StudioModelStatus
							modelId={current.modelId}
							load={load}
							onRetry={() => void ensureReady().catch(() => undefined)}
							onManage={() => navigate(`/llm?category=${mode}`)}
						/>
					) : null}

					<div className="min-h-0 flex-1">
						{loading || !modeState?.loaded ? (
							<div className="flex h-full items-center justify-center">
								<Loader2
									size={18}
									className="animate-spin text-muted-foreground"
								/>
							</div>
						) : !current ? (
							<StudioNoModels
								mode={mode}
								modelPicker={selectable.models.length > 0 ? modelPicker : null}
							/>
						) : (
							<Suspense
								fallback={
									<div className="flex h-full items-center justify-center">
										<Loader2
											size={18}
											className="animate-spin text-muted-foreground"
										/>
									</div>
								}
							>
								<StudioModelPickerContext.Provider value={modelPicker}>
									<Canvas
										// Keyed by mode only: the first generation creates the session,
										// and remounting then would cut off a stream in progress.
										key={mode}
										mode={mode}
										model={current}
										modelInfo={modelInfo}
										items={modeState.items}
										ensureModelReady={ensureReady}
										isNarrow={isNarrow}
									/>
								</StudioModelPickerContext.Provider>
							</Suspense>
						)}
					</div>
				</div>
			</div>
		</TooltipProvider>
	);
};
