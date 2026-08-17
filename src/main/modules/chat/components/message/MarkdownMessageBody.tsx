import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { useTheme } from "@/main/components/molecules/ThemeContext";
import {
	createMarkdownComponents,
	rehypePlugins,
	remarkPlugins,
} from "./markdownComponents";
import { parseThinkTags } from "./parseThinkTags";
import { ThinkingSections } from "./ThinkingSections";

export type MarkdownPluginList = React.ComponentProps<
	typeof ReactMarkdown
>["remarkPlugins"];

export interface MarkdownMessageBodyProps {
	className?: string;
	isStreaming?: boolean;
	children?: string;
	remarkPluginsOverride?: MarkdownPluginList;
	rehypePluginsOverride?: React.ComponentProps<
		typeof ReactMarkdown
	>["rehypePlugins"];
	/** Hosts that already own the file (e.g. the Skills editor) opt out. */
	showCodeBlockSave?: boolean;
}

export const MarkdownMessageBody: React.FC<MarkdownMessageBodyProps> = ({
	className,
	children,
	isStreaming = false,
	remarkPluginsOverride = remarkPlugins,
	rehypePluginsOverride = rehypePlugins,
	showCodeBlockSave = true,
}) => {
	const { actualTheme } = useTheme();
	const isDark = actualTheme === "dark";

	const { thinking, content, hasIncompleteThinking } = useMemo(() => {
		if (!children)
			return { thinking: [], content: "", hasIncompleteThinking: false };
		return parseThinkTags(children, isStreaming);
	}, [children, isStreaming]);

	const themeAwareComponents = useMemo(
		() => createMarkdownComponents({ isDark, isStreaming, showCodeBlockSave }),
		[isDark, isStreaming, showCodeBlockSave],
	);

	return (
		<div
			className={cn(
				"markdown-body",
				"[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
				className,
			)}
		>
			<ThinkingSections
				thinking={thinking}
				hasIncompleteThinking={hasIncompleteThinking}
				isStreaming={isStreaming}
				components={themeAwareComponents}
			/>

			<ReactMarkdown
				remarkPlugins={remarkPluginsOverride}
				rehypePlugins={rehypePluginsOverride}
				components={themeAwareComponents}
			>
				{content || ""}
			</ReactMarkdown>
		</div>
	);
};
