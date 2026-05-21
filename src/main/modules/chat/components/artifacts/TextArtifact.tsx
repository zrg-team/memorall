import React from "react";
import type { ArtifactProps } from "./ArtifactActionsMenu";

export const TextArtifact: React.FC<ArtifactProps> = ({ content }) => (
	<pre className="my-2 max-h-96 overflow-auto rounded-md border border-border/70 bg-muted/10 p-3 text-xs leading-relaxed text-muted-foreground">
		{content}
	</pre>
);
