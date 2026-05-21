import React from "react";
import MarkdownMessage from "../MarkdownMessage";
import type { ArtifactProps } from "./ArtifactActionsMenu";

export const MarkdownArtifact: React.FC<ArtifactProps> = ({ content }) => (
	<div className="my-2 rounded-md border border-border/70 bg-muted/10 p-3">
		<MarkdownMessage>{content}</MarkdownMessage>
	</div>
);
