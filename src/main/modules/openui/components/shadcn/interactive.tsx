import React from "react";
import {
	defineComponent,
	useFormName,
	useTriggerAction,
} from "@openuidev/react-lang";
import { z } from "zod";
import { useOpenUIWidgetState } from "@/main/modules/openui/openui-widget-state";
import { Button } from "@/main/components/ui/button";
import {
	Carousel,
	CarouselContent,
	CarouselItem,
	CarouselNext,
	CarouselPrevious,
} from "@/main/components/ui/carousel";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/main/components/ui/collapsible";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/main/components/ui/dialog";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/main/components/ui/tabs";
import {
	buildButtonActionPlan,
	buttonActionPropSchema,
} from "@/main/modules/openui/actions";

const childrenSchema = z.array(z.any()).default([]);
const buttonVariantSchema = z
	.enum(["default", "outline", "secondary", "ghost"])
	.default("default");

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
			<Button
				type="button"
				variant={props.variant}
				onClick={() => triggerAction(userMessage, formName, action)}
			>
				{props.label}
			</Button>
		);
	},
});

export const ButtonsBlock = defineComponent({
	name: "ButtonsBlock",
	description: "Row of buttons.",
	props: z.object({
		children: z.array(ButtonBlock.ref).default([]),
	}),
	component: ({ props, renderNode }) => (
		<div className="flex flex-wrap gap-2">{renderNode(props.children)}</div>
	),
});

export const TabItem = defineComponent({
	name: "TabItem",
	description: "Tab panel definition for TabsBlock.",
	props: z.object({
		label: z.string(),
		children: childrenSchema,
	}),
	component: () => null,
});

export const TabsBlock = defineComponent({
	name: "TabsBlock",
	description: "Tabbed content panels.",
	props: z.object({
		items: z.array(TabItem.ref),
	}),
	component: ({ props, renderNode }) => {
		const first = props.items[0]?.props.label ?? "Tab";
		// Keyed on the tab labels so a block whose tabs changed does not restore a
		// selection that no longer exists.
		const [active, setActive] = useOpenUIWidgetState(
			`tabs:${props.items.map((item) => item.props.label).join("|")}`,
			first,
		);
		return (
			<Tabs value={active} onValueChange={setActive} className="w-full">
				<TabsList className="max-w-full flex-wrap justify-start">
					{props.items.map((item) => (
						<TabsTrigger key={item.props.label} value={item.props.label}>
							{item.props.label}
						</TabsTrigger>
					))}
				</TabsList>
				{props.items.map((item) => (
					<TabsContent key={item.props.label} value={item.props.label}>
						<div className="space-y-3">{renderNode(item.props.children)}</div>
					</TabsContent>
				))}
			</Tabs>
		);
	},
});

export const CollapsibleBlock = defineComponent({
	name: "CollapsibleBlock",
	description: "Expandable section with a trigger label.",
	props: z.object({
		label: z.string(),
		children: childrenSchema,
	}),
	component: ({ props, renderNode }) => {
		const [open, setOpen] = useOpenUIWidgetState(
			`collapsible:${props.label}`,
			false,
		);
		return (
			<Collapsible
				open={open}
				onOpenChange={setOpen}
				className="rounded-lg border"
			>
				<CollapsibleTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						className="h-auto w-full justify-start rounded-lg px-3 py-2"
					>
						{props.label}
					</Button>
				</CollapsibleTrigger>
				<CollapsibleContent className="space-y-3 px-3 pb-3">
					{renderNode(props.children)}
				</CollapsibleContent>
			</Collapsible>
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
	component: ({ props, renderNode }) => (
		<Dialog>
			<DialogTrigger asChild>
				<Button type="button" variant="outline">
					{props.triggerLabel}
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{props.title}</DialogTitle>
				</DialogHeader>
				<div className="space-y-3">{renderNode(props.children)}</div>
			</DialogContent>
		</Dialog>
	),
});

export const CarouselBlock = defineComponent({
	name: "CarouselBlock",
	description: "Horizontally scrollable card carousel.",
	props: z.object({
		items: z.array(z.any()).default([]),
	}),
	component: ({ props, renderNode }) => (
		<Carousel className="mx-10">
			<CarouselContent>
				{props.items.map((item, index) => (
					<CarouselItem key={index} className="basis-full md:basis-1/2">
						{renderNode(item)}
					</CarouselItem>
				))}
			</CarouselContent>
			<CarouselPrevious />
			<CarouselNext />
		</Carousel>
	),
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
