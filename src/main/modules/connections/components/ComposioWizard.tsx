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
}

interface PendingApp {
	slug: string;
	controller: AbortController;
}

export const ComposioWizard: React.FC<ComposioWizardProps> = ({
	onDone,
	onCancel,
}) => {
	const { t } = useTranslation("connections");
	const save = useConnectionsStore((state) => state.save);
	const discover = useConnectionsStore((state) => state.discover);

	const [step, setStep] = React.useState<Step>("key");
	const [apiKey, setApiKey] = React.useState("");
	const [showKey, setShowKey] = React.useState(false);
	const [isBusy, setIsBusy] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	const [toolkits, setToolkits] = React.useState<ComposioToolkit[]>([]);
	const [query, setQuery] = React.useState("");
	const [connected, setConnected] = React.useState<ConnectionApp[]>([]);
	const [pending, setPending] = React.useState<PendingApp | null>(null);
	const [lastConsentUrl, setLastConsentUrl] = React.useState<string | null>(
		null,
	);

	const [showKeySetup, setShowKeySetup] = React.useState(false);
	const [showKeyUnlock, setShowKeyUnlock] = React.useState(false);

	const clientRef = React.useRef<ComposioClient | null>(null);

	React.useEffect(
		() => () => {
			pending?.controller.abort();
		},
		[pending],
	);

	/** Resume without retyping the key when it is already stored and unlocked. */
	React.useEffect(() => {
		void (async () => {
			try {
				if (!(await isMasterKeyUnlocked())) return;
				const stored = await loadSecret(COMPOSIO_SECRET_KEY);
				if (!stored) return;
				const parsed = JSON.parse(stored) as { apiKey?: string };
				if (parsed.apiKey) {
					setApiKey(parsed.apiKey);
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
		setConnected(
			accounts
				.filter((account) => account.status === "ACTIVE" && account.toolkitSlug)
				.map((account) => ({
					id: String(account.toolkitSlug),
					name:
						catalog.find((toolkit) => toolkit.slug === account.toolkitSlug)
							?.name ?? String(account.toolkitSlug),
					connectedAccountId: account.id,
					status: "active" as const,
				})),
		);
		setStep("apps");
	};

	const persistKeyAndContinue = async () => {
		await saveSecret(COMPOSIO_SECRET_KEY, JSON.stringify({ apiKey }));
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

			setConnected((current) => [
				...current.filter((app) => app.id !== toolkit.slug),
				{
					id: toolkit.slug,
					name: toolkit.name,
					connectedAccountId: request.id,
					status: "active",
				},
			]);
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

	const handleFinish = async () => {
		const client = clientRef.current;
		if (!client || connected.length === 0) return;

		setIsBusy(true);
		setError(null);
		try {
			const session = await client.createMcpSession({
				userId: LOCAL_USER_ID,
				toolkits: connected.map((app) => app.id),
			});

			// The session headers are a live credential, so they follow the same
			// encrypted path as any other connection secret.
			const secretRef = connectionSecretRef(COMPOSIO_CONNECTION_ID);
			const authValue = Object.values(session.headers)[0] ?? "";
			const authHeaderName = Object.keys(session.headers)[0];
			if (authValue) {
				await saveSecret(secretRef, authValue);
			}

			const now = new Date().toISOString();
			const connection: McpConnection = {
				id: COMPOSIO_CONNECTION_ID,
				kind: "composio",
				name: "Composio",
				transport: "http",
				url: session.url,
				authMode: authValue ? "header" : "none",
				authHeaderName,
				secretRef: authValue ? secretRef : undefined,
				apps: connected,
				composio: {
					sessionId: session.sessionId,
					toolkits: connected.map((app) => app.id),
				},
				enabledByDefault: false,
				createdAt: now,
				updatedAt: now,
			};

			await save(connection);
			await discover(connection.id);
			onDone();
		} catch (caught) {
			logError("[Composio] Session creation failed:", caught);
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setIsBusy(false);
		}
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
			</div>

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

			<div className="flex items-center justify-between gap-3">
				<span className="text-[11px] text-muted-foreground">
					{step === "apps" && connected.length > 0
						? t("composio.toolsBeforeScoping", {
								apps: connected.length,
								tools: "…",
							})
						: null}
				</span>
				<div className="flex items-center gap-2">
					<Button type="button" variant="outline" size="sm" onClick={onCancel}>
						{t("composio.cancel")}
					</Button>
					{step === "apps" ? (
						<Button
							type="button"
							size="sm"
							disabled={connected.length === 0 || isBusy}
							onClick={() => void handleFinish()}
						>
							{isBusy ? (
								<Loader2 size={12} className="mr-1.5 animate-spin" />
							) : null}
							{t("composio.finish")}
						</Button>
					) : null}
				</div>
			</div>

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
