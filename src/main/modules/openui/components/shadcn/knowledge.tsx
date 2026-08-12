import {
	BuiltinActionType,
	defineComponent,
	useTriggerAction,
} from "@openuidev/react-lang";
import { useTranslation } from "react-i18next";
import {
	ProgressiveCollectionControl,
	useProgressiveItems,
} from "../progressive-collection";
import { z } from "zod";
import { Badge } from "@/main/components/ui/badge";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/main/components/ui/card";
import { Progress } from "@/main/components/ui/progress";
import { Separator } from "@/main/components/ui/separator";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/main/components/ui/table";

export const KnowledgeCard = defineComponent({
	name: "KnowledgeCard",
	description:
		"Shows one knowledge entity with type badge, summary, and facts.",
	props: z.object({
		name: z.string(),
		entityType: z.string(),
		facts: z.array(z.string()).default([]),
		summary: z.string().optional(),
	}),
	component: ({ props }) => {
		const facts = useProgressiveItems(props.facts);
		return (
			<Card className="rounded-lg border bg-card/95 shadow-sm">
				<CardHeader className="flex-row items-center gap-2 space-y-0 p-4 pb-2">
					<CardTitle className="text-base leading-6 tracking-normal">
						{props.name}
					</CardTitle>
					<Badge variant="secondary">{props.entityType}</Badge>
				</CardHeader>
				<CardContent className="space-y-3 p-4 pt-0">
					{props.summary ? (
						<p className="text-sm text-muted-foreground">{props.summary}</p>
					) : null}
					{props.facts.length > 0 ? (
						<>
							<Separator />
							<ul className="space-y-1.5">
								{facts.items.map((fact, index) => (
									<li key={index} className="flex gap-2 text-sm leading-6">
										<span className="text-muted-foreground">-</span>
										<span>{fact}</span>
									</li>
								))}
							</ul>
						</>
					) : null}
				</CardContent>
				<ProgressiveCollectionControl
					hiddenCount={facts.hiddenCount}
					onRenderAll={facts.renderAll}
				/>
			</Card>
		);
	},
});

const factSchema = z.object({
	subject: z.string(),
	predicate: z.string(),
	object: z.string(),
	date: z.string().optional(),
});

export const FactList = defineComponent({
	name: "FactList",
	description: "List of subject-predicate-object knowledge facts.",
	props: z.object({
		title: z.string().optional(),
		facts: z.array(factSchema),
	}),
	component: ({ props }) => {
		const facts = useProgressiveItems(props.facts);
		return (
			<Card className="rounded-lg border bg-card/95 shadow-sm">
				{props.title ? (
					<CardHeader className="p-4 pb-2">
						<CardTitle className="text-base tracking-normal">
							{props.title}
						</CardTitle>
					</CardHeader>
				) : null}
				<CardContent className="space-y-2 p-4 pt-2">
					{facts.items.map((fact, index) => (
						<div
							key={index}
							className="rounded-md border bg-muted/25 p-3 text-sm"
						>
							<div className="font-medium">{fact.subject}</div>
							<div className="text-muted-foreground">
								{fact.predicate} {fact.object}
							</div>
							{fact.date ? (
								<div className="mt-1 text-xs text-muted-foreground">
									{fact.date}
								</div>
							) : null}
						</div>
					))}
				</CardContent>
				<ProgressiveCollectionControl
					hiddenCount={facts.hiddenCount}
					onRenderAll={facts.renderAll}
				/>
			</Card>
		);
	},
});

const timelineEventSchema = z.object({
	date: z.string(),
	title: z.string(),
	description: z.string().optional(),
});

export const Timeline = defineComponent({
	name: "Timeline",
	description: "Chronological events with dates.",
	props: z.object({
		title: z.string().optional(),
		events: z.array(timelineEventSchema),
	}),
	component: ({ props }) => {
		const events = useProgressiveItems(props.events);
		return (
			<Card className="rounded-lg border bg-card/95 shadow-sm">
				{props.title ? (
					<CardHeader className="p-4 pb-2">
						<CardTitle className="text-base tracking-normal">
							{props.title}
						</CardTitle>
					</CardHeader>
				) : null}
				<CardContent className="space-y-4 p-4 pt-2">
					{events.items.map((event, index) => (
						<div
							key={index}
							className="grid grid-cols-[7rem_1fr] gap-3 text-sm"
						>
							<div className="text-muted-foreground">{event.date}</div>
							<div className="border-l pl-3">
								<div className="font-medium">{event.title}</div>
								{event.description ? (
									<div className="mt-1 text-muted-foreground">
										{event.description}
									</div>
								) : null}
							</div>
						</div>
					))}
				</CardContent>
				<ProgressiveCollectionControl
					hiddenCount={events.hiddenCount}
					onRenderAll={events.renderAll}
				/>
			</Card>
		);
	},
});

const entitySchema = z.object({
	name: z.string(),
	entityType: z.string(),
	summary: z.string().optional(),
});

export const EntityList = defineComponent({
	name: "EntityList",
	description: "Compact list of knowledge entities.",
	props: z.object({
		entities: z.array(entitySchema),
	}),
	component: ({ props }) => {
		const { t } = useTranslation("common");
		const entities = useProgressiveItems(props.entities);
		return (
			<div className="overflow-hidden rounded-lg border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>{t("common.name")}</TableHead>
							<TableHead>{t("common.type")}</TableHead>
							<TableHead>{t("common.summary")}</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{entities.items.map((entity, index) => (
							<TableRow key={`${entity.name}-${index}`}>
								<TableCell className="font-medium">{entity.name}</TableCell>
								<TableCell>{entity.entityType}</TableCell>
								<TableCell className="text-muted-foreground">
									{entity.summary ?? ""}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
				<ProgressiveCollectionControl
					hiddenCount={entities.hiddenCount}
					onRenderAll={entities.renderAll}
				/>
			</div>
		);
	},
});

export const TopicSummary = defineComponent({
	name: "TopicSummary",
	description: "Stats card for a knowledge topic.",
	props: z.object({
		title: z.string(),
		entityCount: z.number().int().min(0),
		factCount: z.number().int().min(0),
		confidence: z.number().min(0).max(100).optional(),
		summary: z.string().optional(),
	}),
	component: ({ props }) => {
		const { t } = useTranslation("common");
		return (
			<Card className="rounded-lg border bg-card/95 shadow-sm">
				<CardHeader className="p-4 pb-2">
					<CardTitle className="text-base tracking-normal">
						{props.title}
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-3 p-4 pt-2">
					{props.summary ? (
						<p className="text-sm text-muted-foreground">{props.summary}</p>
					) : null}
					<div className="grid grid-cols-2 gap-3">
						<div className="rounded-md border p-3">
							<div className="text-xs text-muted-foreground">
								{t("common.entities")}
							</div>
							<div className="text-xl font-semibold">{props.entityCount}</div>
						</div>
						<div className="rounded-md border p-3">
							<div className="text-xs text-muted-foreground">
								{t("common.facts")}
							</div>
							<div className="text-xl font-semibold">{props.factCount}</div>
						</div>
					</div>
					{typeof props.confidence === "number" ? (
						<div className="space-y-2">
							<div className="flex justify-between text-sm">
								<span>{t("common.confidence")}</span>
								<span className="text-muted-foreground">
									{Math.round(props.confidence)}%
								</span>
							</div>
							<Progress value={props.confidence} />
						</div>
					) : null}
				</CardContent>
			</Card>
		);
	},
});

export const FollowUpItem = defineComponent({
	name: "FollowUpItem",
	description: "Suggested follow-up prompt.",
	props: z.object({
		label: z.string(),
		prompt: z.string().optional(),
	}),
	component: ({ props }) => {
		const triggerAction = useTriggerAction();
		return (
			<button
				type="button"
				className="rounded-md border bg-background px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
				onClick={() =>
					triggerAction(props.prompt ?? props.label, undefined, {
						type: BuiltinActionType.ContinueConversation,
						params: {},
					})
				}
			>
				{props.label}
			</button>
		);
	},
});

export const FollowUpBlock = defineComponent({
	name: "FollowUpBlock",
	description: "Suggested follow-up prompts the user can click.",
	props: z.object({
		items: z.array(FollowUpItem.ref),
	}),
	component: ({ props, renderNode }) => (
		<div className="flex flex-wrap gap-2">{renderNode(props.items)}</div>
	),
});

export const knowledgeComponents = [
	KnowledgeCard,
	FactList,
	Timeline,
	EntityList,
	TopicSummary,
	FollowUpItem,
	FollowUpBlock,
];
