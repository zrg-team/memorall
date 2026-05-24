import React, { useEffect, useMemo } from "react";
import {
	FormNameContext,
	defineComponent,
	useFormName,
	useGetFieldValue,
	useIsStreaming,
	useSetDefaultValue,
	useSetFieldValue,
} from "@openuidev/react-lang";
import { z } from "zod";
import { Input } from "@/main/components/ui/input";
import { Label } from "@/main/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/main/components/ui/select";
import { Switch } from "@/main/components/ui/switch";
import { Textarea } from "@/main/components/ui/textarea";
import { OPENUI_FORM_FIELD_METADATA_KEY } from "@/main/modules/openui/actions";

const fieldId = (formName: string | undefined, name: string) =>
	`openui-${formName ?? "form"}-${name}`;

type FieldMetadata = { label: string; options?: Record<string, string> };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const sameOptions = (
	left: Record<string, string> | undefined,
	right: Record<string, string> | undefined,
) => JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});

const useRegisterFieldMetadata = ({
	formName,
	name,
	label,
	options,
}: {
	formName: string | undefined;
	name: string;
	label: string;
	options?: Record<string, string>;
}) => {
	const isStreaming = useIsStreaming();
	const getFieldValue = useGetFieldValue();
	const setFieldValue = useSetFieldValue();
	const metadataValue = getFieldValue(formName, OPENUI_FORM_FIELD_METADATA_KEY);

	useEffect(() => {
		if (isStreaming) return;
		const current = isRecord(metadataValue)
			? (metadataValue as Record<string, FieldMetadata>)
			: {};
		const nextFieldMetadata: FieldMetadata = options
			? { label, options }
			: { label };
		const currentFieldMetadata = current[name];
		if (
			currentFieldMetadata?.label === nextFieldMetadata.label &&
			sameOptions(currentFieldMetadata.options, nextFieldMetadata.options)
		) {
			return;
		}

		setFieldValue(
			formName,
			"MemorallFormMetadata",
			OPENUI_FORM_FIELD_METADATA_KEY,
			{ ...current, [name]: nextFieldMetadata },
			false,
		);
	}, [
		formName,
		isStreaming,
		label,
		metadataValue,
		name,
		options,
		setFieldValue,
	]);
};

export const FormBlock = defineComponent({
	name: "FormBlock",
	description: "Container for form controls. Give each form a stable name.",
	props: z.object({
		name: z.string(),
		children: z.array(z.any()).default([]),
	}),
	component: ({ props, renderNode }) => (
		<FormNameContext.Provider value={props.name}>
			<div className="space-y-4">{renderNode(props.children)}</div>
		</FormNameContext.Provider>
	),
});

export const InputBlock = defineComponent({
	name: "InputBlock",
	description: "Text input with label.",
	props: z.object({
		name: z.string(),
		label: z.string(),
		placeholder: z.string().optional(),
		defaultValue: z.string().optional(),
	}),
	component: ({ props }) => {
		const formName = useFormName();
		const isStreaming = useIsStreaming();
		const getFieldValue = useGetFieldValue();
		const setFieldValue = useSetFieldValue();
		const value =
			getFieldValue(formName, props.name) ?? props.defaultValue ?? "";
		useRegisterFieldMetadata({
			formName,
			name: props.name,
			label: props.label,
		});
		useSetDefaultValue({
			formName,
			componentType: "InputBlock",
			name: props.name,
			existingValue: getFieldValue(formName, props.name),
			defaultValue: props.defaultValue,
		});
		return (
			<div className="space-y-2">
				<Label htmlFor={fieldId(formName, props.name)}>{props.label}</Label>
				<Input
					id={fieldId(formName, props.name)}
					value={String(value)}
					placeholder={props.placeholder}
					disabled={isStreaming}
					onChange={(event) =>
						setFieldValue(
							formName,
							"InputBlock",
							props.name,
							event.target.value,
						)
					}
				/>
			</div>
		);
	},
});

export const SelectItemBlock = defineComponent({
	name: "SelectItemBlock",
	description: "Dropdown option.",
	props: z.object({
		label: z.string(),
		value: z.string(),
	}),
	component: () => null,
});

export const SelectBlock = defineComponent({
	name: "SelectBlock",
	description: "Dropdown selector.",
	props: z.object({
		name: z.string(),
		label: z.string(),
		placeholder: z.string().optional(),
		defaultValue: z.string().optional(),
		items: z.array(SelectItemBlock.ref),
	}),
	component: ({ props }) => {
		const formName = useFormName();
		const isStreaming = useIsStreaming();
		const getFieldValue = useGetFieldValue();
		const setFieldValue = useSetFieldValue();
		const value = getFieldValue(formName, props.name) ?? props.defaultValue;
		const options = useMemo(
			() =>
				Object.fromEntries(
					props.items.map((item) => [item.props.value, item.props.label]),
				),
			[props.items],
		);
		useRegisterFieldMetadata({
			formName,
			name: props.name,
			label: props.label,
			options,
		});
		useSetDefaultValue({
			formName,
			componentType: "SelectBlock",
			name: props.name,
			existingValue: getFieldValue(formName, props.name),
			defaultValue: props.defaultValue,
		});
		return (
			<div className="space-y-2">
				<Label>{props.label}</Label>
				<Select
					value={typeof value === "string" ? value : undefined}
					disabled={isStreaming}
					onValueChange={(next) =>
						setFieldValue(formName, "SelectBlock", props.name, next)
					}
				>
					<SelectTrigger>
						<SelectValue placeholder={props.placeholder ?? props.label} />
					</SelectTrigger>
					<SelectContent>
						{props.items.map((item) => (
							<SelectItem key={item.props.value} value={item.props.value}>
								{item.props.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		);
	},
});

export const SwitchBlock = defineComponent({
	name: "SwitchBlock",
	description: "Toggle switch with label.",
	props: z.object({
		name: z.string(),
		label: z.string(),
		defaultChecked: z.boolean().default(false),
	}),
	component: ({ props }) => {
		const formName = useFormName();
		const isStreaming = useIsStreaming();
		const getFieldValue = useGetFieldValue();
		const setFieldValue = useSetFieldValue();
		const existingValue = getFieldValue(formName, props.name);
		const checked =
			typeof existingValue === "boolean" ? existingValue : props.defaultChecked;
		useRegisterFieldMetadata({
			formName,
			name: props.name,
			label: props.label,
		});
		useSetDefaultValue({
			formName,
			componentType: "SwitchBlock",
			name: props.name,
			existingValue,
			defaultValue: props.defaultChecked,
		});
		return (
			<div className="flex items-center justify-between gap-4 rounded-lg border p-3">
				<Label htmlFor={fieldId(formName, props.name)}>{props.label}</Label>
				<Switch
					id={fieldId(formName, props.name)}
					checked={checked}
					disabled={isStreaming}
					onCheckedChange={(next) =>
						setFieldValue(formName, "SwitchBlock", props.name, next)
					}
				/>
			</div>
		);
	},
});

export const CheckboxBlock = defineComponent({
	name: "CheckboxBlock",
	description: "Checkbox with label.",
	props: z.object({
		name: z.string(),
		label: z.string(),
		defaultChecked: z.boolean().default(false),
	}),
	component: ({ props }) => {
		const formName = useFormName();
		const isStreaming = useIsStreaming();
		const getFieldValue = useGetFieldValue();
		const setFieldValue = useSetFieldValue();
		const existingValue = getFieldValue(formName, props.name);
		const checked =
			typeof existingValue === "boolean" ? existingValue : props.defaultChecked;
		useRegisterFieldMetadata({
			formName,
			name: props.name,
			label: props.label,
		});
		useSetDefaultValue({
			formName,
			componentType: "CheckboxBlock",
			name: props.name,
			existingValue,
			defaultValue: props.defaultChecked,
		});
		return (
			<label
				htmlFor={fieldId(formName, props.name)}
				className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm"
			>
				<input
					id={fieldId(formName, props.name)}
					type="checkbox"
					checked={checked}
					disabled={isStreaming}
					className="h-4 w-4 rounded border-border accent-primary disabled:opacity-50"
					onChange={(event) =>
						setFieldValue(
							formName,
							"CheckboxBlock",
							props.name,
							event.target.checked,
						)
					}
				/>
				<span>{props.label}</span>
			</label>
		);
	},
});

export const RadioItemBlock = defineComponent({
	name: "RadioItemBlock",
	description: "Radio option.",
	props: z.object({
		label: z.string(),
		value: z.string(),
	}),
	component: () => null,
});

export const RadioGroupBlock = defineComponent({
	name: "RadioGroupBlock",
	description: "Radio group with label.",
	props: z.object({
		name: z.string(),
		label: z.string(),
		defaultValue: z.string().optional(),
		items: z.array(RadioItemBlock.ref),
	}),
	component: ({ props }) => {
		const formName = useFormName();
		const isStreaming = useIsStreaming();
		const getFieldValue = useGetFieldValue();
		const setFieldValue = useSetFieldValue();
		const value =
			getFieldValue(formName, props.name) ?? props.defaultValue ?? "";
		const options = useMemo(
			() =>
				Object.fromEntries(
					props.items.map((item) => [item.props.value, item.props.label]),
				),
			[props.items],
		);
		useRegisterFieldMetadata({
			formName,
			name: props.name,
			label: props.label,
			options,
		});
		useSetDefaultValue({
			formName,
			componentType: "RadioGroupBlock",
			name: props.name,
			existingValue: getFieldValue(formName, props.name),
			defaultValue: props.defaultValue,
		});
		return (
			<div className="space-y-2">
				<Label>{props.label}</Label>
				<div className="space-y-2">
					{props.items.map((item) => (
						<label
							key={item.props.value}
							className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm"
						>
							<input
								type="radio"
								name={fieldId(formName, props.name)}
								value={item.props.value}
								checked={value === item.props.value}
								disabled={isStreaming}
								className="h-4 w-4 accent-primary disabled:opacity-50"
								onChange={() =>
									setFieldValue(
										formName,
										"RadioGroupBlock",
										props.name,
										item.props.value,
									)
								}
							/>
							<span>{item.props.label}</span>
						</label>
					))}
				</div>
			</div>
		);
	},
});

export const TextareaBlock = defineComponent({
	name: "TextareaBlock",
	description: "Multi-line text input with label.",
	props: z.object({
		name: z.string(),
		label: z.string(),
		placeholder: z.string().optional(),
		defaultValue: z.string().optional(),
	}),
	component: ({ props }) => {
		const formName = useFormName();
		const isStreaming = useIsStreaming();
		const getFieldValue = useGetFieldValue();
		const setFieldValue = useSetFieldValue();
		const value =
			getFieldValue(formName, props.name) ?? props.defaultValue ?? "";
		useRegisterFieldMetadata({
			formName,
			name: props.name,
			label: props.label,
		});
		useSetDefaultValue({
			formName,
			componentType: "TextareaBlock",
			name: props.name,
			existingValue: getFieldValue(formName, props.name),
			defaultValue: props.defaultValue,
		});
		return (
			<div className="space-y-2">
				<Label htmlFor={fieldId(formName, props.name)}>{props.label}</Label>
				<Textarea
					id={fieldId(formName, props.name)}
					value={String(value)}
					placeholder={props.placeholder}
					disabled={isStreaming}
					onChange={(event) =>
						setFieldValue(
							formName,
							"TextareaBlock",
							props.name,
							event.target.value,
						)
					}
				/>
			</div>
		);
	},
});

export const formComponents = [
	FormBlock,
	InputBlock,
	SelectBlock,
	SelectItemBlock,
	SwitchBlock,
	CheckboxBlock,
	RadioItemBlock,
	RadioGroupBlock,
	TextareaBlock,
];
