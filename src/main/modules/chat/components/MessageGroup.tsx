import dayjs from "dayjs";
import React, { useMemo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AgentIcon } from "@/components/AgentIcon";
import { MessageRenderer } from "./MessageRenderer";
import { isCoAgentSessionMarker } from "@/services/chat/coagent-session";
import { CoAgentPageDivider } from "./CoAgentPageDivider";
import {
	type CoAgentPage,
	findCoAgentPageChanges,
} from "../utils/coagent-timeline";
import type { InProgressMessage } from "../hooks/use-chat";
import type { ChatMessageGroup } from "@/main/stores/chat";
import type { MessageActionRequest } from "./artifacts/ArtifactActionsMenu";

/** Shared empty map so a collapsed group does not allocate one per render. */
const NO_PAGE_CHANGES: ReadonlyMap<string, CoAgentPage> = new Map();

const hasRenderableMessageContent = (
	message: ChatMessageGroup["messages"][number],
) => {
	// A session boundary carries no prose — being drawn is the whole of it. It
	// used to fall through every test below and get dropped here, so the divider
	// the renderer knows how to draw never reached it.
	if (isCoAgentSessionMarker(message.type)) return true;
	if (message.content) return true;
	if (message.complexContent) return true;
	if (message.parts) return true;
	if (!message.metadata || typeof message.metadata !== "object") return false;
	return (
		("actions" in message.metadata &&
			Array.isArray(message.metadata.actions) &&
			message.metadata.actions.length > 0) ||
		"error" in message.metadata
	);
};

interface MessageGroupProps {
	group: ChatMessageGroup;
	inProgressMessage?: InProgressMessage | null;
	defaultCollapsed?: boolean;
	selectedTopic?: string;
	suppressSeparator?: boolean;
	forceExpanded?: boolean;
	onLoadMessages?: (groupId: string) => Promise<void>;
	onMessageAction?: (action: MessageActionRequest) => void | Promise<void>;
}

export const MessageGroup: React.FC<MessageGroupProps> = React.memo(
	({
		group,
		inProgressMessage,
		defaultCollapsed = false,
		selectedTopic,
		suppressSeparator = false,
		forceExpanded = false,
		onLoadMessages,
		onMessageAction,
	}) => {
		const { t } = useTranslation("chat");
		const [isCollapsed, setIsCollapsed] = useState(
			defaultCollapsed && !group.isLatest,
		);

		const showCollapseControls = !group.isLatest;

		React.useEffect(() => {
			if (!forceExpanded || group.isLatest) return;

			if (!group.isLoaded) {
				void onLoadMessages?.(group.id).then(() => {
					setIsCollapsed(false);
				});
				return;
			}

			setIsCollapsed(false);
		}, [
			forceExpanded,
			group.id,
			group.isLatest,
			group.isLoaded,
			onLoadMessages,
		]);

		const toggleCollapsed = useCallback(async () => {
			if (!group.isLoaded && !group.isLatest) {
				await onLoadMessages?.(group.id);
				setIsCollapsed(false);
				return;
			}

			setIsCollapsed((prev) => !prev);
		}, [group.id, group.isLatest, group.isLoaded, onLoadMessages]);

		const separatorHeaderDate = useMemo(
			() =>
				group.separator
					? dayjs(group.separator.createdAt).format("MMM D, h:mm A")
					: "",
			[group.separator],
		);

		const showLatestEmptyIcon =
			group.isLatest && group.messages.length === 0 && !inProgressMessage;
		const displaySeparator = suppressSeparator
			? null
			: group.separator ||
				(showLatestEmptyIcon ? group.previousSeparator : null);

		const separatorDate = useMemo(
			() =>
				displaySeparator
					? dayjs(displaySeparator.createdAt).format("MMM D, YYYY h:mm A")
					: "",
			[displaySeparator],
		);

		const shouldRenderMessages = !isCollapsed && group.isLoaded;

		// Where each stretch of co-agent turns was asked. Derived from the turns
		// themselves rather than stored, so it also reads back sessions recorded
		// before any of this existed.
		const pageChanges = useMemo(
			() =>
				shouldRenderMessages
					? findCoAgentPageChanges(group.messages)
					: NO_PAGE_CHANGES,
			[group.messages, shouldRenderMessages],
		);

		const messageComponents = useMemo(() => {
			if (!shouldRenderMessages) return null;

			let seenPageChange = false;

			return group.messages.map((message, index) => {
				if (!hasRenderableMessageContent(message)) return undefined;

				const renderer = (
					<MessageRenderer
						message={message}
						index={index}
						isLastMessage={false}
						isStreaming={false}
						groupMessages={group.messages}
						selectedTopic={selectedTopic}
						onMessageAction={onMessageAction}
					/>
				);

				const page = pageChanges.get(message.id);
				if (!page) {
					return <React.Fragment key={message.id}>{renderer}</React.Fragment>;
				}

				const isFirst = !seenPageChange;
				seenPageChange = true;
				return (
					<React.Fragment key={message.id}>
						<CoAgentPageDivider page={page} isFirst={isFirst} />
						{renderer}
					</React.Fragment>
				);
			});
		}, [
			group.messages,
			onMessageAction,
			pageChanges,
			selectedTopic,
			shouldRenderMessages,
		]);

		const inProgressMetadata = useMemo(() => {
			if (!inProgressMessage) return null;

			return {
				actions: inProgressMessage.actions,
				executeState: inProgressMessage.executeState,
				executions: inProgressMessage.executions,
				toolExecutions: inProgressMessage.toolExecutions,
			};
		}, [
			Boolean(inProgressMessage),
			inProgressMessage?.actions,
			inProgressMessage?.executeState,
			inProgressMessage?.executions,
			inProgressMessage?.toolExecutions,
		]);

		const inProgressMessageData = useMemo(() => {
			if (!inProgressMessage) return null;

			return {
				metadata: inProgressMetadata,
				createdAt: new Date(),
				updatedAt: new Date(),
				...inProgressMessage,
				content: inProgressMessage.content || "",
				id: inProgressMessage.id,
				conversationId: "",
				type: "",
				role: "assistant" as const,
				complexContent: inProgressMessage.complexContent,
				parts: inProgressMessage.parts,
				topicId: null,
				embedding: null,
				embeddingSmall: null,
				embeddingLarge: null,
			};
		}, [inProgressMessage, inProgressMetadata]);

		const inProgressMessageComponent = useMemo(() => {
			return inProgressMessageData ? (
				<MessageRenderer
					key={inProgressMessageData.id}
					message={inProgressMessageData}
					index={0}
					isLastMessage={true}
					isStreaming={true}
					onMessageAction={onMessageAction}
				/>
			) : undefined;
		}, [inProgressMessageData, onMessageAction]);

		return (
			<div className="message-group">
				{showCollapseControls && (
					<button
						type="button"
						className="mb-3 flex w-full items-center gap-2 rounded-full border border-border/60 bg-background/70 px-3 py-2 text-left shadow-sm transition-colors duration-150 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						onClick={() => void toggleCollapsed()}
						aria-expanded={!isCollapsed}
					>
						<div className="text-muted-foreground hover:text-foreground transition-colors duration-150">
							{isCollapsed ? (
								<ChevronRight
									size={14}
									className="transition-transform duration-200"
								/>
							) : (
								<ChevronDown
									size={14}
									className="transition-transform duration-200"
								/>
							)}
						</div>
						<span className="text-xs text-muted-foreground flex-1">
							{group.isLoading
								? "Loading messages..."
								: !group.isLoaded
									? "Load messages"
									: t("messages.count", { count: group.messages.length })}
							{separatorHeaderDate && (
								<span className="ml-2">• {separatorHeaderDate}</span>
							)}
						</span>
					</button>
				)}

				{shouldRenderMessages && (
					<div className="space-y-5">
						{messageComponents}
						{inProgressMessageComponent}
					</div>
				)}

				{displaySeparator || showLatestEmptyIcon ? (
					<div className="my-6 flex flex-col items-center gap-3">
						{displaySeparator ? (
							<div className="flex w-full items-center">
								<div className="flex-1 border-t border-border/60"></div>
								<div className="mx-4 rounded-full border border-border/60 bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
									{separatorDate}
								</div>
								<div className="flex-1 border-t border-border/60"></div>
							</div>
						) : null}
						{showLatestEmptyIcon ? (
							<div className="flex h-24 w-24 items-center justify-center">
								<AgentIcon size={96} aria-label="Agent" />
							</div>
						) : null}
					</div>
				) : null}
			</div>
		);
	},
);
