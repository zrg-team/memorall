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
import { logError, logInfo } from "@/utils/logger";
import {
	ComposioClient,
	describeComposioError,
	ensureComposioHostAccess,
	hasComposioHostAccess,
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
import { AppIcon, COMPOSIO_LOGO_URL } from "./AppIcon";

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
				// Resuming is not a user gesture, so the permission cannot be asked
				// for here. Leave the key in the field, say what is wrong, and let
				// "Save and connect" — a real click — do the asking.
				if (!(await hasComposioHostAccess())) {
					setError(t("composio.hostAccessBlocked"));
					return;
				}
				setIsBusy(true);
				try {
					await ensureConnectionRecord();
					await enterAppsStep(parsed.apiKey);
				} catch (caught) {
					// A stored key that no longer works drops back to step 1 with a reason.
					setError(describeComposioError(caught));
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
			.map((account) => {
				const toolkit = catalog.find(
					(candidate) => candidate.slug === account.toolkitSlug,
				);
				return {
					id: String(account.toolkitSlug),
					name: toolkit?.name ?? String(account.toolkitSlug),
					logo: toolkit?.logo,
					connectedAccountId: account.id,
					status: "active" as const,
				};
			});

		// Merge with what we already recorded. Composio's listing is the source of
		// truth when it answers, but our own record keeps the catalog honest if
		// that call fails or returns a shape we do not recognise.
		const stored =
			connections.find((entry) => entry.id === COMPOSIO_CONNECTION_ID)?.apps ??
			[];
		const byId = new Map<string, ConnectionApp>();
		for (const app of [...stored, ...fromApi]) {
			// Merge rather than replace: the catalog is paged, so an app connected
			// long ago may not appear in it, and the API entry would then arrive
			// with the slug for a name and no logo — worse than what we had. Keep
			// the newer entry's fields only where it actually has one.
			const previous = byId.get(app.id);
			byId.set(
				app.id,
				previous
					? {
							...previous,
							...app,
							name: app.name || previous.name,
							logo: app.logo ?? previous.logo,
						}
					: app,
			);
		}

		const merged = [...byId.values()];
		setConnected(merged);

		// Write back what Composio reports. Without this the record keeps whatever
		// it had when the tab was last open — usually nothing — so the detail pane
		// says "connect at least one app" to someone who has connected three, and
		// the agent picker offers no providers to grant.
		if (merged.length > 0) {
			await persistApps(merged);
		}
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
			// Inside the click, where Chrome will still open the prompt. Without
			// the host, every call below dies in preflight as "Failed to fetch".
			if (!(await ensureComposioHostAccess())) {
				setError(t("composio.hostAccessDenied"));
				return;
			}

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
			setError(describeComposioError(caught));
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
				logo: toolkit.logo,
				connectedAccountId: request.id,
				status: "active",
			};
			const nextApps = [
				...connected.filter((entry) => entry.id !== toolkit.slug),
				app,
			];
			setConnected(nextApps);

			// Persist the authorization FIRST and unconditionally. Folding this into
			// the session mint meant a failed mint discarded the app entirely, so
			// the detail pane then told the user to connect an app they had just
			// connected.
			await persistApps(nextApps);

			// Then try to make it usable. Its failure is reported separately: the
			// app is authorized either way, only the endpoint is missing.
			await syncSession(nextApps);
		} catch (caught) {
			if ((caught as Error)?.name !== "AbortError") {
				logError("[Composio] Connect failed:", caught);
				setError(describeComposioError(caught));
			}
		} finally {
			setPending(null);
			setLastConsentUrl(null);
		}
	};

	/** Record authorized apps on the connection, independent of the mint. */
	const persistApps = async (apps: ConnectionApp[]) => {
		// Read the store rather than the render's copy: the record may have been
		// created moments ago by `ensureConnectionRecord`, and the closed-over
		// array would still be the empty one from before that save.
		const record = useConnectionsStore
			.getState()
			.connections.find((entry) => entry.id === COMPOSIO_CONNECTION_ID);
		if (!record) return;
		await save({
			...record,
			apps,
			composio: {
				...(record.composio ?? { toolkits: [] }),
				toolkits: apps.map((app) => app.id),
			},
		});
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
		const record = useConnectionsStore
			.getState()
			.connections.find((entry) => entry.id === COMPOSIO_CONNECTION_ID);
		if (!client || apps.length === 0) return;

		setSyncError(null);
		setIsSyncing(true);
		try {
			logInfo(
				"[Composio] Minting tool-router session for:",
				apps.map((app) => app.id).join(", "),
			);
			await mintSession(client, record, apps);
			logInfo("[Composio] Session minted and connection saved.");
		} catch (caught) {
			// Surfaced on its own line: the app is authorized either way, and
			// claiming "ready" when there is no endpoint is what made this
			// failure invisible.
			logError("[Composio] Session mint failed:", caught);
			setSyncError(describeComposioError(caught));
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

		// Composio returns `mcp: { type, url }` with no headers, but the endpoint
		// is NOT public: unauthenticated calls get 401, which the MCP client then
		// treats as a reason to retry over SSE, producing a misleading 404. The
		// session is authenticated with the project API key, so send that.
		const secretRef = connectionSecretRef(COMPOSIO_CONNECTION_ID);
		const sessionHeaders = session.headers ?? {};
		const authHeaderName = Object.keys(sessionHeaders)[0] ?? "x-api-key";
		const authValue = Object.values(sessionHeaders)[0] ?? apiKey.trim();
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

	/**
	 * Finish an interrupted setup on sight rather than waiting for Retry.
	 *
	 * Coming back to authorized-but-not-ready and being offered a button with no
	 * stated reason is the dead end users kept hitting. Attempting the mint here
	 * either completes the setup or puts the real error on screen — a scoped API
	 * key that cannot create sessions answers 403, and that is worth reading.
	 */
	const autoSyncedRef = React.useRef(false);
	React.useEffect(() => {
		if (
			step !== "apps" ||
			isUsable ||
			isSyncing ||
			connected.length === 0 ||
			autoSyncedRef.current
		) {
			return;
		}
		autoSyncedRef.current = true;
		void syncSession(connected);
	}, [step, isUsable, isSyncing, connected]);

	const isConnected = (slug: string) =>
		connected.some((app) => app.id === slug);

	return (
		// Same reason as the lane chooser: this renders both full-page and inside
		// a 720px dialog, so the catalog columns have to measure their own box.
		<div className="@container space-y-4">
			<div className="flex flex-wrap items-center gap-2.5">
				<AppIcon name="Composio" src={COMPOSIO_LOGO_URL} size={36} />
				<div className="min-w-0 flex-1">
					<h2 className="truncate text-sm font-semibold">
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
					className="ml-auto shrink-0"
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

					<div className="grid gap-2 @md:grid-cols-2 @3xl:grid-cols-3">
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
									<AppIcon
										name={toolkit.name}
										src={toolkit.logo}
										composioSlug={toolkit.slug}
										size={26}
									/>
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
