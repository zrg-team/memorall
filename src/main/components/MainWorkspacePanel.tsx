import type React from "react";
import { Suspense, lazy, useEffect, useState } from "react";
import { WorkspaceHeaderSlotContext } from "@/main/components/workspace-header-slot";
import { WorkspaceModeSwitcher } from "@/main/modules/studio/components/WorkspaceModeSwitcher";
import { ChatPage } from "@/main/pages/ChatPage";
import {
	CHAT_INSERT_TEXT_EVENT,
	useWorkspaceModeStore,
} from "@/main/stores/workspace-mode";

const StudioPage = lazy(() =>
	import("@/main/modules/studio/components/StudioPage").then((module) => ({
		default: module.StudioPage,
	})),
);

type ChatPageProps = React.ComponentProps<typeof ChatPage>;

interface MainWorkspacePanelProps extends ChatPageProps {
	/**
	 * Pixels the shell's own controls cover at the header's end (its floating
	 * navigation on narrow layouts, its panel toggle on wide ones).
	 */
	headerInsetEnd?: number;
}

/**
 * The main panel: chat, or the studio for whichever kind of model is active.
 *
 * Branches here rather than inside ChatPage so a studio never mounts the chat
 * page's hooks, its chat-model gating or its message stores - and chat renders
 * exactly as it did before studios existed.
 */
export const MainWorkspacePanel: React.FC<MainWorkspacePanelProps> = ({
	headerInsetEnd,
	...chatProps
}) => {
	const mode = useWorkspaceModeStore((state) => state.mode);
	const hydrate = useWorkspaceModeStore((state) => state.hydrate);
	const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);

	useEffect(() => {
		void hydrate();
	}, [hydrate]);

	useEffect(() => {
		const onInsert = (event: Event) => {
			const text = (event as CustomEvent<{ text?: string }>).detail?.text;
			if (text?.trim()) {
				useWorkspaceModeStore.getState().sendTextToChat(text);
			}
		};
		window.addEventListener(CHAT_INSERT_TEXT_EVENT, onInsert);
		return () => window.removeEventListener(CHAT_INSERT_TEXT_EVENT, onInsert);
	}, []);

	return (
		<div className="flex h-full min-h-0 flex-col" data-main-workspace={mode}>
			{/* Same height and glass as the right workspace nav, so the app has one
			    header line. The shell says how much of the end its own controls
			    cover; otherwise the actions sit flush right. */}
			<header
				className="z-20 flex h-12 shrink-0 items-center gap-2 px-2"
				style={{
					background: "var(--header-glass)",
					borderBottom: "1px solid var(--glass-border)",
					...(headerInsetEnd ? { paddingRight: headerInsetEnd } : {}),
				}}
				data-workspace-header
			>
				<WorkspaceModeSwitcher compact={chatProps.isNarrowChatPanel} />
				<div
					ref={setHeaderSlot}
					className="ml-auto flex min-w-0 items-center gap-1"
					data-workspace-header-actions
				/>
			</header>
			<div className="min-h-0 flex-1">
				<WorkspaceHeaderSlotContext.Provider value={headerSlot}>
					{mode === "chat" ? (
						<ChatPage {...chatProps} />
					) : (
						<Suspense fallback={null}>
							<StudioPage mode={mode} isNarrow={chatProps.isNarrowChatPanel} />
						</Suspense>
					)}
				</WorkspaceHeaderSlotContext.Provider>
			</div>
		</div>
	);
};
