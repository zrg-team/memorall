import { Code2, FolderOpen, LayoutDashboard, Save } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { MessageActionRequest } from "@/main/modules/chat/components/artifacts/ArtifactActionsMenu";
import {
	formatOpenUIFormStateContext,
	getOpenUISendMessageText,
	isAllowedOpenUIRoute,
	type MemorallOpenUIActionDetail,
	normalizeOpenUIDocumentPath,
	resolveOpenUITemplate,
} from "@/main/modules/openui/actions";
import { OpenUIRenderer } from "@/main/modules/openui/OpenUIRenderer";
import { useShellLayoutStore } from "@/main/stores/shell-layout";
import { useWorkspaceModeStore } from "@/main/stores/workspace-mode";
import {
	MEMON_VISUALS_DIR,
	memonDisplayPath,
} from "@/services/memon/constants";
import type { MemonVisualState } from "@/services/memon/types";
import type { MemonSend } from "../types";

/** Text a visual's button sends goes to the user's chat box, to send. */
const sendToChat = (text: string) => {
	if (!text.trim()) return;
	useShellLayoutStore.getState().setChatShellCollapsed(false);
	useWorkspaceModeStore.getState().sendTextToChat(text);
};

/**
 * Visualize: a visual the agent wrote in OpenUI Lang, drawn as in chat and
 * kept as a .openui file. The source view edits that file.
 */
export const VisualizeWindow: React.FC<{
	machineKey: string;
	visual: MemonVisualState;
	home: string;
	send: MemonSend;
}> = ({ machineKey, visual, home, send }) => {
	const { t } = useTranslation("common");
	const navigate = useNavigate();
	const [showSource, setShowSource] = React.useState(false);
	const [draft, setDraft] = React.useState(visual.source);
	// The agent's update replaces what is shown, unless the user is editing.
	const dirty = draft !== visual.source;
	const dirtyRef = React.useRef(dirty);
	dirtyRef.current = dirty;
	React.useEffect(() => {
		if (!dirtyRef.current) setDraft(visual.source);
	}, [visual.source]);
	React.useEffect(() => {
		setDraft(visual.source);
		// A different visual starts clean.
		// biome-ignore lint/correctness/useExhaustiveDependencies: reset per file only.
	}, [visual.path]);

	const onMessageAction = React.useCallback(
		(action: MessageActionRequest) => {
			if (action.type !== "openui_action") return;
			const detail = action.payload?.detail as
				| MemorallOpenUIActionDetail
				| undefined;
			if (!detail?.action) return;
			const openUIAction = detail.action;
			if (openUIAction.type === "send_message") {
				const message = getOpenUISendMessageText(
					openUIAction,
					detail.formState,
					detail.formName,
					detail.humanFriendlyMessage,
				);
				const withForm =
					openUIAction.includeFormState ?? Boolean(detail.formName);
				const context = withForm
					? formatOpenUIFormStateContext(detail.formState, detail.formName)
					: undefined;
				sendToChat([context, message].filter(Boolean).join("\n\n"));
				return;
			}
			if (openUIAction.type === "add_message_to_input") {
				sendToChat(
					resolveOpenUITemplate(
						openUIAction.text,
						detail.formState,
						detail.formName,
					),
				);
				return;
			}
			if (openUIAction.type === "open_document") {
				const path = normalizeOpenUIDocumentPath(
					resolveOpenUITemplate(
						openUIAction.path,
						detail.formState,
						detail.formName,
					),
				);
				if (path) void send("files.open", { key: machineKey, path });
				return;
			}
			if (openUIAction.type === "open_route") {
				const route = resolveOpenUITemplate(
					openUIAction.route,
					detail.formState,
					detail.formName,
				).trim();
				if (isAllowedOpenUIRoute(route)) navigate(route);
			}
		},
		[machineKey, navigate, send],
	);

	if (!visual.path) {
		return (
			<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
				<LayoutDashboard size={22} className="text-muted-foreground" />
				<p className="max-w-sm text-xs text-muted-foreground">
					{t("memonComputer.visualize.empty")}
				</p>
				<button
					type="button"
					onClick={() =>
						void send("files.open", {
							key: machineKey,
							path: `${home}/${MEMON_VISUALS_DIR}`,
						})
					}
					className="inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-[11px] font-medium hover:bg-accent"
				>
					<FolderOpen size={12} />
					{t("memonComputer.visualize.openFolder")}
				</button>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
				<span
					className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground"
					title={visual.path}
				>
					{memonDisplayPath(visual.path, home)}
				</span>
				<div className="flex h-7 shrink-0 items-center rounded border border-border p-0.5 text-[11px]">
					{[false, true].map((source) => (
						<button
							key={String(source)}
							type="button"
							aria-pressed={showSource === source}
							onClick={() => setShowSource(source)}
							className={cn(
								"inline-flex h-full items-center gap-1 rounded px-2 font-medium",
								showSource === source
									? "bg-muted text-foreground"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							{source ? <Code2 size={12} /> : <LayoutDashboard size={12} />}
							{source
								? t("memonComputer.visualize.source")
								: t("memonComputer.visualize.visual")}
						</button>
					))}
				</div>
				{dirty ? (
					<button
						type="button"
						onClick={() =>
							void send("visual.save", { key: machineKey, source: draft })
						}
						className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-input bg-background px-2 text-[11px] font-medium hover:bg-accent"
					>
						<Save size={12} />
						{t("memonComputer.save")}
					</button>
				) : null}
			</div>
			{showSource ? (
				<textarea
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					spellCheck={false}
					aria-label={t("memonComputer.visualize.source")}
					className="min-h-0 flex-1 resize-none bg-background p-3 font-mono text-[11px] leading-relaxed outline-none"
				/>
			) : (
				<div className="min-h-0 flex-1 overflow-auto p-3">
					<OpenUIRenderer
						// What the user typed in the source shows as it would be saved.
						content={draft}
						streaming={false}
						deferred
						stateKey={`memon-visual:${visual.path}`}
						configuredTheme={visual.theme}
						onMessageAction={onMessageAction}
					/>
				</div>
			)}
		</div>
	);
};
