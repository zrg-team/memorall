import React from "react";
import { useTranslation } from "react-i18next";
import {
	AlertCircle,
	Check,
	Eye,
	EyeOff,
	Loader2,
	Lock,
	RefreshCw,
	Shield,
} from "lucide-react";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import { Label } from "@/main/components/ui/label";
import { Textarea } from "@/main/components/ui/textarea";
import { Badge } from "@/main/components/ui/badge";
import { MasterKeySetupDialog } from "@/main/components/molecules/MasterKeySetupDialog";
import { PasskeyPromptDialog } from "@/main/components/molecules/PasskeyPromptDialog";
import { cn } from "@/lib/utils";
import { logError } from "@/utils/logger";
import {
	connectionSecretRef,
	discoverConnection,
	toServerKey,
	type CachedToolDescriptor,
	type ConnectionAuthMode,
	type McpConnection,
} from "@/services/mcp-connections";
import {
	hasMasterKey,
	isMasterKeyUnlocked,
	saveSecret,
	setupMasterKey,
	unlockMasterKey,
} from "@/utils/master-key";
import { useConnectionsStore } from "@/main/stores/connections";
import { ToolScopeList } from "./ToolScopeList";

const AUTH_MODES: ConnectionAuthMode[] = ["none", "bearer", "header", "query"];

const AUTH_LABEL_KEYS: Record<ConnectionAuthMode, string> = {
	none: "custom.authNone",
	bearer: "custom.authBearer",
	header: "custom.authHeader",
	query: "custom.authQuery",
};

const newId = (): string =>
	typeof crypto !== "undefined" && "randomUUID" in crypto
		? crypto.randomUUID()
		: `conn_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

const parseHeaders = (text: string): Record<string, string> => {
	const result: Record<string, string> = {};
	for (const line of text.split("\n")) {
		const colon = line.indexOf(":");
		if (colon > 0) {
			const key = line.slice(0, colon).trim();
			if (key) result[key] = line.slice(colon + 1).trim();
		}
	}
	return result;
};

const serializeHeaders = (headers?: Record<string, string>): string =>
	Object.entries(headers ?? {})
		.map(([key, value]) => `${key}: ${value}`)
		.join("\n");

interface CustomEndpointFormProps {
	/** Existing connection to edit; omit to create. */
	connection?: McpConnection;
	onSaved: (connection: McpConnection) => void;
	onCancel: () => void;
}

type TestState =
	| { kind: "idle" }
	| { kind: "testing" }
	| { kind: "ok"; tools: CachedToolDescriptor[]; latencyMs: number }
	| { kind: "failed"; error: string };

export const CustomEndpointForm: React.FC<CustomEndpointFormProps> = ({
	connection,
	onSaved,
	onCancel,
}) => {
	const { t } = useTranslation("connections");
	const save = useConnectionsStore((state) => state.save);

	const [id] = React.useState(() => connection?.id ?? newId());
	const [name, setName] = React.useState(connection?.name ?? "");
	const [transport, setTransport] = React.useState<"http" | "sse">(
		connection?.transport ?? "http",
	);
	const [url, setUrl] = React.useState(connection?.url ?? "");
	const [authMode, setAuthMode] = React.useState<ConnectionAuthMode>(
		connection?.authMode ?? "none",
	);
	const [authHeaderName, setAuthHeaderName] = React.useState(
		connection?.authHeaderName ?? "X-Api-Key",
	);
	const [authQueryParam, setAuthQueryParam] = React.useState(
		connection?.authQueryParam ?? "key",
	);
	const [secret, setSecret] = React.useState("");
	const [showSecret, setShowSecret] = React.useState(false);
	const [headersText, setHeadersText] = React.useState(
		serializeHeaders(connection?.headers),
	);
	const [enabledByDefault, setEnabledByDefault] = React.useState(
		connection?.enabledByDefault ?? true,
	);
	const [allowlist, setAllowlist] = React.useState<string[]>(
		connection?.toolAllowlist ?? [],
	);

	const [test, setTest] = React.useState<TestState>({ kind: "idle" });
	const [isSaving, setIsSaving] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [showKeySetup, setShowKeySetup] = React.useState(false);
	const [showKeyUnlock, setShowKeyUnlock] = React.useState(false);

	const needsSecret = authMode !== "none";
	// Editing an existing connection keeps its stored secret unless retyped.
	const hasStoredSecret = Boolean(connection?.secretRef);
	const canTest =
		name.trim().length > 0 &&
		url.trim().length > 0 &&
		(!needsSecret || secret.length > 0 || hasStoredSecret);
	const canSave = canTest && test.kind === "ok";

	const draft = React.useCallback(
		(): McpConnection => ({
			id,
			kind: "custom",
			name: name.trim(),
			transport,
			url: url.trim(),
			authMode,
			authHeaderName: authMode === "header" ? authHeaderName.trim() : undefined,
			authQueryParam: authMode === "query" ? authQueryParam.trim() : undefined,
			secretRef: needsSecret ? connectionSecretRef(id) : undefined,
			headers: parseHeaders(headersText),
			toolAllowlist: allowlist.length > 0 ? allowlist : undefined,
			enabledByDefault,
			createdAt: connection?.createdAt ?? new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		}),
		[
			id,
			name,
			transport,
			url,
			authMode,
			authHeaderName,
			authQueryParam,
			needsSecret,
			headersText,
			allowlist,
			enabledByDefault,
			connection?.createdAt,
		],
	);

	// Any change to how we'd connect invalidates a previous green tick.
	React.useEffect(() => {
		setTest((current) => (current.kind === "ok" ? { kind: "idle" } : current));
	}, [url, transport, authMode, secret, headersText]);

	const handleTest = async () => {
		setTest({ kind: "testing" });
		setError(null);
		try {
			const result = await discoverConnection(
				draft(),
				secret.length > 0 ? secret : undefined,
			);
			setTest(
				result.ok
					? {
							kind: "ok",
							tools: result.descriptors,
							latencyMs: result.latencyMs,
						}
					: { kind: "failed", error: result.error },
			);
		} catch (caught) {
			setTest({
				kind: "failed",
				error: caught instanceof Error ? caught.message : String(caught),
			});
		}
	};

	const persist = async () => {
		const connectionToSave = draft();

		if (needsSecret && secret.length > 0) {
			await saveSecret(connectionSecretRef(id), secret);
		}

		await save(connectionToSave);
		onSaved(connectionToSave);
	};

	const handleSave = async () => {
		setIsSaving(true);
		setError(null);
		try {
			// Storing a credential requires the master key; mirror the LLM provider
			// tabs so users meet the same two dialogs they already know.
			if (needsSecret && secret.length > 0) {
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
			logError("[Connections] Failed to save custom endpoint:", caught);
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setIsSaving(false);
		}
	};

	const prefix = toServerKey({
		name: name.trim() || "server",
		id,
	} as McpConnection);

	return (
		<div className="space-y-4">
			<div className="grid gap-3 sm:grid-cols-2">
				<div className="space-y-1.5">
					<Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
						{t("custom.nameLabel")}
					</Label>
					<Input
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder={t("custom.namePlaceholder")}
						className="h-9 rounded-lg text-xs"
					/>
					<p className="text-[10px] text-muted-foreground">
						{t("custom.namePrefixHint", { prefix })}
					</p>
				</div>
				<div className="space-y-1.5">
					<Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
						{t("custom.transportLabel")}
					</Label>
					<select
						value={transport}
						onChange={(event) =>
							setTransport(event.target.value as "http" | "sse")
						}
						className="h-9 w-full rounded-lg border border-input bg-background px-3 text-xs font-medium"
					>
						<option value="http">{t("custom.transportHttp")}</option>
						<option value="sse">{t("custom.transportSse")}</option>
					</select>
				</div>
			</div>

			<div className="space-y-1.5">
				<Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
					{t("custom.urlLabel")}
				</Label>
				<Input
					value={url}
					onChange={(event) => setUrl(event.target.value)}
					placeholder={t("custom.urlPlaceholder")}
					className="h-9 rounded-lg font-mono text-xs"
				/>
			</div>

			<div className="space-y-2">
				<Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
					{t("custom.authLabel")}
				</Label>
				<div className="flex flex-wrap gap-1.5">
					{AUTH_MODES.map((mode) => (
						<button
							key={mode}
							type="button"
							onClick={() => setAuthMode(mode)}
							className={cn(
								"rounded-full border px-2.5 py-0.5 text-[10px] font-semibold transition-colors",
								authMode === mode
									? "border-blue-500/30 bg-blue-500/10 text-blue-500"
									: "border-border bg-muted/40 text-muted-foreground hover:text-foreground",
							)}
						>
							{t(AUTH_LABEL_KEYS[mode])}
						</button>
					))}
				</div>

				{authMode === "header" ? (
					<Input
						value={authHeaderName}
						onChange={(event) => setAuthHeaderName(event.target.value)}
						placeholder={t("custom.headerNameLabel")}
						className="h-9 rounded-lg font-mono text-xs"
					/>
				) : null}
				{authMode === "query" ? (
					<Input
						value={authQueryParam}
						onChange={(event) => setAuthQueryParam(event.target.value)}
						placeholder={t("custom.queryParamLabel")}
						className="h-9 rounded-lg font-mono text-xs"
					/>
				) : null}

				{needsSecret ? (
					<div className="relative">
						<Lock
							size={12}
							className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
						/>
						<Input
							type={showSecret ? "text" : "password"}
							value={secret}
							onChange={(event) => setSecret(event.target.value)}
							placeholder={
								hasStoredSecret
									? "••••••••••••"
									: t("custom.authValuePlaceholder")
							}
							className="h-9 rounded-lg pl-7 pr-20 font-mono text-xs"
						/>
						<div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
							<Badge
								variant="outline"
								className="border-blue-500/30 bg-blue-500/10 text-[9px] text-blue-500"
							>
								<Shield size={8} className="mr-1" />
								{t("custom.encrypted")}
							</Badge>
							<button
								type="button"
								onClick={() => setShowSecret((value) => !value)}
								className="rounded p-0.5 text-muted-foreground hover:bg-muted"
							>
								{showSecret ? <EyeOff size={12} /> : <Eye size={12} />}
							</button>
						</div>
					</div>
				) : null}
			</div>

			<div className="space-y-1.5">
				<Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
					{t("custom.extraHeaders")}
				</Label>
				<Textarea
					value={headersText}
					onChange={(event) => setHeadersText(event.target.value)}
					placeholder={t("custom.extraHeadersPlaceholder")}
					rows={2}
					className="min-h-[56px] rounded-lg font-mono text-xs"
				/>
				<p className="text-[10px] text-muted-foreground">
					{t("custom.extraHeadersHint")}
				</p>
			</div>

			<div className="rounded-xl border border-border/60 bg-background/60 p-3">
				{test.kind === "ok" ? (
					<div className="space-y-2.5">
						<div className="flex items-center justify-between gap-2">
							<span className="flex items-center gap-2 text-xs font-semibold">
								<span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
								{t("status.connected")} ·{" "}
								{t("detail.toolCount", { count: test.tools.length })}
								<span className="font-mono text-[10px] font-normal text-muted-foreground">
									{test.latencyMs} ms
								</span>
							</span>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="h-7 rounded-lg px-2 text-[10px]"
								onClick={() => void handleTest()}
							>
								<RefreshCw size={10} className="mr-1" />
								{t("detail.retest")}
							</Button>
						</div>
						<ToolScopeList
							tools={test.tools}
							value={allowlist}
							onChange={setAllowlist}
						/>
					</div>
				) : test.kind === "failed" ? (
					<div className="flex items-start gap-2">
						<AlertCircle
							size={13}
							className="mt-0.5 shrink-0 text-destructive"
						/>
						<div className="min-w-0 flex-1 space-y-2">
							<p className="text-xs text-destructive">
								{t("custom.testFailed", { error: test.error })}
							</p>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="h-7 rounded-lg px-2 text-[10px]"
								onClick={() => void handleTest()}
							>
								{t("detail.retest")}
							</Button>
						</div>
					</div>
				) : (
					<div className="flex items-center justify-between gap-2">
						<span className="text-xs text-muted-foreground">
							{t("custom.testFirst")}
						</span>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="h-7 rounded-lg px-2.5 text-[10px]"
							disabled={!canTest || test.kind === "testing"}
							onClick={() => void handleTest()}
						>
							{test.kind === "testing" ? (
								<>
									<Loader2 size={10} className="mr-1 animate-spin" />
									{t("custom.testing")}
								</>
							) : (
								t("detail.test")
							)}
						</Button>
					</div>
				)}
			</div>

			{error ? (
				<div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-2.5 text-xs text-destructive">
					<AlertCircle size={13} />
					{error}
				</div>
			) : null}

			<div className="flex items-center justify-between gap-3">
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
					<Button type="button" variant="outline" size="sm" onClick={onCancel}>
						{t("composio.cancel")}
					</Button>
					<Button
						type="button"
						size="sm"
						disabled={!canSave || isSaving}
						onClick={() => void handleSave()}
					>
						{isSaving ? (
							<Loader2 size={12} className="mr-1 animate-spin" />
						) : null}
						{t("custom.save")}
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
