import React from "react";
import type { ArtifactType } from "./artifact-protocol";
import { HtmlArtifact } from "./HtmlArtifact";
import { UrlArtifact } from "./UrlArtifact";
import { HyperframesArtifact } from "./HyperframesArtifact";
import { MarkdownArtifact } from "./MarkdownArtifact";
import { TextArtifact } from "./TextArtifact";

interface ArtifactRendererProps {
	type: ArtifactType;
	content: string;
	identifier?: string;
	title?: string;
}

export const ArtifactRenderer: React.FC<ArtifactRendererProps> = ({
	type,
	content,
	identifier,
	title,
}) => {
	switch (type) {
		case "html":
			return (
				<HtmlArtifact content={content} identifier={identifier} title={title} />
			);
		case "url":
			return <UrlArtifact content={content} title={title} />;
		case "hyperframes":
			return (
				<HyperframesArtifact
					content={content}
					identifier={identifier}
					title={title}
				/>
			);
		case "markdown":
			return <MarkdownArtifact content={content} />;
		case "text":
			return <TextArtifact content={content} />;
		default:
			return null;
	}
};

export { UrlArtifact } from "./UrlArtifact";
