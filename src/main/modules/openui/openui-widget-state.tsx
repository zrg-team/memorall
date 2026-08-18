import React, { createContext, useCallback, useContext, useState } from "react";
import {
	readOpenUIState,
	writeOpenUIState,
} from "@/main/modules/openui/openui-form-state";

/**
 * Widget state that survives the message scrolling out of view.
 *
 * Form fields persist through the renderer's own state map. The interactive
 * widgets do not: an expanded CollapsibleBlock, the selected tab of a TabsBlock
 * and a carousel's position all live in component state — Radix's own in one
 * theme, a `useState` in another — so `DeferredMount` dropping the subtree threw
 * them away, and scrolling back re-collapsed everything the reader had opened.
 *
 * Stored beside the form values under the same block key, in a separate `#widget`
 * bucket so writing one cannot clobber the other. Reads happen once per mount and
 * writes are plain Map writes that notify nobody, so opening a section in a long
 * conversation re-renders that section and nothing else.
 *
 * Identity is the block key plus the name the component passes — usually its
 * label. Two sections with the same label in the same block therefore open
 * together; that is a visible, self-explanatory consequence, and a better one
 * than every section closing itself on scroll.
 */

const BlockKeyContext = createContext<string | undefined>(undefined);

export const OpenUIWidgetStateProvider: React.FC<{
	blockKey?: string;
	children: React.ReactNode;
}> = ({ blockKey, children }) => (
	<BlockKeyContext.Provider value={blockKey}>
		{children}
	</BlockKeyContext.Provider>
);

const widgetBucketKey = (blockKey: string) => `${blockKey}#widget`;

export function useOpenUIWidgetState<T>(
	name: string,
	initial: T,
): [T, (next: T) => void] {
	const blockKey = useContext(BlockKeyContext);

	const [value, setValue] = useState<T>(() => {
		if (!blockKey) return initial;
		const bucket = readOpenUIState(widgetBucketKey(blockKey));
		const saved = bucket?.[name];
		return saved === undefined ? initial : (saved as T);
	});

	const set = useCallback(
		(next: T) => {
			setValue(next);
			if (!blockKey) return;
			const key = widgetBucketKey(blockKey);
			// Merge, so one widget's write does not drop its neighbours'.
			writeOpenUIState(key, { ...(readOpenUIState(key) ?? {}), [name]: next });
		},
		[blockKey, name],
	);

	return [value, set];
}
