import React from "react";
import { Clock3, ScrollText } from "lucide-react";
import type {
	ActionRenderer,
	MessageActionItem,
} from "@/main/modules/chat/components/types";
import { defaultActionRenderer } from "./DefaultActionRenderer";
import {
	getToolCallArguments,
	ToolCodeBlock,
	ToolDetail,
	ToolDetailsGrid,
	ToolItemRawIO,
	ToolSection,
} from "./ToolCommon";

const DESCRIPTION_OUTPUT_MARKER = "\noutput:\n";

const getActionOutput = (item: MessageActionItem): string => {
	const description = item.description?.trim() || "";
	const markerIndex = description.indexOf(DESCRIPTION_OUTPUT_MARKER);

	if (markerIndex === -1) {
		return description;
	}

	return description
		.slice(markerIndex + DESCRIPTION_OUTPUT_MARKER.length)
		.trim();
};

const getStringArg = (
	args: Record<string, unknown> | null,
	key: string,
): string | undefined =>
	typeof args?.[key] === "string" ? args[key] : undefined;

const extractLoadedSkill = (
	output: string,
): { name: string; body: string } | null => {
	const match = output.match(
		/^<skill name="([^"]+)">\n?([\s\S]*?)\n?<\/skill>$/,
	);
	if (!match) {
		return null;
	}

	return {
		name: match[1],
		body: match[2].trim(),
	};
};

const extractCurrentTime = (
	output: string,
): { timezone?: string; value: string } | null => {
	const utcMatch = output.match(/^Current UTC time:\s*(.+)$/);
	if (utcMatch) {
		return { timezone: "UTC", value: utcMatch[1].trim() };
	}

	const localMatch = output.match(/^Current time in (.+?):\s*(.+)$/);
	if (localMatch) {
		return {
			timezone: localMatch[1].trim(),
			value: localMatch[2].trim(),
		};
	}

	return output ? { value: output } : null;
};

export const currentTimeToolRenderer: ActionRenderer = (item, isOpen) => {
	if (!isOpen) return null;

	const args = getToolCallArguments(item);
	const output = getActionOutput(item);
	const view = extractCurrentTime(output);

	if (!view) {
		return defaultActionRenderer(item, isOpen);
	}

	return (
		<div className="space-y-3">
			<ToolSection>
				<div className="flex items-start gap-3">
					<div className="mt-0.5 rounded-md border border-border/60 bg-muted/20 p-2">
						<Clock3 className="h-4 w-4 text-muted-foreground" />
					</div>
					<div className="min-w-0 flex-1 space-y-3">
						<div className="text-sm font-medium text-foreground">
							{view.value}
						</div>
						<ToolDetailsGrid>
							<ToolDetail
								label="Timezone"
								value={getStringArg(args, "timezone") || view.timezone || "UTC"}
								mono
							/>
						</ToolDetailsGrid>
					</div>
				</div>
			</ToolSection>
			<ToolItemRawIO item={item} input={args ?? undefined} output={output} />
		</div>
	);
};

export const loadSkillToolRenderer: ActionRenderer = (item, isOpen) => {
	if (!isOpen) return null;

	const args = getToolCallArguments(item);
	const output = getActionOutput(item);
	const loadedSkill = extractLoadedSkill(output);

	return (
		<div className="space-y-3">
			<ToolSection>
				<div className="flex items-start gap-3">
					<div className="mt-0.5 rounded-md border border-border/60 bg-muted/20 p-2">
						<ScrollText className="h-4 w-4 text-muted-foreground" />
					</div>
					<div className="min-w-0 flex-1 space-y-3">
						<ToolDetailsGrid>
							<ToolDetail
								label="Skill"
								value={
									loadedSkill?.name ||
									getStringArg(args, "skill_name") ||
									"Unknown skill"
								}
								mono
							/>
						</ToolDetailsGrid>
						<ToolCodeBlock>
							{loadedSkill?.body || output || "No skill content returned."}
						</ToolCodeBlock>
					</div>
				</div>
			</ToolSection>
			<ToolItemRawIO item={item} input={args ?? undefined} output={output} />
		</div>
	);
};

// Loaded on open: it draws its tool calls with the chat's own tool rows,
// which import this module's renderers in turn.
const ChildAgentConversation = React.lazy(
	() => import("./ChildAgentConversation"),
);

export const sendMessageToAgentToolRenderer: ActionRenderer = (item, isOpen) =>
	isOpen ? (
		<React.Suspense fallback={null}>
			<ChildAgentConversation item={item} />
		</React.Suspense>
	) : null;
