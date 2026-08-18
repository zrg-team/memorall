import React from "react";
import { defineComponent } from "@openuidev/react-lang";
import { CodeEditorBlock } from "../code-editor-block";
import { HtmlBlock } from "../html-block";
import { z } from "zod";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@/main/components/ui/alert";
import { Badge } from "@/main/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/main/components/ui/card";
import { Progress } from "@/main/components/ui/progress";
import { Separator } from "@/main/components/ui/separator";
import {
	CodeBlock,
	CodeBlockBody,
	CodeBlockContent,
	CodeBlockCopyButton,
	CodeBlockHeader,
	CodeBlockItem,
} from "@/main/components/ui/shadcn-io/code-block";
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
		<Card className="w-full rounded-lg border bg-card/95 shadow-sm">
			{props.title || props.description ? (
				<CardHeader className="space-y-1.5 p-4 pb-2 max-[640px]:px-3">
					{props.title ? (
						<CardTitle className="text-base leading-6 tracking-normal">
							{props.title}
						</CardTitle>
					) : null}
					{props.description ? (
						<CardDescription>{props.description}</CardDescription>
					) : null}
				</CardHeader>
			) : null}
			<CardContent className="space-y-3 p-4 pt-2 max-[640px]:px-3">
				{renderNode(props.children)}
			</CardContent>
		</Card>
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
				props.muted && "text-muted-foreground",
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
		<Alert variant={props.variant}>
			{props.title ? <AlertTitle>{props.title}</AlertTitle> : null}
			<AlertDescription>{props.message}</AlertDescription>
		</Alert>
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
		<Badge variant={props.variant}>{props.label}</Badge>
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
		<div className="space-y-2">
			{props.label ? (
				<div className="flex items-center justify-between gap-3 text-sm">
					<span className="font-medium">{props.label}</span>
					<span className="text-muted-foreground">
						{Math.round(props.value)}%
					</span>
				</div>
			) : null}
			<Progress value={props.value} />
		</div>
	),
});

export const SeparatorBlock = defineComponent({
	name: "SeparatorBlock",
	description: "Horizontal divider between sections.",
	props: z.object({}),
	component: () => <Separator />,
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
		const data = [{ language: props.language, filename, code: props.code }];
		return (
			<CodeBlock data={data} defaultValue={props.language}>
				<CodeBlockHeader className="justify-between">
					<div className="px-3 py-1.5 text-xs text-muted-foreground">
						{filename}
					</div>
					<CodeBlockCopyButton />
				</CodeBlockHeader>
				<CodeBlockBody>
					{(item) => (
						<CodeBlockItem key={item.language} value={item.language}>
							<CodeBlockContent language={item.language}>
								{item.code}
							</CodeBlockContent>
						</CodeBlockItem>
					)}
				</CodeBlockBody>
			</CodeBlock>
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
