import React, { useMemo } from "react";
import { EmbeddedMarkdown } from "@/embedded/components/EmbeddedMarkdown";
import { parseArtifactSegments } from "@/main/modules/chat/components/artifacts/artifact-protocol";
import { EmbeddedArtifact } from "./EmbeddedArtifact";
import type { MessageActionRequest } from "@/main/modules/chat/components/artifacts/ArtifactActionsMenu";
import { OpenUIRenderer } from "@/main/modules/openui/OpenUIRenderer";
import { splitOpenUIContent } from "@/utils/openui";

export const AssistantMessageContent: React.FC<{
	content: string;
	isStreaming: boolean;
	onMessageAction?: (action: MessageActionRequest) => void | Promise<void>;
}> = ({ content, isStreaming, onMessageAction }) => {
	const segments = useMemo(
		() => splitOpenUIContent(content, { includeIncomplete: isStreaming }),
		[content, isStreaming],
	);

	const renderTextSegment = (text: string, keyPrefix: string) =>
		parseArtifactSegments(text).map((segment, index) =>
			segment.kind === "artifact" ? (
				<EmbeddedArtifact
					key={`${keyPrefix}-artifact-${segment.identifier ?? index}`}
					segment={segment}
				/>
			) : segment.text.trim() ? (
				<EmbeddedMarkdown
					key={`${keyPrefix}-text-${index}`}
					content={segment.text}
					isStreaming={isStreaming}
				/>
			) : null,
		);

	let openuiCount = 0;
	let textCount = 0;
	return (
		<div className="memorall-assistant-content">
			{segments.map((segment) => {
				if (segment.kind === "openui") {
					return (
						<div
							key={`openui-${openuiCount++}`}
							className="memorall-openui-content"
						>
							<OpenUIRenderer
								content={segment.content}
								streaming={isStreaming}
								onMessageAction={onMessageAction}
							/>
						</div>
					);
				}

				return renderTextSegment(segment.text, `segment-${textCount++}`);
			})}
		</div>
	);
};
