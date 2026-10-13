import React, { useMemo } from "react";
import { useTheme } from "@/main/components/molecules/ThemeContext";
import { useThrottledValue } from "@/main/modules/openui/use-throttled-value";
import { createMarkdownComponents } from "./markdownComponents";
import { ThinkingSections } from "./ThinkingSections";

/**
 * What a reasoning model thought, shown the way a local model's `<think>` block
 * is. Open while it is being written; folded once the model moves on, so a long
 * thought does not push the answer out of view.
 */
export const ReasoningBlock: React.FC<{ text: string; isThinking: boolean }> =
	React.memo(({ text, isThinking }) => {
		const { actualTheme } = useTheme();
		// At most ~20 updates a second while it is written, as the answer's text
		// is: every streamed frame re-rendered the thought's markdown.
		const renderText = useThrottledValue(text, isThinking, 48);
		const components = useMemo(
			() =>
				createMarkdownComponents({
					isDark: actualTheme === "dark",
					isStreaming: isThinking,
					showCodeBlockSave: false,
				}),
			[actualTheme, isThinking],
		);
		const thinking = useMemo(() => [renderText], [renderText]);

		return (
			<ThinkingSections
				// Remounted when thinking ends, so it starts folded from then on.
				key={isThinking ? "thinking" : "thought"}
				thinking={thinking}
				hasIncompleteThinking={isThinking}
				isStreaming={isThinking}
				components={components}
			/>
		);
	});

ReasoningBlock.displayName = "ReasoningBlock";

export default ReasoningBlock;
