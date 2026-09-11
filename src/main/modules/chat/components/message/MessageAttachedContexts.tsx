import type React from "react";
import {
	Code2,
	Image,
	MousePointerSquareDashed,
	TextQuote,
} from "lucide-react";

/**
 * What a co-agent turn attached, shown the way the composer showed it.
 *
 * Deliberately the same chip as an attached document: from the reader's side
 * these are the same thing — something carried along with the question — and
 * two different treatments would only invite the question of what the
 * difference is.
 */

export interface AttachedContextRef {
	kind: "text" | "html" | "screenshot" | "anchor";
	label: string;
}

const ICONS = {
	text: TextQuote,
	html: Code2,
	screenshot: Image,
	anchor: MousePointerSquareDashed,
} as const;

export const MessageAttachedContexts: React.FC<{
	contexts: AttachedContextRef[];
}> = ({ contexts }) => {
	if (contexts.length === 0) return null;

	return (
		<div
			className="mb-2 flex flex-wrap gap-2"
			data-testid="message-attached-contexts"
		>
			{contexts.map((context, index) => {
				const Icon = ICONS[context.kind] ?? TextQuote;
				return (
					<div
						key={`${context.kind}-${context.label}-${index}`}
						className="inline-flex max-w-60 items-center gap-2 rounded-md border border-border/70 bg-muted/20 px-2.5 py-1.5 text-xs"
						title={context.label}
					>
						<span className="shrink-0 text-muted-foreground">
							<Icon size={14} />
						</span>
						<span className="truncate text-foreground">{context.label}</span>
					</div>
				);
			})}
		</div>
	);
};
