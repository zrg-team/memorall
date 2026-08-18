import React, { useState } from "react";
import {
	defineComponent,
	useFormName,
	useTriggerAction,
} from "@openuidev/react-lang";
import { z } from "zod";
import { useOpenUIWidgetState } from "@/main/modules/openui/openui-widget-state";
import {
	buildButtonActionPlan,
	buttonActionPropSchema,
} from "@/main/modules/openui/actions";

const childrenSchema = z.array(z.any()).default([]);
const buttonVariantSchema = z
	.enum(["default", "outline", "secondary", "ghost"])
	.default("default");

const glassBtn =
	"rounded-lg border border-white/20 bg-white/10 px-4 py-1.5 text-sm font-medium backdrop-blur-sm transition-colors hover:bg-white/20 active:bg-white/30 disabled:opacity-40";

export const ButtonBlock = defineComponent({
	name: "ButtonBlock",
	description:
		"Single button. Use a prompt string or a safe Memorall action object when clicked.",
	props: z.object({
		label: z.string(),
		prompt: buttonActionPropSchema.optional(),
		variant: buttonVariantSchema,
	}),
	component: ({ props }) => {
		const triggerAction = useTriggerAction();
		const formName = useFormName();
		const { userMessage, action } = buildButtonActionPlan(
			props.prompt,
			props.label,
		);
		return (
			<button
				type="button"
				className={glassBtn}
				onClick={() => triggerAction(userMessage, formName, action)}
			>
				{props.label}
			</button>
		);
	},
});

export const ButtonsBlock = defineComponent({
	name: "ButtonsBlock",
	description: "Row of buttons.",
	props: z.object({ children: z.array(ButtonBlock.ref).default([]) }),
	component: ({ props, renderNode }) => (
		<div className="flex flex-wrap gap-2">{renderNode(props.children)}</div>
	),
});

export const TabItem = defineComponent({
	name: "TabItem",
	description: "Tab panel definition for TabsBlock.",
	props: z.object({ label: z.string(), children: childrenSchema }),
	component: () => null,
});

export const TabsBlock = defineComponent({
	name: "TabsBlock",
	description: "Tabbed content panels.",
	props: z.object({ items: z.array(TabItem.ref) }),
	component: ({ props, renderNode }) => {
		const [active, setActive] = useState(props.items[0]?.props.label ?? "");
		const activeItem = props.items.find((i) => i.props.label === active);
		return (
			<div className="overflow-hidden rounded-xl border border-white/15 backdrop-blur-sm">
				<div className="flex border-b border-white/15 bg-white/5">
					{props.items.map((item) => (
						<button
							key={item.props.label}
							type="button"
							className={`px-4 py-2 text-sm transition-colors ${
								active === item.props.label
									? "bg-white/20 font-semibold"
									: "text-foreground/60 hover:bg-white/10"
							}`}
							onClick={() => setActive(item.props.label)}
						>
							{item.props.label}
						</button>
					))}
				</div>
				{activeItem ? (
					<div className="space-y-3 p-3">
						{renderNode(activeItem.props.children)}
					</div>
				) : null}
			</div>
		);
	},
});

export const CollapsibleBlock = defineComponent({
	name: "CollapsibleBlock",
	description: "Expandable section with a trigger label.",
	props: z.object({ label: z.string(), children: childrenSchema }),
	component: ({ props, renderNode }) => {
		const [open, setOpen] = useOpenUIWidgetState(
			`collapsible:${props.label}`,
			false,
		);
		return (
			<div className="overflow-hidden rounded-xl border border-white/15 backdrop-blur-sm">
				<button
					type="button"
					className="flex w-full items-center gap-2 bg-white/5 px-3 py-2.5 text-sm font-medium hover:bg-white/10 transition-colors"
					onClick={() => setOpen(!open)}
				>
					<span className="text-foreground/60">{open ? "▾" : "▸"}</span>
					{props.label}
				</button>
				{open ? (
					<div className="space-y-3 border-t border-white/10 px-3 pb-3 pt-2">
						{renderNode(props.children)}
					</div>
				) : null}
			</div>
		);
	},
});

export const DialogBlock = defineComponent({
	name: "DialogBlock",
	description: "Button that opens a modal dialog.",
	props: z.object({
		triggerLabel: z.string(),
		title: z.string(),
		children: childrenSchema,
	}),
	component: ({ props, renderNode }) => {
		const [open, setOpen] = useState(false);
		return (
			<>
				<button
					type="button"
					className={glassBtn}
					onClick={() => setOpen(true)}
				>
					{props.triggerLabel}
				</button>
				{open ? (
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
						onClick={() => setOpen(false)}
					>
						<div
							className="w-full max-w-md rounded-2xl border border-white/20 bg-white/10 p-5 shadow-2xl backdrop-blur-xl"
							onClick={(e) => e.stopPropagation()}
						>
							<div className="mb-4 flex items-center justify-between">
								<span className="font-semibold">{props.title}</span>
								<button
									type="button"
									className="rounded-lg p-1 text-foreground/60 hover:bg-white/10 hover:text-foreground"
									onClick={() => setOpen(false)}
								>
									✕
								</button>
							</div>
							<div className="space-y-3">{renderNode(props.children)}</div>
						</div>
					</div>
				) : null}
			</>
		);
	},
});

export const CarouselBlock = defineComponent({
	name: "CarouselBlock",
	description: "Horizontally scrollable card carousel.",
	props: z.object({ items: z.array(z.any()).default([]) }),
	component: ({ props, renderNode }) => {
		const [index, setIndex] = useState(0);
		const total = props.items.length;
		return (
			<div className="overflow-hidden rounded-xl border border-white/15 backdrop-blur-sm">
				<div className="p-3">{renderNode(props.items[index])}</div>
				<div className="flex items-center justify-between border-t border-white/10 bg-white/5 px-3 py-2 text-sm">
					<button
						type="button"
						className="rounded px-2 py-0.5 hover:bg-white/10 disabled:opacity-30"
						disabled={index === 0}
						onClick={() => setIndex((i) => Math.max(0, i - 1))}
					>
						←
					</button>
					<span className="text-foreground/50">
						{index + 1} / {total}
					</span>
					<button
						type="button"
						className="rounded px-2 py-0.5 hover:bg-white/10 disabled:opacity-30"
						disabled={index >= total - 1}
						onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
					>
						→
					</button>
				</div>
			</div>
		);
	},
});

export const interactiveComponents = [
	ButtonBlock,
	ButtonsBlock,
	TabItem,
	TabsBlock,
	CollapsibleBlock,
	DialogBlock,
	CarouselBlock,
];
