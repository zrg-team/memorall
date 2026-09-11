/**
 * Recording what a co-agent turn carried, so the transcript can show it.
 *
 * The composer shows every attachment as a labelled chip before sending —
 * "Region 641×482", the hovered element, a block of picked text. None of that
 * survived the send: the attachment reached the model folded into the prompt,
 * and the reader was left with a question about something they could not see.
 *
 * A picture can be shown back directly, but text and HTML cannot: the whole
 * point of attaching them is that they are long. Both are recorded the same
 * way instead — as the chip the user saw when they attached it.
 */

import { EMBEDDED_CONTEXT_KIND_CONFIG } from "@/embedded/context-items";
import type { EmbeddedContextItem } from "@/embedded/types";
import {
	type CoAgentContextAnchor,
	describeContextAnchor,
} from "./context-anchor";

/** How a chip should read. `anchor` is the element the cursor was on. */
export type AttachedContextKind = "text" | "html" | "screenshot" | "anchor";

export interface AttachedContextRef {
	kind: AttachedContextKind;
	label: string;
}

const describeSelection = (item: EmbeddedContextItem): AttachedContextRef => {
	const config = EMBEDDED_CONTEXT_KIND_CONFIG[item.kind];
	return {
		kind: config?.displayType ?? "text",
		// The label the user picked it under; the stored kind name is a poor
		// substitute for "Region 641×482".
		label: item.label || config?.renderLabel || item.kind,
	};
};

/**
 * Everything a turn attached, in the order the composer showed it.
 *
 * The anchor leads because it is the thing the question is about; a selection
 * is the supporting material.
 */
export const buildAttachedContexts = ({
	anchor,
	selection,
}: {
	anchor?: CoAgentContextAnchor | null;
	selection?: EmbeddedContextItem | null;
}): AttachedContextRef[] => {
	const refs: AttachedContextRef[] = [];
	if (anchor) {
		refs.push({ kind: "anchor", label: describeContextAnchor(anchor) });
	}
	if (selection) {
		refs.push(describeSelection(selection));
	}
	return refs;
};
