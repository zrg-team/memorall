import React from "react";
import { useTranslation } from "react-i18next";
import {
	AlertCircle,
	AlertTriangle,
	ArrowLeft,
	Check,
	ExternalLink,
	Eye,
	EyeOff,
	FolderOpen,
	Loader2,
	Lock,
	Package,
	Play,
	Plus,
	KeyRound,
	ShieldCheck,
	TerminalSquare,
	X,
} from "lucide-react";
import { Badge } from "@/main/components/ui/badge";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import { Label } from "@/main/components/ui/label";
import { Switch } from "@/main/components/ui/switch";
import { Textarea } from "@/main/components/ui/textarea";
import { MasterKeySetupDialog } from "@/main/components/molecules/MasterKeySetupDialog";
import { PasskeyPromptDialog } from "@/main/components/molecules/PasskeyPromptDialog";
import { cn } from "@/lib/utils";
import { useConnectionsStore } from "@/main/stores/connections";
import type { McpStdioRuntimeProbe } from "@/platform/contracts/core";
import { platform } from "@/platform/current";
import {
	approveStdio,
	buildTemplateStdio,
	type CachedToolDescriptor,
	connectionSecretRef,
	discoverStdioConnection,
	findLocalServerTemplate,
	formatCommandLine,
	isStdioApproved,
	LOCAL_SERVER_CATEGORIES,
	LOCAL_SERVER_TEMPLATES,
	type LocalServerTemplate,
	type LocalServerTemplateField,
	loadStdioSecrets,
	type McpConnection,
	RUNTIME_COMMAND,
	revokeStdioApproval,
	type StdioConnectionDetail,
	saveToolCacheEntry,
	templateDefaults,
	templateKeyRequirement,
	toServerKey,
} from "@/services/mcp-connections";
import { logError } from "@/utils/logger";
import {
	hasMasterKey,
	isMasterKeyUnlocked,
	saveSecret,
	setupMasterKey,
	unlockMasterKey,
} from "@/utils/master-key";
import { KeyGuidePopover } from "./KeyGuidePopover";
import { LocalServerLog } from "./LocalServerLog";
import { ToolScopeList } from "./ToolScopeList";

const CUSTOM = "custom";

const INSTALL_LINKS = {
	node: "https://nodejs.org/en/download",
	python: "https://docs.astral.sh/uv/getting-started/installation/",
	docker: "https://docs.docker.com/get-started/get-docker/",
} as const;

const newId = (): string =>
	typeof crypto !== "undefined" && "randomUUID" in crypto
		? crypto.randomUUID()
		: `conn_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

interface EnvRow {
	key: string;
	value: string;
	secret: boolean;
}

type RunState =
	| { kind: "idle" }
	| { kind: "starting" }
	| { kind: "ok"; tools: CachedToolDescriptor[]; latencyMs: number }
	| { kind: "failed"; reason: string; error: string };

const splitLines = (text: string): string[] =>
	text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);

const envRowsFrom = (detail: StdioConnectionDetail | undefined): EnvRow[] => [
	...Object.entries(detail?.env ?? {}).map(([key, value]) => ({
		key,
		value,
		secret: false,
	})),
	...(detail?.secretEnvKeys ?? []).map((key) => ({
		key,
		value: "",
		secret: true,
	})),
];

const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
	<Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
		{children}
	</Label>
);

/** A path input with the native folder picker next to it. */
const DirectoryInput: React.FC<{
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
}> = ({ value, onChange, placeholder }) => {
	const { t } = useTranslation("connections");
	return (
		<div className="flex gap-1.5">
			<Input
				value={value}
				onChange={(event) => onChange(event.target.value)}
				placeholder={placeholder}
				className="h-9 min-w-0 flex-1 rounded-lg font-mono text-xs"
			/>
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="h-9 shrink-0 rounded-lg px-2.5 text-[11px]"
				onClick={async () => {
					const picked = await platform.mcpStdio?.pickDirectory();
					if (picked) onChange(picked);
				}}
			>
				<FolderOpen size={12} className="mr-1" />
				{t("template.browse")}
			</Button>
		</div>
	);
};

/** A key field: masked, with a way to check what was pasted. */
const SecretInput: React.FC<{
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
}> = ({ value, onChange, placeholder }) => {
	const { t } = useTranslation("connections");
	const [visible, setVisible] = React.useState(false);
	return (
		<div className="relative">
			<KeyRound
				size={12}
				className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
			/>
			<Input
				type={visible ? "text" : "password"}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				placeholder={placeholder}
				autoComplete="off"
				spellCheck={false}
				className="h-9 rounded-lg pl-7 pr-9 font-mono text-xs"
			/>
			<button
				type="button"
				onClick={() => setVisible((current) => !current)}
				aria-label={visible ? t("template.hideKey") : t("template.showKey")}
				className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
			>
				{visible ? <EyeOff size={12} /> : <Eye size={12} />}
			</button>
		</div>
	);
};

const TemplateFieldInput: React.FC<{
	template: LocalServerTemplate;
	field: LocalServerTemplateField;
	value: string;
	hasStoredSecret: boolean;
	onChange: (value: string) => void;
}> = ({ template, field, value, hasStoredSecret, onChange }) => {
	const { t } = useTranslation("connections");
	const base = `template.fields.${template.id}.${field.key}`;
	const label = t(`${base}.label`, { defaultValue: field.key });
	const hint = t(`${base}.hint`, { defaultValue: "" });

	let control: React.ReactNode;
	if (field.type === "directories") {
		const entries = value ? value.split("\n") : [""];
		const update = (next: string[]) => onChange(next.join("\n"));
		control = (
			<div className="space-y-1.5">
				{entries.map((entry, index) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity beyond position
						key={index}
						className="flex items-center gap-1.5"
					>
						<div className="min-w-0 flex-1">
							<DirectoryInput
								value={entry}
								onChange={(next) =>
									update(entries.map((old, i) => (i === index ? next : old)))
								}
							/>
						</div>
						{entries.length > 1 ? (
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="h-8 w-8 shrink-0"
								aria-label={t("template.remove")}
								onClick={() => update(entries.filter((_, i) => i !== index))}
							>
								<X size={12} />
							</Button>
						) : null}
					</div>
				))}
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-7 px-2 text-[11px]"
					onClick={() => update([...entries, ""])}
				>
					<Plus size={11} className="mr-1" />
					{t("template.addDirectory")}
				</Button>
			</div>
		);
	} else if (field.type === "directory") {
		control = <DirectoryInput value={value} onChange={onChange} />;
	} else if (field.type === "toggle") {
		return (
			<div className="flex items-start justify-between gap-3 rounded-lg border border-border/60 px-3 py-2">
				<div className="min-w-0 space-y-0.5">
					<p className="text-xs font-medium">{label}</p>
					{hint ? (
						<p className="text-[10px] text-muted-foreground">{hint}</p>
					) : null}
				</div>
				<Switch
					aria-label={label}
					checked={value === "true"}
					onCheckedChange={(checked) => onChange(checked ? "true" : "false")}
				/>
			</div>
		);
	} else if (field.type === "secret") {
		control = (
			<SecretInput
				value={value}
				onChange={onChange}
				placeholder={
					hasStoredSecret ? t("template.secretStored") : field.placeholder
				}
			/>
		);
	} else {
		control = (
			<Input
				type="text"
				value={value}
				onChange={(event) => onChange(event.target.value)}
				placeholder={field.placeholder}
				className="h-9 rounded-lg font-mono text-xs"
			/>
		);
	}

	return (
		<div className="space-y-1.5">
			<div className="flex flex-wrap items-center justify-between gap-1">
				<FieldLabel>
					{label}
					{field.required ? " *" : ""}
				</FieldLabel>
				{field.guide ? (
					<KeyGuidePopover
						templateId={template.id}
						fieldKey={field.key}
						guide={field.guide}
					/>
				) : null}
			</div>
			{control}
			{hint ? (
				<p className="text-[10px] text-muted-foreground">{hint}</p>
			) : null}
		</div>
	);
};

/** Whether the launcher this server needs is installed, with a way to fix it. */
const RuntimeCheck: React.FC<{
	command: string;
	runtime?: LocalServerTemplate["runtime"];
}> = ({ command, runtime }) => {
	const { t } = useTranslation("connections");
	const [probe, setProbe] = React.useState<McpStdioRuntimeProbe | null>(null);
	const [checking, setChecking] = React.useState(false);

	const check = React.useCallback(async () => {
		const port = platform.mcpStdio;
		if (!port || !command) return;
		setChecking(true);
		try {
			const result = await port.probe([command]);
			setProbe(result[command] ?? { found: false });
		} catch (error) {
			logError("[LocalServer] Runtime probe failed:", error);
			setProbe(null);
		} finally {
			setChecking(false);
		}
	}, [command]);

	React.useEffect(() => {
		setProbe(null);
		void check();
	}, [check]);

	if (!command) return null;
	if (checking && !probe) {
		return (
			<p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
				<Loader2 size={11} className="animate-spin" />
				{t("template.runtimeChecking", { command })}
			</p>
		);
	}
	if (!probe) return null;
	if (probe.found) {
		return (
			<p
				className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400"
				title={probe.path}
			>
				<Check size={11} />
				{t("template.runtimeFound", { command })}
				{probe.version ? (
					<span className="font-mono text-muted-foreground">
						{probe.version}
					</span>
				) : null}
			</p>
		);
	}

	const message =
		runtime === "node"
			? t("template.runtimeMissingNode")
			: runtime === "python"
				? t("template.runtimeMissingPython")
				: runtime === "docker"
					? t("template.runtimeMissingDocker")
					: t("template.runtimeMissingCommand", { command });
	return (
		<div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5">
			<AlertTriangle
				size={13}
				className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
			/>
			<div className="min-w-0 flex-1 space-y-2">
				<p className="text-xs text-amber-700 dark:text-amber-300">{message}</p>
				<div className="flex flex-wrap gap-1.5">
					{runtime ? (
						<Button
							type="button"
							size="sm"
							className="h-7 rounded-lg px-2.5 text-[11px]"
							onClick={() =>
								void platform.externalLinks.open(INSTALL_LINKS[runtime])
							}
						>
							<ExternalLink size={11} className="mr-1" />
							{runtime === "node"
								? t("template.installNode")
								: runtime === "python"
									? t("template.installUv")
									: t("template.installDocker")}
						</Button>
					) : null}
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="h-7 rounded-lg px-2.5 text-[11px]"
						disabled={checking}
						onClick={() => void check()}
					>
						{checking ? (
							<Loader2 size={11} className="mr-1 animate-spin" />
						) : null}
						{t("template.checkAgain")}
					</Button>
				</div>
			</div>
		</div>
	);
};

const TemplateCard: React.FC<{
	template: LocalServerTemplate;
	onPick: (id: string) => void;
}> = ({ template, onPick }) => {
	const { t } = useTranslation("connections");
	const keys = templateKeyRequirement(template);
	return (
		<button
			type="button"
			onClick={() => onPick(template.id)}
			className="flex flex-col gap-1.5 rounded-xl border border-border/60 bg-background/60 p-3 text-left transition-colors hover:border-blue-500/40 hover:bg-blue-500/5"
		>
			<span className="flex flex-wrap items-center gap-1.5">
				<Package size={13} className="shrink-0 text-muted-foreground" />
				<span className="text-xs font-semibold">
					{t(`template.catalog.${template.id}.name`)}
				</span>
				<Badge variant="outline" className="text-[9px]">
					{t(`template.runtime.${template.runtime}`)}
				</Badge>
				{keys !== "none" ? (
					<Badge
						variant="outline"
						className={cn(
							"gap-1 text-[9px]",
							keys === "required"
								? "border-blue-500/30 text-blue-600 dark:text-blue-400"
								: "text-muted-foreground",
						)}
					>
						<KeyRound size={8} />
						{keys === "required"
							? t("template.keyRequired")
							: t("template.keyOptional")}
					</Badge>
				) : null}
				{template.heavy ? (
					<Badge
						variant="outline"
						className="border-amber-500/30 text-[9px] text-amber-600 dark:text-amber-400"
					>
						{t("template.heavy")}
					</Badge>
				) : null}
			</span>
			<span className="text-[11px] leading-relaxed text-muted-foreground">
				{t(`template.catalog.${template.id}.description`)}
			</span>
		</button>
	);
};

const TemplateGrid: React.FC<{ onPick: (id: string) => void }> = ({
	onPick,
}) => {
	const { t } = useTranslation("connections");
	return (
		<div className="@container space-y-4">
			<h3 className="text-xs font-semibold">{t("template.chooseTemplate")}</h3>
			{LOCAL_SERVER_CATEGORIES.map((category) => {
				const templates = LOCAL_SERVER_TEMPLATES.filter(
					(template) => template.category === category,
				);
				if (templates.length === 0) return null;
				return (
					<section key={category} className="space-y-2">
						<h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
							{t(`template.categories.${category}`)}
						</h4>
						<div className="grid gap-2 @md:grid-cols-2">
							{templates.map((template) => (
								<TemplateCard
									key={template.id}
									template={template}
									onPick={onPick}
								/>
							))}
						</div>
					</section>
				);
			})}
			<button
				type="button"
				onClick={() => onPick(CUSTOM)}
				className="flex w-full flex-col gap-1.5 rounded-xl border border-dashed border-border/80 p-3 text-left transition-colors hover:border-blue-500/40 hover:bg-blue-500/5"
			>
				<span className="flex items-center gap-1.5">
					<TerminalSquare
						size={13}
						className="shrink-0 text-muted-foreground"
					/>
					<span className="text-xs font-semibold">
						{t("template.customCommand.name")}
					</span>
				</span>
				<span className="text-[11px] leading-relaxed text-muted-foreground">
					{t("template.customCommand.description")}
				</span>
			</button>
		</div>
	);
};

interface LocalServerSetupProps {
	/** Existing local server to edit; omit to add one. */
	connection?: McpConnection;
	onSaved: (connection: McpConnection) => void;
	onCancel: () => void;
}

/**
 * Add or edit a local MCP server: pick a template (or type a command), fill it
 * in, approve the exact command, watch it start, choose its tools, save.
 *
 * Starting before saving is deliberate. A local server fails in ways a form
 * cannot predict — a missing runtime, a package that will not install, a path
 * the server rejects — and its log is the only useful explanation, so the user
 * sees it here rather than after an agent quietly gets no tools.
 */
export const LocalServerSetup: React.FC<LocalServerSetupProps> = ({
	connection,
	onSaved,
	onCancel,
}) => {
	const { t } = useTranslation("connections");
	const save = useConnectionsStore((state) => state.save);
	const existing = connection?.stdio;

	const [id] = React.useState(() => connection?.id ?? newId());
	const [choice, setChoice] = React.useState<string | null>(() =>
		connection ? (existing?.templateId ?? CUSTOM) : null,
	);
	const template = findLocalServerTemplate(choice ?? undefined);
	const [name, setName] = React.useState(connection?.name ?? "");
	const [values, setValues] = React.useState<Record<string, string>>(
		() => existing?.templateValues ?? {},
	);
	const [command, setCommand] = React.useState(existing?.command ?? "");
	const [argsText, setArgsText] = React.useState(
		existing && !existing.templateId ? existing.args.join("\n") : "",
	);
	const [cwd, setCwd] = React.useState(existing?.cwd ?? "");
	const [envRows, setEnvRows] = React.useState<EnvRow[]>(() =>
		existing?.templateId ? [] : envRowsFrom(existing),
	);
	const [allowlist, setAllowlist] = React.useState<string[]>(
		connection?.toolAllowlist ?? [],
	);
	const [enabledByDefault, setEnabledByDefault] = React.useState(
		connection?.enabledByDefault ?? true,
	);

	const [run, setRun] = React.useState<RunState>({ kind: "idle" });
	const [logTail, setLogTail] = React.useState<string[]>([]);
	const [isSaving, setIsSaving] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [showKeySetup, setShowKeySetup] = React.useState(false);
	const [showKeyUnlock, setShowKeyUnlock] = React.useState(false);

	/** The secrets the last successful start used, which are what gets saved. */
	const secretsRef = React.useRef<Record<string, string>>({});
	/** Cleanup state for leaving without saving. */
	const startedRef = React.useRef(false);
	const savedRef = React.useRef(false);
	const originalApprovalRef = React.useRef<boolean | null>(null);

	const hasStoredSecrets = Boolean(connection?.secretRef);
	// Keys saved for this very template: left blank while editing, they are kept.
	const storedSecretEnvKeys = React.useMemo(
		() =>
			hasStoredSecrets && existing?.templateId === template?.id
				? (existing?.secretEnvKeys ?? [])
				: [],
		[hasStoredSecrets, existing, template?.id],
	);

	React.useEffect(() => {
		if (!connection || !existing) return;
		void isStdioApproved({ ...connection, stdio: existing }).then(
			(approved) => {
				originalApprovalRef.current = approved;
			},
		);
	}, [connection, existing]);

	// Leaving without saving must not leave a process running, or an approval for
	// a command nobody kept. Read through a ref: the store hands out a new object
	// for the same connection on every refresh, and that must not count as leaving.
	const connectionRef = React.useRef(connection);
	connectionRef.current = connection;
	React.useEffect(
		() => () => {
			if (savedRef.current || !startedRef.current) return;
			void platform.mcpStdio?.stop(id).catch(() => null);
			const original = connectionRef.current;
			if (original?.stdio && originalApprovalRef.current) {
				void approveStdio({ ...original, stdio: original.stdio });
			} else {
				void revokeStdioApproval(id);
			}
		},
		[id],
	);

	const built = React.useMemo((): {
		detail: StdioConnectionDetail;
		secretValues: Record<string, string>;
		valid: boolean;
	} | null => {
		if (template) {
			try {
				return {
					...buildTemplateStdio(template, values, { storedSecretEnvKeys }),
					valid: true,
				};
			} catch {
				return null;
			}
		}
		if (choice !== CUSTOM) return null;
		const rows = envRows.filter((row) => row.key.trim());
		const env = Object.fromEntries(
			rows
				.filter((row) => !row.secret)
				.map((row) => [row.key.trim(), row.value]),
		);
		const secretRows = rows.filter((row) => row.secret);
		return {
			detail: {
				command: command.trim(),
				args: splitLines(argsText),
				...(cwd.trim() ? { cwd: cwd.trim() } : {}),
				...(Object.keys(env).length > 0 ? { env } : {}),
				...(secretRows.length > 0
					? { secretEnvKeys: secretRows.map((row) => row.key.trim()) }
					: {}),
			},
			secretValues: Object.fromEntries(
				secretRows
					.filter((row) => row.value)
					.map((row) => [row.key.trim(), row.value]),
			),
			valid: command.trim().length > 0,
		};
	}, [
		template,
		choice,
		values,
		storedSecretEnvKeys,
		command,
		argsText,
		cwd,
		envRows,
	]);

	const displayName =
		name.trim() ||
		(template ? t(`template.catalog.${template.id}.name`) : command.trim());

	const draft = React.useCallback(
		(detail: StdioConnectionDetail): McpConnection => ({
			id,
			kind: "template",
			name: displayName || "local-server",
			transport: "stdio",
			url: "",
			authMode: "none",
			secretRef: detail.secretEnvKeys?.length
				? connectionSecretRef(id)
				: undefined,
			stdio: detail,
			toolAllowlist: allowlist.length > 0 ? allowlist : undefined,
			enabledByDefault,
			createdAt: connection?.createdAt ?? new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		}),
		[id, displayName, allowlist, enabledByDefault, connection?.createdAt],
	);

	// Anything that changes what would run invalidates the last start.
	const fingerprintInput = built ? JSON.stringify(built.detail) : "";
	React.useEffect(() => {
		void fingerprintInput;
		setRun((current) =>
			current.kind === "ok" || current.kind === "failed"
				? { kind: "idle" }
				: current,
		);
	}, [fingerprintInput]);

	// While a start is in flight, its log is the progress bar.
	React.useEffect(() => {
		if (run.kind !== "starting") return;
		const port = platform.mcpStdio;
		if (!port) return;
		const timer = window.setInterval(() => {
			void port
				.status([id])
				.then(([status]) => {
					if (status) setLogTail(status.logTail);
				})
				.catch(() => undefined);
		}, 1_000);
		return () => window.clearInterval(timer);
	}, [run.kind, id]);

	/** Typed secrets win; anything left blank keeps its stored value. */
	const resolveSecrets = async (
		detail: StdioConnectionDetail,
		typed: Record<string, string>,
	): Promise<Record<string, string> | null> => {
		const keys = detail.secretEnvKeys ?? [];
		if (keys.every((key) => typed[key])) return typed;
		if (!connection?.secretRef) return null;
		const stored = await loadStdioSecrets({
			...draft(detail),
			secretRef: connection.secretRef,
			stdio: detail,
		} as McpConnection & { stdio: StdioConnectionDetail });
		if (!stored) return null;
		const merged = { ...stored, ...typed };
		return keys.every((key) => merged[key]) ? merged : null;
	};

	const handleRun = async () => {
		if (!built?.valid) return;
		setError(null);
		const detail = built.detail;
		const secrets = await resolveSecrets(detail, built.secretValues);
		if (!secrets) {
			setRun({
				kind: "failed",
				reason: "locked",
				error: t("template.secretsNeeded"),
			});
			return;
		}
		const candidate = draft(detail) as McpConnection & {
			stdio: StdioConnectionDetail;
		};
		setRun({ kind: "starting" });
		setLogTail([]);
		startedRef.current = true;
		try {
			await approveStdio(candidate);
			const result = await discoverStdioConnection(candidate, secrets);
			const status = await platform.mcpStdio
				?.status([id])
				.catch(() => undefined);
			if (status?.[0]) setLogTail(status[0].logTail);
			if (result.ok) {
				secretsRef.current = secrets;
				setRun({
					kind: "ok",
					tools: result.descriptors,
					latencyMs: result.latencyMs,
				});
			} else {
				setRun({ kind: "failed", reason: result.reason, error: result.error });
			}
		} catch (caught) {
			setRun({
				kind: "failed",
				reason: "unreachable",
				error: caught instanceof Error ? caught.message : String(caught),
			});
		}
	};

	const persist = async () => {
		if (!built || run.kind !== "ok") return;
		const connectionToSave = draft(built.detail);
		if ((built.detail.secretEnvKeys?.length ?? 0) > 0) {
			await saveSecret(
				connectionSecretRef(id),
				JSON.stringify(secretsRef.current),
			);
		}
		await saveToolCacheEntry(id, {
			descriptors: run.tools,
			discoveredAt: new Date().toISOString(),
		});
		savedRef.current = true;
		await save(connectionToSave);
		onSaved(connectionToSave);
	};

	const handleSave = async () => {
		setIsSaving(true);
		setError(null);
		try {
			if ((built?.detail.secretEnvKeys?.length ?? 0) > 0) {
				if (!(await hasMasterKey())) {
					setShowKeySetup(true);
					return;
				}
				if (!(await isMasterKeyUnlocked())) {
					setShowKeyUnlock(true);
					return;
				}
			}
			await persist();
		} catch (caught) {
			logError("[Connections] Failed to save local server:", caught);
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setIsSaving(false);
		}
	};

	// Asked once typing settles, not for every keystroke of a command name.
	const runtimeCommand = template
		? RUNTIME_COMMAND[template.runtime]
		: command.trim();
	const [probeCommand, setProbeCommand] = React.useState(runtimeCommand);
	React.useEffect(() => {
		const timer = window.setTimeout(() => setProbeCommand(runtimeCommand), 500);
		return () => window.clearTimeout(timer);
	}, [runtimeCommand]);

	if (!platform.mcpStdio) {
		return (
			<div className="flex flex-col items-center gap-3 py-10 text-center">
				<p className="text-sm font-semibold">
					{t("lanes.template.notBuiltTitle")}
				</p>
				<p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
					{t("lanes.template.notBuiltBody")}
				</p>
				<Button type="button" variant="outline" size="sm" onClick={onCancel}>
					{t("composio.cancel")}
				</Button>
			</div>
		);
	}

	if (!choice) {
		return (
			<div className="space-y-4">
				<SetupHeader onBack={onCancel} />
				<TemplateGrid
					onPick={(picked) => {
						setChoice(picked);
						const pickedTemplate = findLocalServerTemplate(picked);
						setValues(pickedTemplate ? templateDefaults(pickedTemplate) : {});
					}}
				/>
			</div>
		);
	}

	const prefix = toServerKey({
		name: displayName || "server",
		id,
	} as McpConnection);
	const approvedFingerprintKnown = run.kind === "ok" || run.kind === "failed";

	return (
		<div className="space-y-4">
			<SetupHeader
				onBack={connection ? onCancel : () => setChoice(null)}
				title={
					template
						? t(`template.catalog.${template.id}.name`)
						: t("template.customCommand.name")
				}
				description={
					template
						? t(`template.catalog.${template.id}.description`)
						: t("template.customCommand.description")
				}
				docsUrl={template?.docsUrl}
			/>

			<div className="space-y-1.5">
				<FieldLabel>{t("template.nameLabel")}</FieldLabel>
				<Input
					value={name}
					onChange={(event) => setName(event.target.value)}
					placeholder={displayName}
					className="h-9 rounded-lg text-xs"
				/>
				<p className="text-[10px] text-muted-foreground">
					{t("custom.namePrefixHint", { prefix })}
				</p>
			</div>

			{template ? (
				template.fields.map((field) => (
					<TemplateFieldInput
						key={field.key}
						template={template}
						field={field}
						value={values[field.key] ?? ""}
						hasStoredSecret={
							field.target.kind === "env" &&
							storedSecretEnvKeys.includes(field.target.name)
						}
						onChange={(next) =>
							setValues((current) => ({ ...current, [field.key]: next }))
						}
					/>
				))
			) : (
				<CustomCommandFields
					command={command}
					onCommand={setCommand}
					argsText={argsText}
					onArgs={setArgsText}
					cwd={cwd}
					onCwd={setCwd}
					envRows={envRows}
					onEnvRows={setEnvRows}
					hasStoredSecrets={hasStoredSecrets}
				/>
			)}

			<RuntimeCheck command={probeCommand} runtime={template?.runtime} />

			{built?.valid ? (
				<div className="space-y-2.5 rounded-xl border border-border/60 bg-background/60 p-3">
					<div className="flex items-start gap-2">
						<ShieldCheck
							size={14}
							className="mt-0.5 shrink-0 text-muted-foreground"
						/>
						<div className="min-w-0 flex-1 space-y-1">
							<p className="text-xs font-semibold">
								{t("template.approveTitle")}
							</p>
							<p className="text-[11px] leading-relaxed text-muted-foreground">
								{t("template.approveBody")}
							</p>
						</div>
					</div>
					<pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border/60 bg-muted/40 px-2.5 py-2 font-mono text-[10.5px] leading-relaxed">
						{formatCommandLine(built.detail)}
						{built.detail.cwd ? `\n  cwd: ${built.detail.cwd}` : ""}
						{[
							...Object.keys(built.detail.env ?? {}),
							...(built.detail.secretEnvKeys ?? []),
						].length > 0
							? `\n  env: ${[
									...Object.keys(built.detail.env ?? {}),
									...(built.detail.secretEnvKeys ?? []),
								].join(", ")}`
							: ""}
					</pre>

					{run.kind === "starting" ? (
						<div className="space-y-2">
							<p className="flex items-center gap-1.5 text-xs text-muted-foreground">
								<Loader2 size={12} className="animate-spin" />
								{t("template.starting")}
							</p>
							{template ? (
								<p className="text-[10px] text-muted-foreground">
									{t("template.firstRunHint")}
								</p>
							) : null}
						</div>
					) : run.kind === "ok" ? (
						<div className="flex flex-wrap items-center justify-between gap-2">
							<span className="flex items-center gap-2 text-xs font-semibold">
								<span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
								{t("template.running")} ·{" "}
								{t("detail.toolCount", { count: run.tools.length })}
								<span className="font-mono text-[10px] font-normal text-muted-foreground">
									{run.latencyMs} ms
								</span>
							</span>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="h-7 rounded-lg px-2 text-[10px]"
								onClick={() => void handleRun()}
							>
								{t("template.runAgain")}
							</Button>
						</div>
					) : (
						<div className="space-y-2">
							{run.kind === "failed" ? (
								<div className="flex items-start gap-2">
									<AlertCircle
										size={13}
										className="mt-0.5 shrink-0 text-destructive"
									/>
									<p className="min-w-0 whitespace-pre-wrap break-words text-xs text-destructive">
										{t("template.startFailed", { error: run.error })}
									</p>
								</div>
							) : null}
							{/* Docker installed but its engine is off reads as a crash in the
							    log; say what to do instead. */}
							{run.kind === "failed" &&
							template?.runtime === "docker" &&
							/docker (API|daemon)|daemon is running|dockerDesktopLinuxEngine/i.test(
								`${run.error}\n${logTail.join("\n")}`,
							) ? (
								<p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-700 dark:text-amber-300">
									{t("template.dockerNotRunning")}
								</p>
							) : null}
							<Button
								type="button"
								size="sm"
								className="h-8 rounded-lg px-3 text-xs"
								onClick={() => void handleRun()}
							>
								<Play size={12} className="mr-1.5" />
								{approvedFingerprintKnown
									? t("template.runAgain")
									: t("template.approveAction")}
							</Button>
						</div>
					)}

					{run.kind !== "idle" ? <LocalServerLog lines={logTail} /> : null}
				</div>
			) : null}

			{run.kind === "ok" ? (
				<ToolScopeList
					tools={run.tools}
					value={allowlist}
					onChange={setAllowlist}
				/>
			) : null}

			{error ? (
				<div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-2.5 text-xs text-destructive">
					<AlertCircle size={13} />
					{error}
				</div>
			) : null}

			<div className="flex flex-wrap items-center justify-between gap-3">
				<button
					type="button"
					onClick={() => setEnabledByDefault((value) => !value)}
					className="flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
				>
					<span
						className={cn(
							"flex h-3.5 w-3.5 items-center justify-center rounded border",
							enabledByDefault
								? "border-blue-500 bg-blue-500 text-white"
								: "border-border",
						)}
					>
						{enabledByDefault ? <Check size={9} strokeWidth={3.5} /> : null}
					</span>
					{t("custom.enableByDefault")}
				</button>
				<div className="flex items-center gap-2">
					{run.kind !== "ok" ? (
						<span className="hidden text-[10px] text-muted-foreground sm:inline">
							{t("template.runFirst")}
						</span>
					) : null}
					<Button type="button" variant="outline" size="sm" onClick={onCancel}>
						{t("composio.cancel")}
					</Button>
					<Button
						type="button"
						size="sm"
						disabled={run.kind !== "ok" || isSaving}
						onClick={() => void handleSave()}
					>
						{isSaving ? (
							<Loader2 size={12} className="mr-1 animate-spin" />
						) : null}
						{t("template.save")}
					</Button>
				</div>
			</div>

			<MasterKeySetupDialog
				open={showKeySetup}
				onSetupComplete={async (passkey) => {
					await setupMasterKey(passkey);
					setShowKeySetup(false);
					await persist();
				}}
				onCancel={() => setShowKeySetup(false)}
			/>
			<PasskeyPromptDialog
				open={showKeyUnlock}
				providers={[]}
				onPasskeySubmit={async (passkey) => {
					await unlockMasterKey(passkey);
					setShowKeyUnlock(false);
					await persist();
				}}
				onCancel={() => setShowKeyUnlock(false)}
			/>
		</div>
	);
};

const SetupHeader: React.FC<{
	onBack: () => void;
	title?: string;
	description?: string;
	docsUrl?: string;
}> = ({ onBack, title, description, docsUrl }) => {
	const { t } = useTranslation("connections");
	return (
		<div className="flex items-start gap-2">
			<Button
				type="button"
				variant="ghost"
				size="icon"
				className="h-7 w-7 shrink-0"
				onClick={onBack}
				aria-label={t("composio.cancel")}
			>
				<ArrowLeft size={14} />
			</Button>
			<div className="min-w-0 flex-1">
				<h2 className="text-sm font-semibold">
					{title ?? t("template.title")}
				</h2>
				<p className="text-[11px] text-muted-foreground">
					{description ?? t("template.subtitle")}
				</p>
			</div>
			{docsUrl ? (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-7 shrink-0 px-2 text-[11px]"
					onClick={() => void platform.externalLinks.open(docsUrl)}
				>
					<ExternalLink size={11} className="mr-1" />
					{t("template.docs")}
				</Button>
			) : null}
		</div>
	);
};

const CustomCommandFields: React.FC<{
	command: string;
	onCommand: (value: string) => void;
	argsText: string;
	onArgs: (value: string) => void;
	cwd: string;
	onCwd: (value: string) => void;
	envRows: EnvRow[];
	onEnvRows: (rows: EnvRow[]) => void;
	hasStoredSecrets: boolean;
}> = ({
	command,
	onCommand,
	argsText,
	onArgs,
	cwd,
	onCwd,
	envRows,
	onEnvRows,
	hasStoredSecrets,
}) => {
	const { t } = useTranslation("connections");
	const updateRow = (index: number, patch: Partial<EnvRow>) =>
		onEnvRows(
			envRows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
		);

	return (
		<div className="space-y-3">
			<div className="space-y-1.5">
				<FieldLabel>{t("template.commandLabel")} *</FieldLabel>
				<Input
					value={command}
					onChange={(event) => onCommand(event.target.value)}
					placeholder={t("template.commandPlaceholder")}
					className="h-9 rounded-lg font-mono text-xs"
				/>
			</div>
			<div className="space-y-1.5">
				<FieldLabel>{t("template.argsLabel")}</FieldLabel>
				<Textarea
					value={argsText}
					onChange={(event) => onArgs(event.target.value)}
					placeholder={"-y\n@scope/mcp-server@1.0.0"}
					rows={3}
					className="min-h-[72px] rounded-lg font-mono text-xs"
				/>
				<p className="text-[10px] text-muted-foreground">
					{t("template.argsHint")}
				</p>
			</div>
			<div className="space-y-1.5">
				<FieldLabel>{t("template.cwdLabel")}</FieldLabel>
				<DirectoryInput value={cwd} onChange={onCwd} />
				<p className="text-[10px] text-muted-foreground">
					{t("template.cwdHint")}
				</p>
			</div>
			<div className="space-y-1.5">
				<FieldLabel>{t("template.envLabel")}</FieldLabel>
				{envRows.map((row, index) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity beyond position
						key={index}
						className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap"
					>
						<Input
							value={row.key}
							onChange={(event) =>
								updateRow(index, { key: event.target.value })
							}
							placeholder={t("template.envKeyPlaceholder")}
							className="h-8 w-full rounded-lg font-mono text-xs sm:w-40"
						/>
						<div className="relative min-w-0 flex-1">
							{row.secret ? (
								<Lock
									size={11}
									className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
								/>
							) : null}
							<Input
								type={row.secret ? "password" : "text"}
								value={row.value}
								onChange={(event) =>
									updateRow(index, { value: event.target.value })
								}
								placeholder={
									row.secret && hasStoredSecrets
										? t("template.secretStored")
										: t("template.envValuePlaceholder")
								}
								className={cn(
									"h-8 rounded-lg font-mono text-xs",
									row.secret && "pl-6",
								)}
							/>
						</div>
						<button
							type="button"
							onClick={() => updateRow(index, { secret: !row.secret })}
							className={cn(
								"h-8 shrink-0 rounded-lg border px-2 text-[10px] font-semibold transition-colors",
								row.secret
									? "border-blue-500/30 bg-blue-500/10 text-blue-500"
									: "border-border text-muted-foreground hover:text-foreground",
							)}
						>
							{t("template.envSecret")}
						</button>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="h-8 w-8 shrink-0"
							aria-label={t("template.remove")}
							onClick={() => onEnvRows(envRows.filter((_, i) => i !== index))}
						>
							<X size={12} />
						</Button>
					</div>
				))}
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-7 px-2 text-[11px]"
					onClick={() =>
						onEnvRows([...envRows, { key: "", value: "", secret: false }])
					}
				>
					<Plus size={11} className="mr-1" />
					{t("template.addEnv")}
				</Button>
				<p className="text-[10px] text-muted-foreground">
					{t("template.envHint")}
				</p>
			</div>
		</div>
	);
};
