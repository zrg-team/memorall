import React from "react";
import { defineComponent } from "@openuidev/react-lang";
import { CodeEditorBlock } from "../code-editor-block";
import { HtmlBlock } from "../html-block";
import { z } from "zod";
import { cn } from "@/lib/utils";

const childrenSchema = z.array(z.any()).default([]);

export const CardBlock = defineComponent({
	name: "CardBlock",
	description:
		"Primary response container. Use as the root component and place all visible content in children.",
	props: z.object({
		title: z.string().optional(),
		description: z.string().optional(),
		children: childrenSchema,
		theme: z.string().optional().default(""),
	}),
	component: ({ props, renderNode }) => (
		<div className="w-full border-2 border-dashed border-foreground/40 bg-background p-4">
			{props.title || props.description ? (
				<div className="mb-3 border-b border-dashed border-foreground/30 pb-2">
					{props.title ? (
						<div className="font-mono text-base font-semibold">
							[{props.title}]
						</div>
					) : null}
					{props.description ? (
						<div className="font-mono text-sm text-foreground/60">
							{props.description}
						</div>
					) : null}
				</div>
			) : null}
			<div className="space-y-3">{renderNode(props.children)}</div>
		</div>
	),
});

export const TextContent = defineComponent({
	name: "TextContent",
	description: "Plain text paragraph with optional size.",
	props: z.object({
		text: z.string(),
		size: z.enum(["sm", "base", "lg"]).default("base"),
		muted: z.boolean().default(false),
	}),
	component: ({ props }) => (
		<p
			className={cn(
				"font-mono leading-6",
				props.size === "sm" && "text-sm",
				props.size === "base" && "text-sm md:text-base",
				props.size === "lg" && "text-base md:text-lg",
				props.muted && "text-foreground/50",
			)}
		>
			{props.text}
		</p>
	),
});

export const AlertBlock = defineComponent({
	name: "AlertBlock",
	description: "Callout for important information, warnings, or errors.",
	props: z.object({
		title: z.string().optional(),
		message: z.string(),
		variant: z.enum(["default", "destructive"]).default("default"),
	}),
	component: ({ props }) => (
		<div
			className={cn(
				"border-2 border-dashed p-3 font-mono",
				props.variant === "destructive"
					? "border-foreground/60"
					: "border-foreground/30",
			)}
		>
			{props.title ? (
				<div className="mb-1 font-semibold">
					{props.variant === "destructive" ? "⚠ " : "ℹ "}
					{props.title}
				</div>
			) : null}
			<div className="text-sm">{props.message}</div>
		</div>
	),
});

export const BadgeBlock = defineComponent({
	name: "BadgeBlock",
	description: "Small inline label.",
	props: z.object({
		label: z.string(),
		variant: z
			.enum(["default", "secondary", "destructive", "outline"])
			.default("secondary"),
	}),
	component: ({ props }) => (
		<span className="inline-block border border-foreground/50 px-2 py-0.5 font-mono text-xs">
			{props.label}
		</span>
	),
});

export const ProgressBlock = defineComponent({
	name: "ProgressBlock",
	description: "Progress bar for confidence, completion, or score values.",
	props: z.object({
		value: z.number().min(0).max(100),
		label: z.string().optional(),
	}),
	component: ({ props }) => {
		const filled = Math.round(props.value / 5);
		const empty = 20 - filled;
		return (
			<div className="space-y-1 font-mono">
				{props.label ? (
					<div className="flex justify-between text-sm">
						<span>{props.label}</span>
						<span className="text-foreground/60">
							{Math.round(props.value)}%
						</span>
					</div>
				) : null}
				<div className="text-sm tracking-tight">
					[{"█".repeat(filled)}
					{"░".repeat(empty)}]
				</div>
			</div>
		);
	},
});

export const SeparatorBlock = defineComponent({
	name: "SeparatorBlock",
	description: "Horizontal divider between sections.",
	props: z.object({}),
	component: () => (
		<div className="font-mono text-foreground/40 text-xs">{"─".repeat(40)}</div>
	),
});

export const CodeBlockComp = defineComponent({
	name: "CodeBlockComp",
	description: "Syntax highlighted code block with copy button.",
	props: z.object({
		code: z.string(),
		language: z.string().default("typescript"),
		filename: z.string().optional(),
	}),
	component: ({ props }) => {
		const filename = props.filename ?? props.language;
		return (
			<div className="border-2 border-dashed border-foreground/40">
				<div className="border-b border-dashed border-foreground/30 px-3 py-1 font-mono text-xs text-foreground/60">
					{filename}
				</div>
				<pre className="overflow-x-auto p-3 font-mono text-sm">
					<code>{props.code}</code>
				</pre>
			</div>
		);
	},
});

export const contentComponents = [
	CardBlock,
	TextContent,
	AlertBlock,
	BadgeBlock,
	ProgressBlock,
	SeparatorBlock,
	CodeBlockComp,
	CodeEditorBlock,
	HtmlBlock,
];
