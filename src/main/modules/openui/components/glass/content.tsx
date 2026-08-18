import React from "react";
import { defineComponent } from "@openuidev/react-lang";
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
		<div className="w-full rounded-2xl border border-white/20 bg-white/10 p-4 shadow-xl backdrop-blur-md dark:border-white/10 dark:bg-white/5">
			{props.title || props.description ? (
				<div className="mb-3 border-b border-white/15 pb-2">
					{props.title ? (
						<div className="text-base font-semibold tracking-tight">
							{props.title}
						</div>
					) : null}
					{props.description ? (
						<div className="text-sm text-foreground/60">
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
				"leading-6",
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
				"rounded-xl border p-3 backdrop-blur-sm",
				props.variant === "destructive"
					? "border-red-400/30 bg-red-500/10 text-red-200"
					: "border-white/20 bg-white/10",
			)}
		>
			{props.title ? (
				<div className="mb-1 font-semibold">{props.title}</div>
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
		<span
			className={cn(
				"inline-block rounded-full px-2.5 py-0.5 text-xs font-medium backdrop-blur-sm",
				props.variant === "destructive"
					? "bg-red-500/20 text-red-200 ring-1 ring-red-400/30"
					: props.variant === "outline"
						? "ring-1 ring-white/30 bg-transparent"
						: "bg-white/15 ring-1 ring-white/20",
			)}
		>
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
	component: ({ props }) => (
		<div className="space-y-1.5">
			{props.label ? (
				<div className="flex justify-between text-sm">
					<span className="font-medium">{props.label}</span>
					<span className="text-foreground/60">{Math.round(props.value)}%</span>
				</div>
			) : null}
			<div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10 ring-1 ring-white/15">
				<div
					className="h-full rounded-full bg-gradient-to-r from-white/40 to-white/70 backdrop-blur-sm transition-all"
					style={{ width: `${props.value}%` }}
				/>
			</div>
		</div>
	),
});

export const SeparatorBlock = defineComponent({
	name: "SeparatorBlock",
	description: "Horizontal divider between sections.",
	props: z.object({}),
	component: () => <div className="h-px w-full bg-white/15" />,
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
			<div className="overflow-hidden rounded-xl border border-white/15 bg-black/20 backdrop-blur-sm">
				<div className="border-b border-white/10 px-3 py-1.5 text-xs text-foreground/50">
					{filename}
				</div>
				<pre className="overflow-x-auto p-3 text-sm">
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
	HtmlBlock,
];
