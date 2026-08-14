import {
	MessageSquare,
	MessageSquarePlus,
	PanelLeftClose,
	PanelLeftOpen,
	X,
} from "lucide-react";
import type React from "react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import { useChatStore } from "@/main/stores/chat";
import { CollapsedRailItem } from "./CollapsedRailItem";
import { ConversationListSection } from "./ConversationListSection";

interface ChatSidePanelProps {
	onShowConversationGroup?: (groupId: string) => void;
	defaultCollapsed?: boolean;
	allowCollapse?: boolean;
	allowResize?: boolean;
	showCollapsedToggle?: boolean;
	onClose?: () => void;
}

const COLLAPSED_STORAGE_KEY = "memorall.chatSidebar.collapsed";
const WIDTH_STORAGE_KEY = "memorall.chatSidebar.width";

const readStoredCollapsed = (fallback: boolean): boolean => {
	if (typeof window === "undefined") return fallback;
	const stored = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
	return stored === null ? fallback : stored === "true";
};

const readStoredWidth = (): number => {
	if (typeof window === "undefined") return 288;
	const stored = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY));
	return Number.isFinite(stored) && stored >= 240 && stored <= 480
		? stored
		: 288;
};

export const ChatSidePanel: React.FC<ChatSidePanelProps> = ({
	defaultCollapsed = false,
	allowCollapse = true,
	allowResize = true,
	showCollapsedToggle = true,
	onClose,
}) => {
	const conversations = useChatStore((state) => state.conversations);
	const currentConversation = useChatStore(
		(state) => state.currentConversation,
	);
	const createNewConversation = useChatStore(
		(state) => state.createNewConversation,
	);
	const loadConversations = useChatStore((state) => state.loadConversations);
	const { t } = useTranslation("chat");
	const [collapsed, setCollapsed] = useState(() =>
		allowCollapse ? readStoredCollapsed(defaultCollapsed) : false,
	);
	const [width, setWidth] = useState(readStoredWidth);
	const isDraggingRef = useRef(false);
	const dragStartXRef = useRef(0);
	const dragStartWidthRef = useRef(0);
	const conversationCount = Math.max(
		conversations.length,
		currentConversation ? 1 : 0,
	);

	const updateCollapsed = (nextCollapsed: boolean) => {
		setCollapsed(nextCollapsed);
		window.localStorage.setItem(COLLAPSED_STORAGE_KEY, String(nextCollapsed));
	};

	const updateWidth = (nextWidth: number) => {
		const constrained = Math.max(240, Math.min(480, nextWidth));
		setWidth(constrained);
		window.localStorage.setItem(WIDTH_STORAGE_KEY, String(constrained));
	};

	const handleNewConversation = async () => {
		await createNewConversation();
		await loadConversations();
	};

	const handleResizeMouseDown = (event: React.MouseEvent) => {
		event.preventDefault();
		isDraggingRef.current = true;
		dragStartXRef.current = event.clientX;
		dragStartWidthRef.current = width;

		const onMouseMove = (moveEvent: MouseEvent) => {
			if (!isDraggingRef.current) return;
			updateWidth(
				dragStartWidthRef.current + moveEvent.clientX - dragStartXRef.current,
			);
		};

		const onMouseUp = () => {
			isDraggingRef.current = false;
			window.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("mouseup", onMouseUp);
		};

		window.addEventListener("mousemove", onMouseMove);
		window.addEventListener("mouseup", onMouseUp);
	};

	return (
		<aside
			className="relative z-10 h-full min-h-0 flex-shrink-0 transition-[width] duration-200 ease-out"
			style={
				allowCollapse && collapsed
					? { width: 56 }
					: allowResize
						? { width, maxWidth: "100%" }
						: { width: "100%" }
			}
			aria-label={t("sidebar.label")}
		>
			<div
				className={cn(
					"flex h-full min-h-0 flex-col border-r border-border/70",
					collapsed ? "bg-background" : "bg-card/80 backdrop-blur-xl",
				)}
			>
				<header
					className={cn(
						"flex h-[58px] flex-shrink-0 items-center border-b border-border/70",
						collapsed ? "justify-center px-0" : "gap-2 px-3",
					)}
				>
					{allowCollapse && collapsed ? (
						showCollapsedToggle ? (
							<Button
								type="button"
								variant="ghost"
								size="icon"
								onClick={() => updateCollapsed(false)}
								className="h-10 w-10 text-muted-foreground hover:bg-muted hover:text-foreground"
								aria-label={t("sidebar.expand")}
							>
								<PanelLeftOpen size={17} />
							</Button>
						) : (
							<div className="h-10 w-10" />
						)
					) : (
						<>
							<div className="min-w-0 flex-1">
								<div className="truncate text-sm font-semibold text-foreground">
									{t("sidebar.title")}
								</div>
								<div className="text-[11px] text-muted-foreground">
									{t("sidebar.count", { count: conversationCount })}
								</div>
							</div>
							{allowCollapse ? (
								<Button
									type="button"
									variant="ghost"
									size="icon"
									onClick={() => updateCollapsed(true)}
									className="h-9 w-9 text-muted-foreground hover:bg-muted hover:text-foreground"
									aria-label={t("sidebar.collapse")}
								>
									<PanelLeftClose size={17} />
								</Button>
							) : onClose ? (
								<Button
									type="button"
									variant="ghost"
									size="icon"
									onClick={onClose}
									className="h-9 w-9 text-muted-foreground hover:bg-muted hover:text-foreground"
									aria-label={t("sidebar.close")}
								>
									<X size={17} />
								</Button>
							) : null}
						</>
					)}
				</header>

				{allowCollapse && collapsed ? (
					<div className="flex w-14 flex-1 flex-col items-center gap-1 px-0 py-2">
						<CollapsedRailItem
							icon={<MessageSquare size={17} />}
							label={t("sidebar.expand")}
							count={conversationCount}
							active
							onClick={() => updateCollapsed(false)}
						/>
						<CollapsedRailItem
							icon={<MessageSquarePlus size={17} />}
							label={t("sidebar.newChat")}
							newChat
							onClick={() => void handleNewConversation()}
						/>
					</div>
				) : (
					<div className="flex min-h-0 flex-1 flex-col p-2">
						<ConversationListSection />
					</div>
				)}
			</div>

			{allowResize && !collapsed ? (
				<hr
					aria-label={t("sidebar.resize")}
					aria-orientation="vertical"
					aria-valuemin={240}
					aria-valuemax={480}
					aria-valuenow={width}
					tabIndex={0}
					onMouseDown={handleResizeMouseDown}
					onKeyDown={(event) => {
						if (event.key === "ArrowLeft") updateWidth(width - 16);
						if (event.key === "ArrowRight") updateWidth(width + 16);
					}}
					className="absolute bottom-0 right-0 top-0 w-1 cursor-col-resize border-0 bg-transparent transition-colors hover:bg-primary/40 focus:bg-primary/40 focus:outline-none"
				/>
			) : null}
		</aside>
	);
};
