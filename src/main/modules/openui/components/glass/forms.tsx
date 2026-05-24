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
import { OPENUI_FORM_FIELD_METADATA_KEY } from "@/main/modules/openui/actions";

const fieldId = (formName: string | undefined, name: string) =>
	`openui-glass-${formName ?? "form"}-${name}`;

const inputClass =
	"w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm outline-none placeholder:text-foreground/30 backdrop-blur-sm transition-colors focus:border-white/40 focus:bg-white/15 disabled:opacity-50";

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
			<div className="space-y-4 rounded-xl border border-white/15 bg-white/5 p-4 backdrop-blur-sm">
				{renderNode(props.children)}
			</div>
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
			<div className="space-y-1.5">
				<label
					htmlFor={fieldId(formName, props.name)}
					className="text-sm font-medium"
				>
					{props.label}
				</label>
				<input
					id={fieldId(formName, props.name)}
					className={inputClass}
					value={String(value)}
					placeholder={props.placeholder}
					disabled={isStreaming}
					onChange={(e) =>
						setFieldValue(formName, "InputBlock", props.name, e.target.value)
					}
				/>
			</div>
		);
	},
});

export const SelectItemBlock = defineComponent({
	name: "SelectItemBlock",
	description: "Dropdown option.",
	props: z.object({ label: z.string(), value: z.string() }),
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
			<div className="space-y-1.5">
				<label className="text-sm font-medium">{props.label}</label>
				<select
					className={inputClass}
					value={typeof value === "string" ? value : ""}
					disabled={isStreaming}
					onChange={(e) =>
						setFieldValue(formName, "SelectBlock", props.name, e.target.value)
					}
				>
					<option value="">{props.placeholder ?? props.label}</option>
					{props.items.map((item) => (
						<option key={item.props.value} value={item.props.value}>
							{item.props.label}
						</option>
					))}
				</select>
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
			<div className="flex items-center justify-between gap-4 rounded-lg border border-white/15 bg-white/5 px-3 py-2 backdrop-blur-sm">
				<span className="text-sm font-medium">{props.label}</span>
				<button
					type="button"
					disabled={isStreaming}
					onClick={() =>
						!isStreaming &&
						setFieldValue(formName, "SwitchBlock", props.name, !checked)
					}
					className={`relative h-5 w-9 rounded-full transition-colors ${checked ? "bg-white/50" : "bg-white/15"}`}
				>
					<span
						className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`}
					/>
				</button>
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
			<label className="flex cursor-pointer items-center gap-3 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm backdrop-blur-sm">
				<input
					type="checkbox"
					checked={checked}
					disabled={isStreaming}
					className="h-4 w-4 rounded accent-white disabled:opacity-50"
					onChange={(e) =>
						setFieldValue(
							formName,
							"CheckboxBlock",
							props.name,
							e.target.checked,
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
	props: z.object({ label: z.string(), value: z.string() }),
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
			<div className="space-y-1.5">
				<label className="text-sm font-medium">{props.label}</label>
				<div className="space-y-1.5">
					{props.items.map((item) => (
						<label
							key={item.props.value}
							className="flex cursor-pointer items-center gap-3 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm backdrop-blur-sm"
						>
							<input
								type="radio"
								name={fieldId(formName, props.name)}
								value={item.props.value}
								checked={value === item.props.value}
								disabled={isStreaming}
								className="h-4 w-4 accent-white disabled:opacity-50"
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
			<div className="space-y-1.5">
				<label
					htmlFor={fieldId(formName, props.name)}
					className="text-sm font-medium"
				>
					{props.label}
				</label>
				<textarea
					id={fieldId(formName, props.name)}
					className={inputClass}
					rows={3}
					value={String(value)}
					placeholder={props.placeholder}
					disabled={isStreaming}
					onChange={(e) =>
						setFieldValue(formName, "TextareaBlock", props.name, e.target.value)
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
