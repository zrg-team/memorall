import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import {
	type KnowledgeContext,
	parseKnowledgeContext,
	readableRelation,
} from "./knowledge-context";

/** Enough to see what was found without pushing the answer off screen. */
const COLLAPSED_ROWS = 6;

const TypeBadge: React.FC<{ type: string }> = ({ type }) =>
	type ? (
		<span className="shrink-0 rounded bg-muted/50 px-1.5 py-px text-[10px] leading-4 text-muted-foreground">
			{type}
		</span>
	) : null;

const Section: React.FC<{
	title: string;
	count: number;
	children: (limit: number) => React.ReactNode;
}> = ({ title, count, children }) => {
	const { t } = useTranslation("chat");
	const [expanded, setExpanded] = useState(false);
	if (count === 0) return null;
	const hidden = expanded ? 0 : Math.max(0, count - COLLAPSED_ROWS);

	return (
		<section className="min-w-0">
			<h4 className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
				<span>{title}</span>
				<span className="tabular-nums">{count}</span>
			</h4>
			<ul className="divide-y divide-border/30">
				{children(expanded ? count : COLLAPSED_ROWS)}
			</ul>
			{count > COLLAPSED_ROWS ? (
				<button
					type="button"
					className="mt-1 rounded px-1 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground"
					onClick={() => setExpanded((value) => !value)}
				>
					{hidden > 0
						? t("workflow.knowledge.showMore", { count: hidden })
						: t("workflow.knowledge.showLess")}
				</button>
			) : null}
		</section>
	);
};

const StructuredKnowledge: React.FC<{ knowledge: KnowledgeContext }> = ({
	knowledge,
}) => {
	const { t } = useTranslation("chat");

	return (
		<div className="min-w-0 space-y-3 text-xs">
			<Section
				title={t("workflow.knowledge.entities")}
				count={knowledge.entities.length}
			>
				{(limit) =>
					knowledge.entities.slice(0, limit).map((entity, index) => (
						<li key={`${entity.name}-${index}`} className="py-1.5">
							<div className="flex min-w-0 items-start justify-between gap-2">
								<span className="min-w-0 break-words font-medium text-foreground/90">
									{entity.name}
								</span>
								<TypeBadge type={entity.type} />
							</div>
							{entity.summary ? (
								<p className="mt-0.5 whitespace-pre-wrap break-words leading-relaxed text-muted-foreground">
									{entity.summary}
								</p>
							) : null}
						</li>
					))
				}
			</Section>
			<Section
				title={t("workflow.knowledge.relationships")}
				count={knowledge.relationships.length}
			>
				{(limit) =>
					knowledge.relationships.slice(0, limit).map((relationship, index) => (
						<li
							key={`${relationship.source}-${relationship.relation}-${relationship.target}-${index}`}
							className="py-1.5"
						>
							<div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
								<span className="min-w-0 break-words font-medium text-foreground/90">
									{relationship.source}
								</span>
								<span className="inline-flex items-center gap-1 text-muted-foreground/80">
									<ArrowRight className="h-3 w-3 shrink-0" aria-hidden />
									<span>{readableRelation(relationship.relation)}</span>
									<ArrowRight className="h-3 w-3 shrink-0" aria-hidden />
								</span>
								<span className="min-w-0 break-words font-medium text-foreground/90">
									{relationship.target}
								</span>
							</div>
							{relationship.fact ? (
								<p className="mt-0.5 whitespace-pre-wrap break-words leading-relaxed text-muted-foreground">
									{relationship.fact}
								</p>
							) : null}
						</li>
					))
				}
			</Section>
			{knowledge.notes ? (
				<p className="whitespace-pre-wrap break-words leading-relaxed text-muted-foreground">
					{knowledge.notes}
				</p>
			) : null}
		</div>
	);
};

/**
 * The knowledge a run retrieved, shown as entities and relationships when it is
 * in the memory flows' format, and as its text otherwise.
 */
export const RetrievedKnowledge: React.FC<{ text: string }> = ({ text }) => {
	const knowledge = useMemo(() => parseKnowledgeContext(text), [text]);

	if (
		!knowledge ||
		(knowledge.entities.length === 0 && knowledge.relationships.length === 0)
	) {
		return (
			<div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
				{knowledge?.notes || text}
			</div>
		);
	}
	return <StructuredKnowledge knowledge={knowledge} />;
};
