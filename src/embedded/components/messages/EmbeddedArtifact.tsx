import React from "react";
import { useEmbeddedTranslation } from "@/embedded/hooks/use-embedded-language";
import type { MessageContentSegment } from "@/main/modules/chat/components/artifacts/artifact-protocol";

export const EmbeddedArtifact: React.FC<{
	segment: Extract<MessageContentSegment, { kind: "artifact" }>;
}> = ({ segment }) => {
	const t = useEmbeddedTranslation("messageRenderer");
	const title =
		segment.title ||
		(segment.type === "url"
			? t("urlArtifact")
			: segment.type === "hyperframes"
				? t("videoArtifact")
				: t("htmlArtifact"));

	const openUrl = () => {
		if (segment.type === "url" && segment.content.trim()) {
			window.open(segment.content.trim(), "_blank", "noopener,noreferrer");
		}
	};

	return (
		<div className="memorall-artifact-card">
			<div className="memorall-artifact-header">
				<div className="memorall-artifact-title">{title}</div>
				{segment.type === "url" && (
					<button
						type="button"
						className="memorall-artifact-open"
						onClick={openUrl}
					>
						{t("open")}
					</button>
				)}
			</div>
			{segment.type === "hyperframes" ? (
				// A video needs the packaged HyperFrames runtimes, which a page's
				// dock cannot load: point to where it plays.
				<div className="memorall-artifact-url">
					<div className="memorall-artifact-url-text">
						{t("videoArtifactHint")}
					</div>
				</div>
			) : segment.type === "html" ? (
				<iframe
					className="memorall-artifact-frame"
					title={title}
					sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
					srcDoc={segment.content}
				/>
			) : (
				<div className="memorall-artifact-url">
					<div className="memorall-artifact-url-text">{segment.content}</div>
					{/^https?:\/\//i.test(segment.content.trim()) && (
						<iframe
							className="memorall-artifact-frame memorall-artifact-frame--url"
							title={title}
							sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
							src={segment.content.trim()}
						/>
					)}
				</div>
			)}
		</div>
	);
};
