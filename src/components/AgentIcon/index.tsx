import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	AgentIconCanvas,
	type AgentIconAnimation,
	type AgentIconCanvasProps,
	type AgentScreenContent,
} from "./AgentIconCanvas";
export { toAgentScreenContent } from "./agent-screen-content";
import {
	AgentSpeechBubble,
	type AgentIconSpeechBubble,
} from "./AgentSpeechBubble";
import {
	getAgentGreeting,
	getAgentGreetingRefreshMs,
	type AgentGreetingContext,
	type AgentGreetingPhrases,
} from "./agentGreetings";
import { getDefaultMood } from "./agentMoods";
import type { AgentIconMood } from "./agentIconTypes";
import {
	usePrefersReducedMotion,
	useSmartAgentMood,
} from "./hooks/use-smart-agent-mood";

export interface AgentIconProps
	extends Omit<AgentIconCanvasProps, "animation" | "screenContent"> {
	animation?: AgentIconAnimation;
	screenContent?: AgentScreenContent;
	ambientScreenContent?: AgentScreenContent;
	reactive?: boolean;
	moods?: AgentIconMood[];
	speechBubble?: AgentIconSpeechBubble | string;
	autoGreeting?: boolean;
	greetingContext?: AgentGreetingContext;
}

const toStringArray = (value: unknown): string[] =>
	Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];

export const AgentIcon: React.FC<AgentIconProps> = ({
	animation,
	screenContent,
	ambientScreenContent,
	reactive = true,
	moods,
	speechBubble,
	autoGreeting = false,
	greetingContext,
	variant = "default",
	...props
}) => {
	const { t } = useTranslation("agents");
	const containerRef = useRef<HTMLSpanElement | null>(null);
	const prefersReducedMotion = usePrefersReducedMotion();
	const [tick, setTick] = useState(0);
	const [greetingTick, setGreetingTick] = useState(0);
	const smartMood = useSmartAgentMood(
		containerRef,
		reactive && !prefersReducedMotion && !animation && !screenContent,
	);
	const mood = useMemo(() => {
		if (smartMood) return smartMood;

		if (moods?.length) {
			return moods[tick % moods.length] ?? moods[0];
		}

		return getDefaultMood(tick);
	}, [moods, smartMood, tick]);

	useEffect(() => {
		if (!reactive || prefersReducedMotion || animation || screenContent) return;

		const timeout = window.setTimeout(() => {
			setTick((value) => value + 1);
		}, mood.duration);

		return () => window.clearTimeout(timeout);
	}, [animation, mood.duration, prefersReducedMotion, reactive, screenContent]);

	useEffect(() => {
		if (!autoGreeting || speechBubble) return;

		const timeout = window.setTimeout(() => {
			setGreetingTick((value) => value + 1);
		}, getAgentGreetingRefreshMs());

		return () => window.clearTimeout(timeout);
	}, [autoGreeting, greetingTick, speechBubble]);

	const greetingPhrases = useMemo<AgentGreetingPhrases>(
		() => ({
			generic: toStringArray(
				t("iconGreeting.generic", { returnObjects: true }),
			),
			agent: toStringArray(
				t("iconGreeting.agent", {
					agent: greetingContext?.selectedAgentName ?? "",
					returnObjects: true,
				}),
			),
			team: toStringArray(t("iconGreeting.team", { returnObjects: true })),
			feature: {
				default: toStringArray(
					t("iconGreeting.feature.default", { returnObjects: true }),
				),
				byName: {
					"knowledge-retrieval": toStringArray(
						t("iconGreeting.feature.knowledgeRetrieval", {
							returnObjects: true,
						}),
					),
					"context-smart-retrieve": toStringArray(
						t("iconGreeting.feature.knowledgeRetrieval", {
							returnObjects: true,
						}),
					),
					"context-quick-retrieve": toStringArray(
						t("iconGreeting.feature.knowledgeRetrieval", {
							returnObjects: true,
						}),
					),
					"context-llm-retrieve": toStringArray(
						t("iconGreeting.feature.knowledgeRetrieval", {
							returnObjects: true,
						}),
					),
					"structmem-retrieval": toStringArray(
						t("iconGreeting.feature.knowledgeRetrieval", {
							returnObjects: true,
						}),
					),
					"entities-facts-citation": toStringArray(
						t("iconGreeting.feature.citations", { returnObjects: true }),
					),
					citations: toStringArray(
						t("iconGreeting.feature.citations", { returnObjects: true }),
					),
					"multi-agent-feature": toStringArray(
						t("iconGreeting.feature.multiAgent", { returnObjects: true }),
					),
					"web-feature": toStringArray(
						t("iconGreeting.feature.web", { returnObjects: true }),
					),
					"artifact-feature": toStringArray(
						t("iconGreeting.feature.artifact", { returnObjects: true }),
					),
					"documents-feature": toStringArray(
						t("iconGreeting.feature.documents", { returnObjects: true }),
					),
					"documents-fs-feature": toStringArray(
						t("iconGreeting.feature.documentsFs", { returnObjects: true }),
					),
					"fs-feature": toStringArray(
						t("iconGreeting.feature.fileSystem", { returnObjects: true }),
					),
					"daily-briefing-feature": toStringArray(
						t("iconGreeting.feature.dailyBriefing", { returnObjects: true }),
					),
					"finance-tracker-feature": toStringArray(
						t("iconGreeting.feature.financeTracker", {
							returnObjects: true,
						}),
					),
					"job-application-feature": toStringArray(
						t("iconGreeting.feature.jobApplication", {
							returnObjects: true,
						}),
					),
					"language-tutor-feature": toStringArray(
						t("iconGreeting.feature.languageTutor", {
							returnObjects: true,
						}),
					),
					"mcp-feature": toStringArray(
						t("iconGreeting.feature.mcp", { returnObjects: true }),
					),
					"meal-planner-feature": toStringArray(
						t("iconGreeting.feature.mealPlanner", { returnObjects: true }),
					),
					"news-collection-feature": toStringArray(
						t("iconGreeting.feature.newsCollection", {
							returnObjects: true,
						}),
					),
					"nodejs-sandbox-feature": toStringArray(
						t("iconGreeting.feature.nodejsSandbox", {
							returnObjects: true,
						}),
					),
					"planner-feature": toStringArray(
						t("iconGreeting.feature.planner", { returnObjects: true }),
					),
					"shopping-assistant-feature": toStringArray(
						t("iconGreeting.feature.shoppingAssistant", {
							returnObjects: true,
						}),
					),
					"travel-planner-feature": toStringArray(
						t("iconGreeting.feature.travelPlanner", {
							returnObjects: true,
						}),
					),
					"entity-extraction": toStringArray(
						t("iconGreeting.feature.knowledgeGrow", {
							returnObjects: true,
						}),
					),
					"entity-resolution": toStringArray(
						t("iconGreeting.feature.knowledgeGrow", {
							returnObjects: true,
						}),
					),
					"fact-extraction": toStringArray(
						t("iconGreeting.feature.knowledgeGrow", {
							returnObjects: true,
						}),
					),
					"fact-extraction-v2": toStringArray(
						t("iconGreeting.feature.knowledgeGrow", {
							returnObjects: true,
						}),
					),
					"fact-resolution": toStringArray(
						t("iconGreeting.feature.knowledgeGrow", {
							returnObjects: true,
						}),
					),
					"knowledge-database-save": toStringArray(
						t("iconGreeting.feature.knowledgeGrow", {
							returnObjects: true,
						}),
					),
					"edge-enrichment": toStringArray(
						t("iconGreeting.feature.knowledgeGrow", {
							returnObjects: true,
						}),
					),
					"temporal-extraction": toStringArray(
						t("iconGreeting.feature.knowledgeGrow", {
							returnObjects: true,
						}),
					),
					"load-entities": toStringArray(
						t("iconGreeting.feature.knowledgeGrow", {
							returnObjects: true,
						}),
					),
					"load-facts": toStringArray(
						t("iconGreeting.feature.knowledgeGrow", {
							returnObjects: true,
						}),
					),
				},
			},
			time: {
				morning: toStringArray(
					t("iconGreeting.time.morning", { returnObjects: true }),
				),
				afternoon: toStringArray(
					t("iconGreeting.time.afternoon", { returnObjects: true }),
				),
				evening: toStringArray(
					t("iconGreeting.time.evening", { returnObjects: true }),
				),
				night: toStringArray(
					t("iconGreeting.time.night", { returnObjects: true }),
				),
			},
		}),
		[t, greetingContext?.selectedAgentName],
	);

	const resolvedSpeechBubble = useMemo(() => {
		if (typeof speechBubble === "string") {
			return { message: speechBubble } satisfies AgentIconSpeechBubble;
		}

		if (speechBubble) return speechBubble;
		if (!autoGreeting) return undefined;

		return getAgentGreeting(greetingContext, greetingPhrases, greetingTick);
	}, [
		autoGreeting,
		greetingContext,
		greetingPhrases,
		greetingTick,
		speechBubble,
	]);

	const canvas = (
		<AgentIconCanvas
			{...props}
			animation={animation ?? mood.animation}
			screenContent={
				screenContent ?? mood.screenContent ?? ambientScreenContent
			}
			variant={variant}
		/>
	);

	const content = (
		<span
			ref={containerRef}
			className="relative inline-flex items-center justify-center overflow-visible align-middle"
		>
			{canvas}
			{resolvedSpeechBubble ? (
				<AgentSpeechBubble
					bubble={resolvedSpeechBubble}
					reducedMotion={prefersReducedMotion}
				/>
			) : null}
		</span>
	);

	return content;
};

export type {
	AgentGreetingContext,
	AgentGreetingPhrases,
	AgentIconAnimation,
	AgentIconSpeechBubble,
	AgentScreenContent,
};
