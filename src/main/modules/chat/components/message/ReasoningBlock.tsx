import React, { useMemo } from "react";
import { useTheme } from "@/main/components/molecules/ThemeContext";
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
		const components = useMemo(
			() =>
				createMarkdownComponents({
					isDark: actualTheme === "dark",
					isStreaming: isThinking,
					showCodeBlockSave: false,
				}),
			[actualTheme, isThinking],
		);

		return (
			<ThinkingSections
				// Remounted when thinking ends, so it starts folded from then on.
				key={isThinking ? "thinking" : "thought"}
				thinking={[text]}
				hasIncompleteThinking={isThinking}
				isStreaming={isThinking}
				components={components}
			/>
		);
	});

ReasoningBlock.displayName = "ReasoningBlock";

export default ReasoningBlock;
