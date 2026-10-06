import { defineComponent, useIsStreaming } from "@openuidev/react-lang";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { MermaidRenderer } from "@/main/components/atoms/MermaidRenderer";

/**
 * A diagram's source as Mermaid reads it: without a markdown fence, and with
 * real line breaks where a one-line string carries them as `\n`.
 */
export const mermaidSource = (code: string): string => {
	const unfenced = code
		.trim()
		.replace(/^```(?:mermaid)?[^\S\n]*\n?/i, "")
		.replace(/\n?```$/, "");
	return (
		unfenced.includes("\n") ? unfenced : unfenced.replace(/\\n/g, "\n")
	).trim();
};

const MermaidFigure = ({ code, title }: { code: string; title?: string }) => {
	const { t } = useTranslation("chat");
	// Half a diagram does not parse: draw it once the source is complete.
	const streaming = useIsStreaming();
	const source = mermaidSource(code);
	return (
		<figure className="my-2 overflow-hidden rounded-md border border-border">
			{title ? (
				<figcaption className="border-b border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
					{title}
				</figcaption>
			) : null}
			<div className="overflow-x-auto p-2">
				{streaming || !source ? (
					<p className="px-1 py-6 text-center text-xs text-muted-foreground">
						{t("openui.drawingDiagram")}
					</p>
				) : (
					<MermaidRenderer chart={source} />
				)}
			</div>
		</figure>
	);
};

export const MermaidBlock = defineComponent({
	name: "MermaidBlock",
	description:
		"Draws a Mermaid diagram (flowchart, sequence, class, state, ER, gantt, mindmap, timeline, pie…) from its source, with a toggle to show the source.",
	props: z.object({
		code: z.string(),
		title: z.string().optional(),
	}),
	component: ({ props }) => (
		<MermaidFigure code={props.code} title={props.title} />
	),
});
