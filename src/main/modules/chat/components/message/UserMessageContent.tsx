import React, { useMemo, useState } from "react";
import {
	Check,
	ChevronDown,
	Code2,
	Copy,
	FileText,
	Globe2,
	Image,
} from "lucide-react";
import { EMBEDDED_CONTEXT_TAG_CONFIG } from "@/embedded/context-items";
import { cn } from "@/lib/utils";
import { MessageContentWithArtifacts } from "./MessageContentWithArtifacts";

type UserContextSection = {
	type: "text" | "html" | "screenshot";
	content: string;
	label: string;
};

type ParsedUserContext = {
	hasContext: boolean;
	userMessage: string;
	websiteInfo?: {
		title: string;
		url: string;
	};
	sections: UserContextSection[];
};

const parseUserContext = (content: string): ParsedUserContext => {
	const contextMatch = content.match(/<context>([\s\S]*?)<\/context>/);
	if (!contextMatch) {
		return {
			hasContext: false,
			userMessage: content,
			sections: [],
		};
	}

	const contextContent = contextMatch[1] ?? "";
	const beforeContext = content.slice(0, contextMatch.index).trim();
	const afterContext = content
		.slice((contextMatch.index ?? 0) + contextMatch[0].length)
		.trim();
	const websiteMatch = contextContent.match(/<website>([\s\S]*?)<\/website>/);
	const websiteInner = websiteMatch?.[1] ?? "";
	const title = websiteInner.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim();
	const url = websiteInner.match(/<url>([\s\S]*?)<\/url>/)?.[1]?.trim();
	const tagPattern = Object.keys(EMBEDDED_CONTEXT_TAG_CONFIG).join("|");
	const sectionRegex = new RegExp(`<(${tagPattern})>([\\s\\S]*?)<\\/\\1>`, "g");
	const sections: UserContextSection[] = [];

	for (const match of contextContent.matchAll(sectionRegex)) {
		const tag = match[1];
		const sectionConfig = EMBEDDED_CONTEXT_TAG_CONFIG[tag];
		if (!sectionConfig) continue;

		sections.push({
			type: sectionConfig.displayType,
			content: match[2].trim(),
			label: sectionConfig.renderLabel,
		});
	}

	return {
		hasContext: true,
		userMessage: [beforeContext, afterContext].filter(Boolean).join("\n\n"),
		websiteInfo:
			title || url
				? {
						title: title || "Website",
						url: url || "",
					}
				: undefined,
		sections,
	};
};

const getContextSectionIcon = (type: UserContextSection["type"]) => {
	if (type === "html") return Code2;
	if (type === "screenshot") return Image;
	return FileText;
};

const UserContextSectionCard: React.FC<{
	section: UserContextSection;
}> = ({ section }) => {
	const [isExpanded, setIsExpanded] = useState(false);
	const [isCopied, setIsCopied] = useState(false);
	const Icon = getContextSectionIcon(section.type);

	const handleCopy = async (event: React.MouseEvent) => {
		event.stopPropagation();
		try {
			await navigator.clipboard.writeText(section.content);
			setIsCopied(true);
			window.setTimeout(() => setIsCopied(false), 1800);
		} catch {
			setIsCopied(false);
		}
	};

	return (
		<div className="overflow-hidden rounded-lg border border-border/60 bg-muted/20">
			<div className="flex items-center gap-2 px-3 py-2">
				<button
					type="button"
					className="flex min-w-0 flex-1 items-center gap-2 text-left"
					onClick={() => setIsExpanded((value) => !value)}
				>
					<Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
					<span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
						{section.label}
					</span>
					<ChevronDown
						className={cn(
							"h-4 w-4 shrink-0 text-muted-foreground transition-transform",
							isExpanded && "rotate-180",
						)}
					/>
				</button>
				<button
					type="button"
					className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					title={isCopied ? "Copied" : "Copy context"}
					onClick={handleCopy}
				>
					{isCopied ? (
						<Check className="h-4 w-4 text-green-500" />
					) : (
						<Copy className="h-4 w-4" />
					)}
				</button>
			</div>
			{isExpanded ? (
				<div className="border-t border-border/60 px-3 py-2">
					{section.type === "screenshot" ? (
						<p className="text-xs italic text-muted-foreground">
							{section.content}
						</p>
					) : (
						<pre
							className={cn(
								"max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground",
								section.type === "html" ? "font-mono" : "font-sans",
							)}
						>
							{section.content}
						</pre>
					)}
				</div>
			) : null}
		</div>
	);
};

export const UserMessageContent: React.FC<{
	content: string;
	isStreaming: boolean;
	messageId?: string;
}> = ({ content, isStreaming, messageId }) => {
	const parsed = useMemo(() => parseUserContext(content), [content]);

	if (!parsed.hasContext) {
		// A typed message is prose the sender line-broke by hand, so its soft
		// breaks are meaningful even though Markdown would collapse them. The
		// class opts this subtree — and only this one — back into preserved
		// breaks inside paragraphs; see `.markdown-preserve-breaks`.
		return (
			<div className="markdown-preserve-breaks">
				<MessageContentWithArtifacts
					content={content}
					isStreaming={isStreaming}
					blockScope={messageId}
				/>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			{parsed.userMessage ? (
				<div className="whitespace-pre-wrap break-words">
					{parsed.userMessage}
				</div>
			) : null}
			<div className="space-y-2">
				{parsed.websiteInfo ? (
					<div className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
						<Globe2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
						<div className="min-w-0 flex-1">
							<div className="truncate text-xs font-medium text-foreground">
								{parsed.websiteInfo.title}
							</div>
							{parsed.websiteInfo.url ? (
								<div className="mt-0.5 truncate text-xs text-muted-foreground">
									{parsed.websiteInfo.url}
								</div>
							) : null}
						</div>
					</div>
				) : null}
				{parsed.sections.map((section, index) => (
					<UserContextSectionCard
						key={`${section.label}-${index}`}
						section={section}
					/>
				))}
			</div>
		</div>
	);
};
