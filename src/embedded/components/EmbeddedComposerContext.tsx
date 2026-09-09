import type React from "react";
import { useEmbeddedTranslation } from "@/embedded/hooks/use-embedded-language";
import type { EmbeddedContextItem } from "@/embedded/types";

interface EmbeddedComposerContextProps {
	attachedContexts: EmbeddedContextItem[];
	onRemoveAttachedContext: (contextItemId: string) => void;
}

const IMAGE_KINDS = new Set([
	"screenshot",
	"viewport_screenshot",
	"selected_image",
]);

const describe = (contextItem: EmbeddedContextItem): string => {
	if (IMAGE_KINDS.has(contextItem.kind)) return contextItem.label;
	const length = contextItem.content?.length ?? 0;
	if (!length) return contextItem.label;
	const size =
		length >= 1000 ? `${(length / 1000).toFixed(1)}k` : String(length);
	return `${contextItem.label} · ${size}`;
};

/**
 * What is actually going to the agent, shown on the composer itself.
 *
 * Attachments were only visible in the context section further up the panel,
 * which collapses — so at the moment of sending there was nothing on screen
 * saying which page content, if any, was riding along with the message.
 */
export const EmbeddedComposerContext: React.FC<
	EmbeddedComposerContextProps
> = ({ attachedContexts, onRemoveAttachedContext }) => {
	const tContext = useEmbeddedTranslation("contextSection");

	if (attachedContexts.length === 0) return null;

	return (
		<div className="memorall-composer-context">
			<span className="memorall-composer-context-label">
				{tContext("attachedContexts")}
			</span>
			<div className="memorall-composer-context-chips">
				{attachedContexts.map((contextItem) => (
					<span className="memorall-composer-chip" key={contextItem.id}>
						<span className="memorall-composer-chip-text">
							{describe(contextItem)}
						</span>
						<button
							type="button"
							className="memorall-composer-chip-remove"
							aria-label={`${tContext("removeAttachment")}: ${contextItem.label}`}
							title={tContext("removeAttachment")}
							onClick={() => onRemoveAttachedContext(contextItem.id)}
							onKeyDown={(event) => event.stopPropagation()}
							onKeyUp={(event) => event.stopPropagation()}
						>
							<svg
								aria-hidden="true"
								fill="none"
								height="12"
								stroke="currentColor"
								strokeWidth="2.2"
								viewBox="0 0 24 24"
								width="12"
							>
								<path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
							</svg>
						</button>
					</span>
				))}
			</div>
		</div>
	);
};

export default EmbeddedComposerContext;
