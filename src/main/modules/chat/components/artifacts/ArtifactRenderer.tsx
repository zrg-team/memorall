import React, { Suspense, lazy } from "react";
import type { ArtifactType } from "./artifact-protocol";
import type { MessageActionRequest } from "./ArtifactActionsMenu";

const HtmlArtifact = lazy(() =>
	import("./HtmlArtifact").then((module) => ({ default: module.HtmlArtifact })),
);
const UrlArtifactLazy = lazy(() =>
	import("./UrlArtifact").then((module) => ({ default: module.UrlArtifact })),
);
const HyperframesArtifact = lazy(() =>
	import("./HyperframesArtifact").then((module) => ({
		default: module.HyperframesArtifact,
	})),
);
const LottieArtifact = lazy(() =>
	import("./LottieArtifact").then((module) => ({
		default: module.LottieArtifact,
	})),
);
const MarkdownArtifact = lazy(() =>
	import("./MarkdownArtifact").then((module) => ({
		default: module.MarkdownArtifact,
	})),
);
const TextArtifact = lazy(() =>
	import("./TextArtifact").then((module) => ({ default: module.TextArtifact })),
);

interface ArtifactRendererProps {
	type: ArtifactType;
	content: string;
	identifier?: string;
	title?: string;
	projectPath?: string;
	onMessageAction?: (action: MessageActionRequest) => void | Promise<void>;
}

export const ArtifactRenderer: React.FC<ArtifactRendererProps> = ({
	type,
	content,
	identifier,
	title,
	projectPath,
	onMessageAction,
}) => {
	const fallback = (
		<div className="my-2 rounded-md border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
			Loading artifact...
		</div>
	);

	return (
		<Suspense fallback={fallback}>
			{(() => {
				switch (type) {
					case "html":
						return (
							<HtmlArtifact
								content={content}
								identifier={identifier}
								title={title}
							/>
						);
					case "url":
						return <UrlArtifactLazy content={content} title={title} />;
					case "hyperframes":
						return (
							<HyperframesArtifact
								content={content}
								identifier={identifier}
								title={title}
								projectPath={projectPath}
								onMessageAction={onMessageAction}
							/>
						);
					case "lottie":
						return (
							<LottieArtifact
								content={content}
								identifier={identifier}
								title={title}
								onMessageAction={onMessageAction}
							/>
						);
					case "markdown":
						return <MarkdownArtifact content={content} />;
					case "text":
						return <TextArtifact content={content} />;
					default:
						return null;
				}
			})()}
		</Suspense>
	);
};

export { UrlArtifact } from "./UrlArtifact";
