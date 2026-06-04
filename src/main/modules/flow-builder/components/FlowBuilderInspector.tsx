import React from "react";
import { useTranslation } from "react-i18next";
import {
	ChevronLeft,
	ChevronRight,
	ChevronDown,
	Settings2,
	Play,
} from "lucide-react";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import { Textarea } from "@/main/components/ui/textarea";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/main/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/main/components/ui/select";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/main/components/ui/tabs";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/main/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type {
	FlowStateInput,
	FlowCatalog,
} from "@/services/flows-core/interfaces/config/flow-builder";
import type { CatalogStep } from "@/services/flow-builder-catalog";

const STATE_TYPES = [
	"string",
	"number",
	"boolean",
	"enum",
	"array",
	"object",
] as const;
const ARRAY_ELEMENT_TYPES = [
	"string",
	"number",
	"boolean",
	"enum",
	"object",
] as const;
const BASE_STATE_NAMES = new Set(["messages", "response"]);

type StateType = (typeof STATE_TYPES)[number];
type ArrayElementType = (typeof ARRAY_ELEMENT_TYPES)[number];

type ZodSchema =
	| { type: "string" | "number" | "boolean" }
	| { type: "enum"; values: string[] }
	| { type: "array"; element: ZodSchema }
	| { type: "object"; fields: ZodField[] };

type ZodField = {
	name: string;
	schema: ZodSchema;
};

const createDefaultSchema = (type: StateType | ArrayElementType): ZodSchema => {
	switch (type) {
		case "array":
			return { type: "array", element: { type: "string" } };
		case "enum":
			return { type: "enum", values: [] };
		case "object":
			return { type: "object", fields: [] };
		case "number":
		case "boolean":
		case "string":
		default:
			return { type };
	}
};

const normalizeSchema = (
	raw: unknown,
	fallbackType: StateType = "string",
): ZodSchema => {
	if (!raw || typeof raw !== "object") {
		return createDefaultSchema(fallbackType);
	}
	const schema = raw as { type?: string; element?: unknown; fields?: unknown };
	if (schema.type === "array") {
		return {
			type: "array",
			element: normalizeSchema(schema.element, "string"),
		};
	}
	if (schema.type === "enum") {
		const values = Array.isArray((schema as { values?: unknown }).values)
			? ((schema as { values?: unknown }).values as string[]).filter(
					(value) => typeof value === "string" && value.trim().length > 0,
				)
			: [];
		return { type: "enum", values };
	}
	if (schema.type === "object") {
		const fields = Array.isArray(schema.fields)
			? schema.fields
					.map((field) => {
						if (!field || typeof field !== "object") return null;
						const entry = field as {
							name?: string;
							schema?: unknown;
							type?: StateType;
							element?: unknown;
							fields?: unknown;
						};
						const name = typeof entry.name === "string" ? entry.name : "";
						const nestedSchema = entry.schema
							? normalizeSchema(entry.schema, "string")
							: normalizeSchema(
									{
										type: entry.type,
										element: entry.element,
										fields: entry.fields,
									},
									"string",
								);
						return { name, schema: nestedSchema };
					})
					.filter((field): field is ZodField => Boolean(field))
			: [];
		return { type: "object", fields };
	}
	if (
		schema.type === "string" ||
		schema.type === "number" ||
		schema.type === "boolean"
	) {
		return { type: schema.type };
	}
	return createDefaultSchema(fallbackType);
};

const getStateSchema = (state: FlowStateInput): ZodSchema => {
	const metadata = state.metadata as { zod?: unknown } | undefined;
	const fallbackType = STATE_TYPES.includes(state.type as StateType)
		? (state.type as StateType)
		: "string";
	return normalizeSchema(metadata?.zod, fallbackType);
};

const describeSchema = (schema: ZodSchema): string => {
	if (schema.type === "array") {
		return `array<${describeSchema(schema.element)}>`;
	}
	if (schema.type === "enum") {
		return schema.values.length > 0
			? `enum(${schema.values.join(", ")})`
			: "enum";
	}
	if (schema.type === "object") {
		return "object";
	}
	return schema.type;
};

const buildDefaultValue = (schema: ZodSchema): unknown => {
	switch (schema.type) {
		case "string":
			return "";
		case "number":
			return 0;
		case "boolean":
			return false;
		case "array":
			return [];
		case "object":
			return schema.fields.reduce<Record<string, unknown>>((acc, field) => {
				if (field.name) {
					acc[field.name] = buildDefaultValue(field.schema);
				}
				return acc;
			}, {});
		case "enum":
			return schema.values[0] ?? "";
		default:
			return "";
	}
};

const parseEnumValues = (raw: string): string[] => {
	const parts = raw
		.split(/[\n,]/)
		.map((value) => value.trim())
		.filter(Boolean);
	return Array.from(new Set(parts));
};

const formatEnumValues = (values: string[]): string => values.join(", ");

interface FieldsEditorProps {
	fields: ZodField[];
	onChange: (fields: ZodField[]) => void;
}

const FieldsEditor: React.FC<FieldsEditorProps> = ({ fields, onChange }) => {
	const [enumDrafts, setEnumDrafts] = React.useState<Record<string, string>>(
		{},
	);

	React.useEffect(() => {
		setEnumDrafts((prev) => {
			const next: Record<string, string> = { ...prev };
			fields.forEach((field, index) => {
				if (field.schema.type === "enum") {
					const key = `${index}-${field.name}`;
					if (!(key in next)) {
						next[key] = formatEnumValues(field.schema.values);
					}
				}
				if (
					field.schema.type === "array" &&
					field.schema.element.type === "enum"
				) {
					const key = `${index}-${field.name}-array`;
					if (!(key in next)) {
						next[key] = formatEnumValues(field.schema.element.values);
					}
				}
			});
			return next;
		});
	}, [fields]);

	const handleFieldChange = (index: number, updates: Partial<ZodField>) => {
		onChange(
			fields.map((field, currentIndex) =>
				currentIndex === index ? { ...field, ...updates } : field,
			),
		);
	};

	const handleFieldSchemaChange = (index: number, schema: ZodSchema) => {
		handleFieldChange(index, { schema });
	};

	const handleFieldTypeChange = (index: number, type: StateType) => {
		const current = fields[index]?.schema;
		if (current?.type === type) return;
		handleFieldSchemaChange(index, createDefaultSchema(type));
	};

	const handleArrayElementTypeChange = (
		index: number,
		elementType: ArrayElementType,
	) => {
		const current = fields[index]?.schema;
		if (!current || current.type !== "array") return;
		handleFieldSchemaChange(index, {
			type: "array",
			element: createDefaultSchema(elementType),
		});
	};

	const handleEnumValuesChange = (index: number, values: string[]) => {
		const current = fields[index]?.schema;
		if (!current || current.type !== "enum") return;
		handleFieldSchemaChange(index, { type: "enum", values });
	};

	const handleArrayEnumValuesChange = (index: number, values: string[]) => {
		const current = fields[index]?.schema;
		if (!current || current.type !== "array") return;
		if (current.element.type !== "enum") return;
		handleFieldSchemaChange(index, {
			type: "array",
			element: { type: "enum", values },
		});
	};

	const handleAddField = () => {
		onChange([...fields, { name: "", schema: createDefaultSchema("string") }]);
	};

	const handleRemoveField = (index: number) => {
		onChange(fields.filter((_, currentIndex) => currentIndex !== index));
	};

	return (
		<div className="space-y-2">
			{fields.map((field, index) => {
				const schema = field.schema;
				return (
					<div
						key={`${field.name}-${index}`}
						className="rounded-md border p-2 space-y-2"
					>
						<div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] gap-2 items-center">
							<Input
								value={field.name}
								placeholder="Field name"
								className="w-full"
								onChange={(event) =>
									handleFieldChange(index, { name: event.target.value })
								}
							/>
							<Select
								value={schema.type}
								onValueChange={(value) =>
									handleFieldTypeChange(index, value as StateType)
								}
							>
								<SelectTrigger className="w-full">
									<SelectValue placeholder="Type" />
								</SelectTrigger>
								<SelectContent>
									{STATE_TYPES.map((type) => (
										<SelectItem key={type} value={type}>
											{type}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Button
								variant="ghost"
								size="sm"
								className="text-destructive"
								onClick={() => handleRemoveField(index)}
							>
								Remove
							</Button>
						</div>

						{schema.type === "array" && (
							<div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-2 items-center">
								<div className="text-xs text-muted-foreground">
									Element type
								</div>
								<Select
									value={
										ARRAY_ELEMENT_TYPES.includes(
											schema.element.type as ArrayElementType,
										)
											? schema.element.type
											: "string"
									}
									onValueChange={(value) =>
										handleArrayElementTypeChange(
											index,
											value as ArrayElementType,
										)
									}
								>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="Element type" />
									</SelectTrigger>
									<SelectContent>
										{ARRAY_ELEMENT_TYPES.map((type) => (
											<SelectItem key={type} value={type}>
												{type}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						)}

						{schema.type === "enum" && (
							<div className="space-y-1">
								<div className="text-xs text-muted-foreground">Values</div>
								<Input
									value={enumDrafts[`${index}-${field.name}`] ?? ""}
									placeholder="value1, value2"
									onChange={(event) =>
										setEnumDrafts((prev) => ({
											...prev,
											[`${index}-${field.name}`]: event.target.value,
										}))
									}
									onBlur={(event) =>
										handleEnumValuesChange(
											index,
											parseEnumValues(event.target.value),
										)
									}
								/>
							</div>
						)}

						{schema.type === "object" && (
							<div className="pl-3 border-l border-border/50">
								<FieldsEditor
									fields={schema.fields}
									onChange={(next) =>
										handleFieldSchemaChange(index, {
											type: "object",
											fields: next,
										})
									}
								/>
							</div>
						)}

						{schema.type === "array" && schema.element.type === "object" && (
							<div className="pl-3 border-l border-border/50">
								<FieldsEditor
									fields={schema.element.fields}
									onChange={(next) =>
										handleFieldSchemaChange(index, {
											type: "array",
											element: { type: "object", fields: next },
										})
									}
								/>
							</div>
						)}

						{schema.type === "array" && schema.element.type === "enum" && (
							<div className="space-y-1">
								<div className="text-xs text-muted-foreground">
									Element values
								</div>
								<Input
									value={enumDrafts[`${index}-${field.name}-array`] ?? ""}
									placeholder="value1, value2"
									onChange={(event) =>
										setEnumDrafts((prev) => ({
											...prev,
											[`${index}-${field.name}-array`]: event.target.value,
										}))
									}
									onBlur={(event) =>
										handleArrayEnumValuesChange(
											index,
											parseEnumValues(event.target.value),
										)
									}
								/>
							</div>
						)}
					</div>
				);
			})}

			<Button variant="outline" size="sm" onClick={handleAddField}>
				Add field
			</Button>
		</div>
	);
};

interface ValueEditorProps {
	schema: ZodSchema;
	value: unknown;
	onChange: (value: unknown) => void;
}

const ValueEditor: React.FC<ValueEditorProps> = ({
	schema,
	value,
	onChange,
}) => {
	if (schema.type === "string") {
		return (
			<Textarea
				rows={3}
				value={typeof value === "string" ? value : ""}
				onChange={(event) => onChange(event.target.value)}
			/>
		);
	}

	if (schema.type === "number") {
		const numberValue =
			typeof value === "number" || value === "" ? value : Number(value);
		return (
			<Input
				type="number"
				value={Number.isNaN(numberValue) ? "" : numberValue}
				onChange={(event) => {
					const raw = event.target.value;
					onChange(raw === "" ? "" : Number(raw));
				}}
			/>
		);
	}

	if (schema.type === "boolean") {
		return (
			<label className="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					className="h-4 w-4 rounded border border-input"
					checked={Boolean(value)}
					onChange={(event) => onChange(event.target.checked)}
				/>
				<span>{Boolean(value) ? "True" : "False"}</span>
			</label>
		);
	}

	if (schema.type === "enum") {
		const safeValue =
			typeof value === "string" && schema.values.includes(value)
				? value
				: (schema.values[0] ?? "");
		return (
			<Select
				value={safeValue}
				onValueChange={(nextValue) => onChange(nextValue)}
			>
				<SelectTrigger className="w-full">
					<SelectValue placeholder="Select value" />
				</SelectTrigger>
				<SelectContent>
					{schema.values.map((item) => (
						<SelectItem key={item} value={item}>
							{item}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		);
	}

	if (schema.type === "object") {
		const current =
			value && typeof value === "object" && !Array.isArray(value)
				? (value as Record<string, unknown>)
				: {};
		return (
			<div className="space-y-3">
				{schema.fields.length === 0 && (
					<p className="text-xs text-muted-foreground">
						No fields configured for this object.
					</p>
				)}
				{schema.fields.map((field, index) => (
					<div key={`${field.name}-${index}`} className="space-y-2">
						<div className="text-xs uppercase tracking-wide text-muted-foreground">
							{field.name || "Unnamed field"}
						</div>
						<ValueEditor
							schema={field.schema}
							value={current[field.name]}
							onChange={(nextValue) =>
								onChange({ ...current, [field.name]: nextValue })
							}
						/>
					</div>
				))}
			</div>
		);
	}

	if (schema.type === "array") {
		const items = Array.isArray(value) ? value : [];
		return (
			<div className="space-y-2">
				{items.length === 0 && (
					<p className="text-xs text-muted-foreground">No items yet.</p>
				)}
				{items.map((item, index) => (
					<div
						key={`item-${index}`}
						className="rounded-md border p-2 space-y-2"
					>
						<ValueEditor
							schema={schema.element}
							value={item}
							onChange={(nextValue) => {
								const next = [...items];
								next[index] = nextValue;
								onChange(next);
							}}
						/>
						<Button
							variant="ghost"
							size="sm"
							className="text-destructive"
							onClick={() => onChange(items.filter((_, i) => i !== index))}
						>
							Remove item
						</Button>
					</div>
				))}
				<Button
					variant="outline"
					size="sm"
					onClick={() =>
						onChange([...items, buildDefaultValue(schema.element)])
					}
				>
					Add item
				</Button>
			</div>
		);
	}

	return null;
};

interface FlowBuilderInspectorProps {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	flowName: string;
	flowDescription: string;
	flowStatus: string;
	serviceKeys: string[];
	flowStates: FlowStateInput[];
	catalog: FlowCatalog;
	selectedNodeId: string | null;
	error: string | null;
	isLoading: boolean;
	onFlowMetaChange: (meta: {
		name?: string;
		description?: string;
		status?: string;
		serviceKeys?: string[];
	}) => void;
	onAddStateField: (state: FlowStateInput) => void;
	onRemoveStateField: (name: string) => void;
	onUpdateStateField: (name: string, updates: Partial<FlowStateInput>) => void;
}

export const FlowBuilderInspector: React.FC<FlowBuilderInspectorProps> = ({
	isOpen,
	onOpenChange,
	flowName,
	flowDescription,
	flowStatus,
	serviceKeys,
	flowStates,
	catalog,
	selectedNodeId,
	error,
	isLoading,
	onFlowMetaChange,
	onAddStateField,
	onRemoveStateField,
	onUpdateStateField,
}) => {
	const { t } = useTranslation();
	const [activeTab, setActiveTab] = React.useState("properties");
	const [newStateName, setNewStateName] = React.useState("");
	const [newStateType, setNewStateType] = React.useState<StateType>("string");
	const [newStateElementType, setNewStateElementType] =
		React.useState<ArrayElementType>("string");
	const [basicOpen, setBasicOpen] = React.useState(true);
	const [servicesOpen, setServicesOpen] = React.useState(true);
	const [statesOpen, setStatesOpen] = React.useState(true);
	const [testValues, setTestValues] = React.useState<Record<string, unknown>>(
		{},
	);
	const [enumDrafts, setEnumDrafts] = React.useState<Record<string, string>>(
		{},
	);
	const [fieldsDialog, setFieldsDialog] = React.useState<{
		stateName: string;
		mode: "object" | "array";
	} | null>(null);

	const handleServiceToggle = (serviceKey: string) => {
		const next = serviceKeys.includes(serviceKey)
			? serviceKeys.filter((key) => key !== serviceKey)
			: [...serviceKeys, serviceKey];
		onFlowMetaChange({ serviceKeys: next });
	};

	const handleAddState = () => {
		if (!newStateName.trim()) return;
		const trimmedName = newStateName.trim();
		if (BASE_STATE_NAMES.has(trimmedName)) return;
		if (flowStates.some((state) => state.name === trimmedName)) return;
		const schema =
			newStateType === "array"
				? { type: "array", element: createDefaultSchema(newStateElementType) }
				: newStateType === "object"
					? { type: "object", fields: [] }
					: newStateType === "enum"
						? { type: "enum", values: [] }
						: { type: newStateType };
		onAddStateField({
			name: trimmedName,
			type: newStateType,
			metadata: { zod: schema },
		});
		setNewStateName("");
		setNewStateType("string");
		setNewStateElementType("string");
	};

	const updateStateSchema = (state: FlowStateInput, schema: ZodSchema) => {
		if (BASE_STATE_NAMES.has(state.name)) return;
		onUpdateStateField(state.name, {
			type: schema.type,
			metadata: { ...(state.metadata ?? {}), zod: schema },
		});
	};

	const activeDialogState = fieldsDialog
		? (flowStates.find((state) => state.name === fieldsDialog.stateName) ??
			null)
		: null;
	const activeDialogSchema = activeDialogState
		? getStateSchema(activeDialogState)
		: null;
	const dialogFields =
		activeDialogSchema?.type === "object"
			? activeDialogSchema.fields
			: activeDialogSchema?.type === "array" &&
					activeDialogSchema.element.type === "object"
				? activeDialogSchema.element.fields
				: [];

	React.useEffect(() => {
		setTestValues((prev) => {
			const next: Record<string, unknown> = {};
			const names = new Set(flowStates.map((state) => state.name));
			for (const state of flowStates) {
				const schema = getStateSchema(state);
				next[state.name] =
					state.name in prev ? prev[state.name] : buildDefaultValue(schema);
			}
			Object.keys(prev).forEach((key) => {
				if (!names.has(key)) {
					delete next[key];
				}
			});
			return next;
		});
	}, [flowStates]);

	React.useEffect(() => {
		setEnumDrafts((prev) => {
			const next: Record<string, string> = { ...prev };
			flowStates.forEach((state) => {
				const schema = getStateSchema(state);
				if (schema.type === "enum") {
					if (!(state.name in next)) {
						next[state.name] = formatEnumValues(schema.values);
					}
				}
				if (schema.type === "array" && schema.element.type === "enum") {
					const key = `${state.name}::array`;
					if (!(key in next)) {
						next[key] = formatEnumValues(schema.element.values);
					}
				}
			});
			return next;
		});
	}, [flowStates]);

	const selectedStep: CatalogStep | undefined = selectedNodeId
		? catalog.steps.find((step) => step.id === selectedNodeId)
		: undefined;

	return (
		<>
			<Collapsible
				open={isOpen}
				onOpenChange={onOpenChange}
				className={cn(
					"flow-panel border-l bg-background transition-[width] duration-300 ease-in-out h-full max-h-full min-h-0 flex flex-col",
					isOpen ? "w-[420px]" : "w-12",
				)}
			>
				<div className="flex items-center justify-between px-3 py-2 border-b">
					<span
						className={cn(
							"text-xs uppercase tracking-wide text-muted-foreground",
							!isOpen && "hidden",
						)}
					>
						{t("flowBuilder.panels.inspector", { defaultValue: "Inspector" })}
					</span>
					<CollapsibleTrigger asChild>
						<Button variant="ghost" size="icon">
							{isOpen ? (
								<ChevronRight className="h-4 w-4" />
							) : (
								<ChevronLeft className="h-4 w-4" />
							)}
						</Button>
					</CollapsibleTrigger>
				</div>
				<CollapsibleContent className="flow-panel-content p-4 overflow-auto flex-1 min-h-0 max-h-full space-y-4">
					{error && (
						<div className="text-sm text-destructive border border-destructive/30 rounded-md p-2">
							{error}
						</div>
					)}

					<Tabs value={activeTab} onValueChange={setActiveTab}>
						<TabsList className="grid grid-cols-2">
							<TabsTrigger value="properties">
								<Settings2 className="h-4 w-4 mr-1" />
								{t("flowBuilder.tabs.properties", {
									defaultValue: "Properties",
								})}
							</TabsTrigger>
							<TabsTrigger value="testing">
								<Play className="h-4 w-4 mr-1" />
								{t("flowBuilder.tabs.testing", { defaultValue: "Testing" })}
							</TabsTrigger>
						</TabsList>

						<TabsContent value="properties" className="space-y-6 pt-4">
							<Collapsible open={basicOpen} onOpenChange={setBasicOpen}>
								<div className="flex items-center justify-between">
									<CollapsibleTrigger asChild>
										<button
											type="button"
											className="flex w-full items-center justify-between text-left text-sm font-semibold"
										>
											<span>
												{t("flowBuilder.sections.basic", {
													defaultValue: "Basic",
												})}
											</span>
											<ChevronDown
												className={cn(
													"h-4 w-4 transition-transform",
													basicOpen && "rotate-180",
												)}
											/>
										</button>
									</CollapsibleTrigger>
								</div>
								<CollapsibleContent className="pt-3 space-y-3">
									<Input
										value={flowName}
										placeholder={t("flowBuilder.placeholders.flowName", {
											defaultValue: "Flow name",
										})}
										onChange={(event) =>
											onFlowMetaChange({ name: event.target.value })
										}
									/>
									<Textarea
										value={flowDescription}
										placeholder={t("flowBuilder.placeholders.description", {
											defaultValue: "Description",
										})}
										rows={3}
										onChange={(event) =>
											onFlowMetaChange({ description: event.target.value })
										}
									/>
									<Input
										value={flowStatus}
										placeholder={t("flowBuilder.placeholders.status", {
											defaultValue: "Status",
										})}
										onChange={(event) =>
											onFlowMetaChange({ status: event.target.value })
										}
									/>
								</CollapsibleContent>
							</Collapsible>

							{/* Services */}
							<Collapsible open={servicesOpen} onOpenChange={setServicesOpen}>
								<div className="flex items-center justify-between">
									<CollapsibleTrigger asChild>
										<button
											type="button"
											className="flex w-full items-center justify-between text-left text-sm font-semibold"
										>
											<span>
												{t("flowBuilder.sections.services", {
													defaultValue: "Services",
												})}
											</span>
											<ChevronDown
												className={cn(
													"h-4 w-4 transition-transform",
													servicesOpen && "rotate-180",
												)}
											/>
										</button>
									</CollapsibleTrigger>
								</div>
								<CollapsibleContent className="pt-3 space-y-2">
									{catalog.services.map((service) => (
										<label
											key={service.id}
											className="flex items-center justify-between rounded-md border px-2 py-2 text-sm"
										>
											<span>{service.name}</span>
											<input
												type="checkbox"
												className="h-4 w-4 rounded border border-input"
												checked={serviceKeys.includes(service.serviceKey)}
												onChange={() => handleServiceToggle(service.serviceKey)}
											/>
										</label>
									))}
									{catalog.services.length === 0 && (
										<p className="text-sm text-muted-foreground">
											{t("flowBuilder.noServices", {
												defaultValue: "No services cataloged yet.",
											})}
										</p>
									)}
								</CollapsibleContent>
							</Collapsible>

							{/* State Fields */}
							<Collapsible open={statesOpen} onOpenChange={setStatesOpen}>
								<div className="flex items-center justify-between">
									<CollapsibleTrigger asChild>
										<button
											type="button"
											className="flex w-full items-center justify-between text-left text-sm font-semibold"
										>
											<span>
												{t("flowBuilder.sections.states", {
													defaultValue: "States",
												})}
											</span>
											<ChevronDown
												className={cn(
													"h-4 w-4 transition-transform",
													statesOpen && "rotate-180",
												)}
											/>
										</button>
									</CollapsibleTrigger>
								</div>
								<CollapsibleContent className="pt-3 space-y-3">
									{flowStates.map((state) => {
										const schema = getStateSchema(state);
										const isBase = BASE_STATE_NAMES.has(state.name);
										return (
											<div
												key={state.name}
												className="rounded-md border p-3 space-y-3"
											>
												<div className="flex items-center justify-between">
													<div>
														<div className="font-medium">{state.name}</div>
														<div className="text-xs text-muted-foreground">
															{describeSchema(schema)}
															{isBase && " • Base"}
														</div>
													</div>
													<Button
														variant="ghost"
														size="sm"
														className="text-destructive"
														disabled={isBase}
														onClick={() => onRemoveStateField(state.name)}
													>
														{t("buttons.delete", { defaultValue: "Delete" })}
													</Button>
												</div>

												<div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-2 items-center">
													<div className="text-xs text-muted-foreground">
														Type
													</div>
													<Select
														value={schema.type}
														disabled={isBase}
														onValueChange={(value) => {
															const nextType = value as StateType;
															const nextSchema =
																schema.type === nextType
																	? schema
																	: createDefaultSchema(nextType);
															updateStateSchema(state, nextSchema);
														}}
													>
														<SelectTrigger className="w-full">
															<SelectValue placeholder="Type" />
														</SelectTrigger>
														<SelectContent>
															{STATE_TYPES.map((type) => (
																<SelectItem key={type} value={type}>
																	{type}
																</SelectItem>
															))}
														</SelectContent>
													</Select>
												</div>

												{schema.type === "array" && (
													<div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-2 items-center">
														<div className="text-xs text-muted-foreground">
															Element type
														</div>
														<Select
															value={
																ARRAY_ELEMENT_TYPES.includes(
																	schema.element.type as ArrayElementType,
																)
																	? schema.element.type
																	: "string"
															}
															disabled={isBase}
															onValueChange={(value) =>
																updateStateSchema(state, {
																	type: "array",
																	element: createDefaultSchema(
																		value as ArrayElementType,
																	),
																})
															}
														>
															<SelectTrigger className="w-full">
																<SelectValue placeholder="Element type" />
															</SelectTrigger>
															<SelectContent>
																{ARRAY_ELEMENT_TYPES.map((type) => (
																	<SelectItem key={type} value={type}>
																		{type}
																	</SelectItem>
																))}
															</SelectContent>
														</Select>
													</div>
												)}

												{schema.type === "enum" && (
													<div className="space-y-1">
														<div className="text-xs text-muted-foreground">
															Values
														</div>
														<Input
															value={enumDrafts[state.name] ?? ""}
															placeholder="value1, value2"
															disabled={isBase}
															onChange={(event) =>
																setEnumDrafts((prev) => ({
																	...prev,
																	[state.name]: event.target.value,
																}))
															}
															onBlur={(event) =>
																updateStateSchema(state, {
																	type: "enum",
																	values: parseEnumValues(event.target.value),
																})
															}
														/>
													</div>
												)}

												{schema.type === "object" && (
													<Button
														variant="outline"
														size="sm"
														disabled={isBase}
														onClick={() =>
															setFieldsDialog({
																stateName: state.name,
																mode: "object",
															})
														}
													>
														Edit object fields
													</Button>
												)}

												{schema.type === "array" &&
													schema.element.type === "object" && (
														<Button
															variant="outline"
															size="sm"
															disabled={isBase}
															onClick={() =>
																setFieldsDialog({
																	stateName: state.name,
																	mode: "array",
																})
															}
														>
															Edit item fields
														</Button>
													)}

												{schema.type === "array" &&
													schema.element.type === "enum" && (
														<div className="space-y-1">
															<div className="text-xs text-muted-foreground">
																Element values
															</div>
															<Input
																value={enumDrafts[`${state.name}::array`] ?? ""}
																placeholder="value1, value2"
																disabled={isBase}
																onChange={(event) =>
																	setEnumDrafts((prev) => ({
																		...prev,
																		[`${state.name}::array`]:
																			event.target.value,
																	}))
																}
																onBlur={(event) =>
																	updateStateSchema(state, {
																		type: "array",
																		element: {
																			type: "enum",
																			values: parseEnumValues(
																				event.target.value,
																			),
																		},
																	})
																}
															/>
														</div>
													)}
											</div>
										);
									})}
									{flowStates.length === 0 && (
										<p className="text-sm text-muted-foreground">
											{t("flowBuilder.noStateFields", {
												defaultValue: "No state fields yet.",
											})}
										</p>
									)}

									<div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] gap-2">
										<Input
											placeholder={t("flowBuilder.placeholders.stateName", {
												defaultValue: "State name",
											})}
											value={newStateName}
											onChange={(event) => setNewStateName(event.target.value)}
										/>
										<Select
											value={newStateType}
											onValueChange={(value) =>
												setNewStateType(value as StateType)
											}
										>
											<SelectTrigger className="w-full">
												<SelectValue
													placeholder={t("flowBuilder.placeholders.type", {
														defaultValue: "Type",
													})}
												/>
											</SelectTrigger>
											<SelectContent>
												{STATE_TYPES.map((type) => (
													<SelectItem key={type} value={type}>
														{type}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<Button variant="outline" onClick={handleAddState}>
											{t("buttons.add", { defaultValue: "Add" })}
										</Button>
									</div>

									{newStateType === "array" && (
										<div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-2 items-center">
											<div className="text-xs text-muted-foreground">
												Element type
											</div>
											<Select
												value={newStateElementType}
												onValueChange={(value) =>
													setNewStateElementType(value as ArrayElementType)
												}
											>
												<SelectTrigger className="w-full">
													<SelectValue placeholder="Element type" />
												</SelectTrigger>
												<SelectContent>
													{ARRAY_ELEMENT_TYPES.map((type) => (
														<SelectItem key={type} value={type}>
															{type}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
									)}
								</CollapsibleContent>
							</Collapsible>

							{/* Step Properties */}
							<div className="space-y-3">
								<div className="text-xs uppercase tracking-wide text-muted-foreground">
									{t("flowBuilder.sections.stepProperties", {
										defaultValue: "Step Properties",
									})}
								</div>
								{selectedStep ? (
									<div className="rounded-md border p-3 text-sm space-y-2">
										<div className="font-semibold">{selectedStep.name}</div>
										<div className="text-xs text-muted-foreground">
											{t("flowBuilder.labels.type", { defaultValue: "Type" })}:{" "}
											{selectedStep.type}
										</div>
										{typeof selectedStep.metadata?.description === "string" && (
											<div className="text-xs text-muted-foreground">
												{selectedStep.metadata.description}
											</div>
										)}
									</div>
								) : (
									<p className="text-sm text-muted-foreground">
										{t("flowBuilder.selectNodeForProperties", {
											defaultValue: "Select a node to see step properties.",
										})}
									</p>
								)}
							</div>
						</TabsContent>

						<TabsContent value="testing" className="pt-4 space-y-4">
							{flowStates.length === 0 && (
								<div className="rounded-md border p-3 text-sm text-muted-foreground">
									{t("flowBuilder.noStateFields", {
										defaultValue: "No state fields yet.",
									})}
								</div>
							)}
							{flowStates.map((state) => {
								const schema = getStateSchema(state);
								const value =
									testValues[state.name] ?? buildDefaultValue(schema);
								return (
									<div
										key={state.name}
										className="rounded-md border p-3 space-y-3"
									>
										<div className="flex items-center justify-between">
											<div className="font-medium">{state.name}</div>
											<div className="text-xs text-muted-foreground">
												{describeSchema(schema)}
											</div>
										</div>
										<ValueEditor
											schema={schema}
											value={value}
											onChange={(nextValue) =>
												setTestValues((prev) => ({
													...prev,
													[state.name]: nextValue,
												}))
											}
										/>
									</div>
								);
							})}
						</TabsContent>
					</Tabs>

					<div className="text-xs text-muted-foreground">
						{isLoading
							? t("status.loading", { defaultValue: "Loading..." })
							: t("flowBuilder.ready", { defaultValue: "Ready" })}
					</div>
				</CollapsibleContent>
			</Collapsible>

			<Dialog
				open={Boolean(fieldsDialog)}
				onOpenChange={() => setFieldsDialog(null)}
			>
				<DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden">
					<DialogHeader>
						<DialogTitle>
							{activeDialogState
								? `${activeDialogState.name} fields`
								: "Edit fields"}
						</DialogTitle>
						<DialogDescription>
							Configure nested fields for object state types.
						</DialogDescription>
					</DialogHeader>
					<div className="overflow-auto max-h-[60vh] pr-1">
						{activeDialogState &&
						BASE_STATE_NAMES.has(activeDialogState.name) ? (
							<p className="text-sm text-muted-foreground">
								Base states are read-only.
							</p>
						) : activeDialogState && activeDialogSchema ? (
							<FieldsEditor
								fields={dialogFields}
								onChange={(next) => {
									if (activeDialogSchema.type === "object") {
										updateStateSchema(activeDialogState, {
											type: "object",
											fields: next,
										});
										return;
									}
									if (
										activeDialogSchema.type === "array" &&
										activeDialogSchema.element.type === "object"
									) {
										updateStateSchema(activeDialogState, {
											type: "array",
											element: { type: "object", fields: next },
										});
									}
								}}
							/>
						) : (
							<p className="text-sm text-muted-foreground">
								Select a state to edit fields.
							</p>
						)}
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setFieldsDialog(null)}>
							Done
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
};
