import React from "react";
import { useTranslation } from "react-i18next";
import {
	AlertCircle,
	Check,
	ExternalLink,
	Eye,
	EyeOff,
	Key,
	Loader2,
	Search,
	Shield,
} from "lucide-react";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import { Label } from "@/main/components/ui/label";
import { MasterKeySetupDialog } from "@/main/components/molecules/MasterKeySetupDialog";
import { PasskeyPromptDialog } from "@/main/components/molecules/PasskeyPromptDialog";
import { cn } from "@/lib/utils";
import { platform } from "@/platform/current";
import { logError } from "@/utils/logger";
import {
	ComposioClient,
	waitForConnection,
	type ComposioToolkit,
} from "@/services/composio";
import {
	COMPOSIO_SECRET_KEY,
	connectionSecretRef,
	type ConnectionApp,
	type McpConnection,
} from "@/services/mcp-connections";
import {
	hasMasterKey,
	isMasterKeyUnlocked,
	loadSecret,
	saveSecret,
	setupMasterKey,
	unlockMasterKey,
} from "@/utils/master-key";
import { useConnectionsStore } from "@/main/stores/connections";

/**
 * Key -> apps -> scope.
 *
 * Step 2 is the part that has to stay responsive: the consent page opens in a
 * separate tab and we poll, so the pending app keeps its place in the grid and
 * the user can carry on connecting others meanwhile.
 */

const COMPOSIO_CONNECTION_ID = "composio";
/** Composio scopes connected accounts per user id; one local user, one id. */
const LOCAL_USER_ID = "memorall-local";

type Step = "key" | "apps";

interface ComposioWizardProps {
	onDone: () => void;
	onCancel: () => void;
	/** Pre-filter the catalog, e.g. when the agent wizard knows it needs Gmail. */
	initialSearch?: string;
}

interface PendingApp {
	slug: string;
	controller: AbortController;
}

export const ComposioWizard: React.FC<ComposioWizardProps> = ({
	onDone,
	onCancel,
	initialSearch,
}) => {
	const { t } = useTranslation("connections");
	const save = useConnectionsStore((state) => state.save);
	const discover = useConnectionsStore((state) => state.discover);
	const connections = useConnectionsStore((state) => state.connections);

	const [step, setStep] = React.useState<Step>("key");
	const [apiKey, setApiKey] = React.useState("");
	const [showKey, setShowKey] = React.useState(false);
	const [isBusy, setIsBusy] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	const [toolkits, setToolkits] = React.useState<ComposioToolkit[]>([]);
	const [query, setQuery] = React.useState(initialSearch ?? "");
	const [connected, setConnected] = React.useState<ConnectionApp[]>([]);
	const [pending, setPending] = React.useState<PendingApp | null>(null);
	const [lastConsentUrl, setLastConsentUrl] = React.useState<string | null>(
		null,
	);

	const [syncError, setSyncError] = React.useState<string | null>(null);
	const [isSyncing, setIsSyncing] = React.useState(false);
	const [showKeySetup, setShowKeySetup] = React.useState(false);
	const [showKeyUnlock, setShowKeyUnlock] = React.useState(false);

	const clientRef = React.useRef<ComposioClient | null>(null);

	React.useEffect(
		() => () => {
			pending?.controller.abort();
		},
		[pending],
	);

	/**
	 * Resume where the user left off. A stored key means the first step is
	 * already done, so re-presenting it — prefilled, asking to "Save and connect"
	 * again — just looks like the app forgot.
	 */
	React.useEffect(() => {
		void (async () => {
			try {
				if (!(await isMasterKeyUnlocked())) return;
				const stored = await loadSecret(COMPOSIO_SECRET_KEY);
				if (!stored) return;
				const parsed = JSON.parse(stored) as { apiKey?: string };
				if (!parsed.apiKey) return;

				setApiKey(parsed.apiKey);
				setIsBusy(true);
				try {
					await ensureConnectionRecord();
					await enterAppsStep(parsed.apiKey);
				} catch (caught) {
					// A stored key that no longer works drops back to step 1 with a reason.
					setError(caught instanceof Error ? caught.message : String(caught));
				} finally {
					setIsBusy(false);
				}
			} catch {
				// A stored key we cannot read just means the user types it again.
			}
		})();
	}, []);

	const enterAppsStep = async (key: string) => {
		const client = new ComposioClient(key);
		clientRef.current = client;

		const [catalog, accounts] = await Promise.all([
			client.listToolkits(),
			client.listConnectedAccounts(LOCAL_USER_ID).catch(() => []),
		]);

		setToolkits(catalog);

		const fromApi: ConnectionApp[] = accounts
			.filter((account) => account.status === "ACTIVE" && account.toolkitSlug)
			.map((account) => ({
				id: String(account.toolkitSlug),
				name:
					catalog.find((toolkit) => toolkit.slug === account.toolkitSlug)
						?.name ?? String(account.toolkitSlug),
				connectedAccountId: account.id,
				status: "active" as const,
			}));

		// Merge with what we already recorded. Composio's listing is the source of
		// truth when it answers, but our own record keeps the catalog honest if
		// that call fails or returns a shape we do not recognise.
		const stored =
			connections.find((entry) => entry.id === COMPOSIO_CONNECTION_ID)?.apps ??
			[];
		const byId = new Map<string, ConnectionApp>();
		for (const app of [...stored, ...fromApi]) {
			byId.set(app.id, app);
		}

		setConnected([...byId.values()]);
		setStep("apps");
	};

	/**
	 * Record the connection as soon as a key is in play, before any app is
	 * connected. Otherwise a saved key produces nothing visible: the page reports
	 * zero connections and shows the empty chooser, as if the work was discarded.
	 *
	 * Called from both entry points — saving a new key and resuming with a stored
	 * one — because a returning user skips the save path entirely.
	 */
	const ensureConnectionRecord = async () => {
		if (connections.some((entry) => entry.id === COMPOSIO_CONNECTION_ID)) {
			return;
		}
		const now = new Date().toISOString();
		await save({
			id: COMPOSIO_CONNECTION_ID,
			kind: "composio",
			name: "Composio",
			transport: "http",
			// No endpoint until a session is minted; this reads as "incomplete".
			url: "",
			authMode: "none",
			apps: [],
			composio: { toolkits: [] },
			enabledByDefault: false,
			createdAt: now,
			updatedAt: now,
		});
	};

	const persistKeyAndContinue = async () => {
		await saveSecret(COMPOSIO_SECRET_KEY, JSON.stringify({ apiKey }));
		await ensureConnectionRecord();
		await enterAppsStep(apiKey);
	};

	const handleVerifyKey = async () => {
		setIsBusy(true);
		setError(null);
		try {
			const client = new ComposioClient(apiKey.trim());
			if (!(await client.verifyKey())) {
				setError(t("composio.keyInvalid"));
				return;
			}

			if (!(await hasMasterKey())) {
				setShowKeySetup(true);
				return;
			}
			if (!(await isMasterKeyUnlocked())) {
				setShowKeyUnlock(true);
				return;
			}
			await persistKeyAndContinue();
		} catch (caught) {
			logError("[Composio] Key verification failed:", caught);
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setIsBusy(false);
		}
	};

	const handleConnectApp = async (toolkit: ComposioToolkit) => {
		const client = clientRef.current;
		if (!client || pending) return;

		const controller = new AbortController();
		setPending({ slug: toolkit.slug, controller });
		setError(null);

		try {
			const authConfigId = await client.ensureAuthConfig(toolkit.slug);
			const request = await client.initiateConnection({
				authConfigId,
				userId: LOCAL_USER_ID,
			});

			if (request.redirectUrl) {
				setLastConsentUrl(request.redirectUrl);
				await platform.externalLinks.open(request.redirectUrl);
			}

			await waitForConnection(client, request.id, {
				signal: controller.signal,
			});

			const app: ConnectionApp = {
				id: toolkit.slug,
				name: toolkit.name,
				connectedAccountId: request.id,
				status: "active",
			};
			const nextApps = [
				...connected.filter((entry) => entry.id !== toolkit.slug),
				app,
			];
			setConnected(nextApps);

			// Authorizing is the whole intent — the connection becomes usable here,
			// not after some later confirmation step. A failure here is reported
			// separately: the app IS authorized, only the endpoint is missing.
			await syncSession(nextApps);
		} catch (caught) {
			if ((caught as Error)?.name !== "AbortError") {
				logError("[Composio] Connect failed:", caught);
				setError(caught instanceof Error ? caught.message : String(caught));
			}
		} finally {
			setPending(null);
			setLastConsentUrl(null);
		}
	};

	/**
	 * Mint (or re-mint) the tool-router session for the authorized apps and store
	 * the result, so the connection flips to Connected on its own.
	 *
	 * Scoping is a session parameter, so this reruns whenever the app set
	 * changes rather than mutating anything server-side.
	 */
	const syncSession = async (apps: ConnectionApp[]) => {
		const client = clientRef.current;
		const record = connections.find(
			(entry) => entry.id === COMPOSIO_CONNECTION_ID,
		);
		if (!client || apps.length === 0) return;

		setSyncError(null);
		setIsSyncing(true);
		try {
			await mintSession(client, record, apps);
		} catch (caught) {
			// Surfaced on its own line: the app is authorized either way, and
			// claiming "ready" when there is no endpoint is what made this
			// failure invisible.
			logError("[Composio] Session mint failed:", caught);
			setSyncError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setIsSyncing(false);
		}
	};

	const mintSession = async (
		client: ComposioClient,
		record: McpConnection | undefined,
		apps: ConnectionApp[],
	) => {
		const toolkits = apps.map((app) => app.id);
		const session = await client.createMcpSession({
			userId: LOCAL_USER_ID,
			toolkits,
		});

		// Any session credential follows the same encrypted path as every other
		// connection secret.
		const secretRef = connectionSecretRef(COMPOSIO_CONNECTION_ID);
		const authValue = Object.values(session.headers ?? {})[0] ?? "";
		const authHeaderName = Object.keys(session.headers ?? {})[0];
		if (authValue) {
			await saveSecret(secretRef, authValue);
		}

		const now = new Date().toISOString();
		const connection: McpConnection = {
			...(record ?? {
				id: COMPOSIO_CONNECTION_ID,
				kind: "composio",
				name: "Composio",
				enabledByDefault: false,
				createdAt: now,
			}),
			id: COMPOSIO_CONNECTION_ID,
			kind: "composio",
			name: "Composio",
			transport: "http",
			url: session.url,
			authMode: authValue ? "header" : "none",
			authHeaderName,
			secretRef: authValue ? secretRef : undefined,
			apps,
			composio: { sessionId: session.sessionId, toolkits },
			updatedAt: now,
		} as McpConnection;

		await save(connection);
		await discover(connection.id);
	};

	const filtered = React.useMemo(() => {
		const needle = query.trim().toLowerCase();
		const list = needle
			? toolkits.filter(
					(toolkit) =>
						toolkit.name.toLowerCase().includes(needle) ||
						toolkit.slug.toLowerCase().includes(needle),
				)
			: toolkits;
		return list.slice(0, 60);
	}, [toolkits, query]);

	/** The connection is only usable once a session produced an endpoint. */
	const isUsable = Boolean(
		connections.find((entry) => entry.id === COMPOSIO_CONNECTION_ID)?.url,
	);

	const isConnected = (slug: string) =>
		connected.some((app) => app.id === slug);

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-2.5">
				<span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-500 text-sm font-bold text-white">
					C
				</span>
				<div>
					<h2 className="text-sm font-semibold">
						{t("composio.connectTitle")}
					</h2>
					<p className="text-[11px] text-muted-foreground">
						{t("composio.stepOf", {
							current: step === "key" ? 1 : 2,
							total: 2,
						})}{" "}
						· {t("composio.connectSubtitle")}
					</p>
				</div>
				{/* Always reachable, on both steps — leaving must never require
				    scrolling past the catalog. */}
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="ml-auto"
					onClick={onCancel}
				>
					{t("composio.cancel")}
				</Button>
			</div>

			{step === "apps" ? (
				<div
					className={cn(
						"flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-2",
						isUsable
							? "border-emerald-500/30 bg-emerald-500/10"
							: connected.length > 0
								? "border-amber-500/30 bg-amber-500/10"
								: "border-border/60 bg-background/60",
					)}
				>
					{/* Reads the saved connection, not a count of authorized apps —
					    saying "ready" while the record has no endpoint is exactly how
					    this failure stayed invisible. */}
					<span className="flex items-center gap-2 text-[11px] text-muted-foreground">
						{isBusy || isSyncing ? (
							<Loader2 size={12} className="animate-spin text-blue-500" />
						) : null}
						{isSyncing
							? t("composio.finishing")
							: isUsable
								? t("composio.appsConnected", { count: connected.length })
								: connected.length > 0
									? t("composio.authorizedNotReady", {
											count: connected.length,
										})
									: t("composio.connectFirstApp")}
					</span>
					<div className="flex items-center gap-2">
						{connected.length > 0 && !isUsable && !isSyncing ? (
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => void syncSession(connected)}
							>
								{t("composio.retryFinish")}
							</Button>
						) : null}
						<Button
							type="button"
							size="sm"
							disabled={isSyncing}
							onClick={onDone}
						>
							{t("composio.done")}
						</Button>
					</div>
				</div>
			) : null}

			{syncError ? (
				<div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-600 dark:text-amber-400">
					<AlertCircle size={13} className="mt-0.5 shrink-0" />
					<span className="min-w-0 break-words">
						{t("composio.syncFailed")} {syncError}
					</span>
				</div>
			) : null}

			{error ? (
				<div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-2.5 text-xs text-destructive">
					<AlertCircle size={13} className="mt-0.5 shrink-0" />
					<span className="min-w-0 break-words">{error}</span>
				</div>
			) : null}

			{step === "key" ? (
				<>
					<div className="space-y-3 rounded-xl border border-border/60 bg-background/60 p-3.5">
						<div className="space-y-1.5">
							<Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
								{t("composio.apiKeyLabel")}
							</Label>
							<div className="relative">
								<Key
									size={12}
									className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
								/>
								<Input
									type={showKey ? "text" : "password"}
									value={apiKey}
									onChange={(event) => setApiKey(event.target.value)}
									placeholder={t("composio.apiKeyPlaceholder")}
									className="h-9 rounded-lg pl-7 pr-9 font-mono text-xs"
								/>
								<button
									type="button"
									onClick={() => setShowKey((value) => !value)}
									className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
								>
									{showKey ? <EyeOff size={12} /> : <Eye size={12} />}
								</button>
							</div>
							<p className="text-[10px] text-muted-foreground">
								{t("composio.apiKeyHint")}
							</p>
						</div>

						<div className="flex items-start gap-2">
							<Shield size={13} className="mt-0.5 shrink-0 text-blue-500" />
							<p className="text-[11px] leading-relaxed text-muted-foreground">
								{t("composio.encryptionNote")}
							</p>
						</div>

						<Button
							type="button"
							className="w-full"
							disabled={apiKey.trim().length === 0 || isBusy}
							onClick={() => void handleVerifyKey()}
						>
							{isBusy ? (
								<Loader2 size={13} className="mr-1.5 animate-spin" />
							) : (
								<Shield size={13} className="mr-1.5" />
							)}
							{t("composio.save")}
						</Button>
					</div>

					<div className="rounded-xl border border-border/60 bg-muted/30 p-3.5">
						<p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
							{t("composio.explainerTitle")}
						</p>
						<p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
							{t("composio.explainerBody")}
						</p>
					</div>
				</>
			) : (
				<>
					<div className="relative">
						<Search
							size={12}
							className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
						/>
						<Input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder={t("composio.searchApps")}
							className="h-9 rounded-lg pl-7 text-xs"
						/>
					</div>

					{pending ? (
						<div className="flex items-start gap-2.5 rounded-xl border border-blue-500/30 bg-blue-500/10 p-3">
							<ExternalLink
								size={14}
								className="mt-0.5 shrink-0 text-blue-500"
							/>
							<div className="min-w-0 flex-1">
								<p className="text-xs font-semibold">
									{t("composio.waitingTitle", { app: pending.slug })}
								</p>
								<p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
									{t("composio.waitingBody", { app: pending.slug })}
								</p>
							</div>
							<div className="flex shrink-0 items-center gap-1.5">
								{lastConsentUrl ? (
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="h-7 rounded-lg px-2 text-[10px]"
										onClick={() =>
											void platform.externalLinks.open(lastConsentUrl)
										}
									>
										{t("composio.reopenTab")}
									</Button>
								) : null}
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="h-7 rounded-lg px-2 text-[10px]"
									onClick={() => pending.controller.abort()}
								>
									{t("composio.cancel")}
								</Button>
							</div>
						</div>
					) : null}

					<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
						{filtered.map((toolkit) => {
							const done = isConnected(toolkit.slug);
							const busy = pending?.slug === toolkit.slug;
							return (
								<div
									key={toolkit.slug}
									className={cn(
										"flex items-center gap-2 rounded-lg border p-2.5",
										done
											? "border-emerald-500/30 bg-emerald-500/10"
											: busy
												? "border-blue-500/30 bg-blue-500/10"
												: "border-border/60 bg-background/60",
									)}
								>
									<span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-muted text-[10px] font-bold uppercase text-muted-foreground">
										{toolkit.name.slice(0, 2)}
									</span>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-xs font-medium">
											{toolkit.name}
										</span>
										{toolkit.toolCount ? (
											<span className="block text-[10px] text-muted-foreground">
												{t("detail.toolCount", { count: toolkit.toolCount })}
											</span>
										) : null}
									</span>
									{done ? (
										<Check size={13} className="shrink-0 text-emerald-500" />
									) : busy ? (
										<Loader2
											size={13}
											className="shrink-0 animate-spin text-blue-500"
										/>
									) : (
										<Button
											type="button"
											variant="outline"
											size="sm"
											className="h-6 shrink-0 rounded-md px-2 text-[10px]"
											disabled={Boolean(pending)}
											onClick={() => void handleConnectApp(toolkit)}
										>
											{t("composio.connect")}
										</Button>
									)}
								</div>
							);
						})}
					</div>
				</>
			)}

			<MasterKeySetupDialog
				open={showKeySetup}
				onSetupComplete={async (passkey) => {
					await setupMasterKey(passkey);
					setShowKeySetup(false);
					await persistKeyAndContinue();
				}}
				onCancel={() => setShowKeySetup(false)}
			/>
			<PasskeyPromptDialog
				open={showKeyUnlock}
				onPasskeySubmit={async (passkey) => {
					await unlockMasterKey(passkey);
					setShowKeyUnlock(false);
					await persistKeyAndContinue();
				}}
				onCancel={() => setShowKeyUnlock(false)}
			/>
		</div>
	);
};
