import React, { lazy, useMemo, useRef } from "react";
import { OpenUIRenderer } from "@/main/modules/openui/OpenUIRenderer";
import { createAppendAwareOpenUISplitter } from "@/utils/openui";
import { ArtifactRenderer } from "../artifacts/ArtifactRenderer";
import { parseArtifactSegments } from "../artifacts/artifact-protocol";
import type { MessageActionRequest } from "../artifacts/ArtifactActionsMenu";
import { CompactArtifactReference } from "./CompactArtifactReference";
import { DeferredMount } from "./DeferredMount";
import { assignContentSegmentKeys } from "./stable-part-keys";
import { useThrottledValue } from "@/main/modules/openui/use-throttled-value";

const USE_STREAMDOWN = false;
const Streamdown = lazy(() => import("../MessageStreamDown"));
const MarkdownMessage = lazy(() => import("../MarkdownMessage"));
const ContentComponent = USE_STREAMDOWN ? Streamdown : MarkdownMessage;

interface MessageContentWithArtifactsProps {
	content: string;
	isStreaming: boolean;
	suppressArtifactPreviews?: boolean;
	onMessageAction?: (action: MessageActionRequest) => void | Promise<void>;
	seenArtifactKeys?: Set<string>;
}

const MessageContentFrame: React.FC<MessageContentWithArtifactsProps> =
	React.memo(
		({
			content,
			isStreaming,
			suppressArtifactPreviews = false,
			onMessageAction,
			seenArtifactKeys,
		}) => {
			const openUISplitterRef = useRef<ReturnType<
				typeof createAppendAwareOpenUISplitter
			> | null>(null);
			openUISplitterRef.current ??= createAppendAwareOpenUISplitter();
			const segments = useMemo(
				() =>
					openUISplitterRef.current!.split(content, {
						includeIncomplete: isStreaming,
					}),
				[content, isStreaming],
			);

			const renderTextWithArtifacts = (text: string, keyPrefix: string) => {
				const artifactSegments = parseArtifactSegments(text);

				return artifactSegments.map((seg, i) => {
					if (seg.kind === "artifact") {
						// Key by ordinal position, not mutable offsets. Streaming only appends,
						// so the ordinal is stable for a given block and avoids remounting the
						// artifact iframe on every token.
						const key = `${keyPrefix}-artifact-${i}-${seg.type}`;
						if (seenArtifactKeys) {
							const dedupeKey = `${seg.type}:${seg.identifier ?? ""}:${seg.title ?? ""}:${seg.content}`;
							if (seenArtifactKeys.has(dedupeKey)) return null;
							seenArtifactKeys.add(dedupeKey);
						}
						if (suppressArtifactPreviews) {
							return (
								<CompactArtifactReference
									key={key}
									type={seg.type}
									title={seg.title}
									identifier={seg.identifier}
								/>
							);
						}

						return (
							<DeferredMount
								key={key}
								enabled={!isStreaming}
								className="space-y-3"
							>
								<ArtifactRenderer
									type={seg.type}
									content={seg.content}
									identifier={seg.identifier}
									title={seg.title}
									projectPath={seg.projectPath}
									onMessageAction={onMessageAction}
								/>
								<div className="border-t border-border/40" />
							</DeferredMount>
						);
					}
					const text = seg.text;
					if (!text.trim()) return null;
					// Key by ordinal position so the streamed markdown block reconciles in place
					// instead of unmounting+remounting (which re-parsed the whole block) on every
					// token as its length changed.
					return (
						<ContentComponent
							key={`${keyPrefix}-text-${i}`}
							isStreaming={isStreaming}
						>
							{text}
						</ContentComponent>
					);
				});
			};

			return (
				<>
					{assignContentSegmentKeys(segments).map(({ segment: seg, key }) => {
						if (seg.kind === "openui") {
							return (
								<DeferredMount key={key} enabled={!isStreaming}>
									<OpenUIRenderer
										content={seg.content}
										streaming={isStreaming}
										deferred
										onMessageAction={onMessageAction}
									/>
								</DeferredMount>
							);
						}

						return renderTextWithArtifacts(seg.text, key);
					})}
				</>
			);
		},
	);

MessageContentFrame.displayName = "MessageContentFrame";

export const MessageContentWithArtifacts: React.FC<
	MessageContentWithArtifactsProps
> = (props) => {
	// Markdown, artifact segmentation, and OpenUI detection all scan the growing
	// response. Capping that work at ~20fps keeps token streaming fluid without
	// sacrificing the synchronous final frame.
	const renderContent = useThrottledValue(props.content, props.isStreaming, 48);

	return <MessageContentFrame {...props} content={renderContent} />;
};
