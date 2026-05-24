import type React from "react";
import { lazy, useMemo } from "react";
import { OpenUIRenderer } from "@/main/modules/openui/OpenUIRenderer";
import { splitOpenUIContent } from "@/utils/openui";
import { ArtifactRenderer } from "../artifacts/ArtifactRenderer";
import { parseArtifactSegments } from "../artifacts/artifact-protocol";
import { CompactArtifactReference } from "./CompactArtifactReference";

const USE_STREAMDOWN = false;
const Streamdown = lazy(() => import("../MessageStreamDown"));
const MarkdownMessage = lazy(() => import("../MarkdownMessage"));
const ContentComponent = USE_STREAMDOWN ? Streamdown : MarkdownMessage;

export const MessageContentWithArtifacts: React.FC<{
	content: string;
	isStreaming: boolean;
	suppressArtifactPreviews?: boolean;
}> = ({ content, isStreaming, suppressArtifactPreviews = false }) => {
	const segments = useMemo(
		() => splitOpenUIContent(content, { includeIncomplete: isStreaming }),
		[content, isStreaming],
	);

	const renderTextWithArtifacts = (text: string, keyPrefix: string) => {
		const artifactSegments = parseArtifactSegments(text);

		return artifactSegments.map((seg) => {
			if (seg.kind === "artifact") {
				const key = `${keyPrefix}-artifact-${seg.type}-${seg.identifier ?? seg.blockIndex}`;
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
					<div key={key} className="space-y-3">
						<ArtifactRenderer
							type={seg.type}
							content={seg.content}
							identifier={seg.identifier}
							title={seg.title}
						/>
						<div className="border-t border-border/40" />
					</div>
				);
			}
			const text = seg.text;
			if (!text.trim()) return null;
			return (
				<ContentComponent
					key={`${keyPrefix}-text-${text.length}-${text.slice(0, 32)}`}
					isStreaming={isStreaming}
				>
					{text}
				</ContentComponent>
			);
		});
	};

	return (
		<>
			{segments.map((seg) => {
				if (seg.kind === "openui") {
					return (
						<OpenUIRenderer
							key={`openui-${seg.start}-${seg.end}`}
							content={seg.content}
							streaming={isStreaming}
						/>
					);
				}

				return renderTextWithArtifacts(
					seg.text,
					`segment-${seg.start}-${seg.end}`,
				);
			})}
		</>
	);
};
