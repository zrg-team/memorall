import React, { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { serviceManager } from "@/services";
import { eq } from "drizzle-orm";
import { Loader2, Shield, CheckCircle, Trash2 } from "lucide-react";
import { LOCAL_SERVER_LLM_CONFIG_KEYS } from "@/config/local-server-llm";
import { logWarn } from "@/utils/logger";
import type { NewConfiguration } from "@/services/database";

interface LocalOpenAITabProps {
	providerKind: "lmstudio" | "ollama";
	onModelLoaded?: (modelId: string, provider: "lmstudio" | "ollama") => void;
}

export const LocalOpenAITab: React.FC<LocalOpenAITabProps> = ({
	providerKind,
	onModelLoaded,
}) => {
	const defaultBase =
		providerKind === "lmstudio"
			? "http://localhost:1234/v1"
			: "http://localhost:11434/v1";

	const [view, setView] = useState<
		"loading" | "no-config" | "has-config" | "loaded"
	>("loading");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [configDate, setConfigDate] = useState<Date | null>(null);

	const [baseUrl, setBaseUrl] = useState(defaultBase);
	const [modelId, setModelId] = useState("");
	const [existingBaseUrl, setExistingBaseUrl] = useState(defaultBase);
	const [existingModelId, setExistingModelId] = useState("");

	const configKey =
		providerKind === "lmstudio"
			? LOCAL_SERVER_LLM_CONFIG_KEYS.LLM_STUDIO
			: LOCAL_SERVER_LLM_CONFIG_KEYS.OLLAMA;

	useEffect(() => {
		setBaseUrl(defaultBase);
		setExistingBaseUrl(defaultBase);
		refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [providerKind]);

	async function refresh() {
		setView("loading");
		setError("");
		try {
			const row = (
				await serviceManager.databaseService.use(({ db, schema }) => {
					return db
						.select()
						.from(schema.configurations)
						.where(eq(schema.configurations.key, configKey))
						.limit(1);
				})
			)[0] as unknown as { data?: any; updatedAt?: Date } | undefined;
			if (row?.data) {
				setView("has-config");
				setConfigDate(row.updatedAt || null);
				setExistingBaseUrl(String(row.data.baseUrl || defaultBase));
				setExistingModelId(String(row.data.modelId || ""));
			} else {
				setView("no-config");
			}
		} catch {
			setView("no-config");
		}
	}

	async function save() {
		if (!baseUrl.trim()) {
			setError("Base URL is required");
			return;
		}
		setBusy(true);
		setError("");
		try {
			const existing = (
				await serviceManager.databaseService.use(({ db, schema }) => {
					return db
						.select()
						.from(schema.configurations)
						.where(eq(schema.configurations.key, configKey));
				})
			)[0];
			if (existing) {
				await serviceManager.databaseService.use(({ db, schema }) => {
					return db
						.update(schema.configurations)
						.set({
							data: { baseUrl: baseUrl.trim(), modelId: modelId.trim() },
							updatedAt: new Date(),
						})
						.where(eq(schema.configurations.key, configKey));
				});
			} else {
				await serviceManager.databaseService.use(({ db, schema }) => {
					return db.insert(schema.configurations).values({
						key: configKey,
						data: { baseUrl: baseUrl.trim(), modelId: modelId.trim() },
					} as unknown as NewConfiguration);
				});
			}
			setBaseUrl(defaultBase);
			setModelId("");
			await refresh();
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Unknown error";
			setError(`Failed to save configuration: ${msg}`);
		} finally {
			setBusy(false);
		}
	}

	async function connect() {
		setBusy(true);
		setError("");
		try {
			// Use correct service name instead of hardcoded "openai"
			const serviceName = providerKind;
			if (serviceManager.llmService.has(serviceName)) {
				serviceManager.llmService.remove(serviceName);
			}

			const serviceConfig = {
				type: providerKind,
				baseURL: existingBaseUrl,
			};

			// Create service in current context
			await serviceManager.llmService.create(serviceName, serviceConfig);

			let modelExists = false;
			try {
				const response = await serviceManager.llmService.modelsFor(serviceName);
				modelExists = !!response?.data?.length;
			} catch (modelsError) {
				logWarn(
					`Failed to fetch models for ${serviceName} after connect:`,
					modelsError,
				);
			}

			const trimmedModelId = existingModelId.trim();
			if (trimmedModelId) {
				await serviceManager.llmService.setCurrentModel(
					trimmedModelId,
					providerKind,
					providerKind,
				);
				onModelLoaded?.(trimmedModelId, providerKind);
			}
			if (trimmedModelId || modelExists) {
				onModelLoaded?.(trimmedModelId, providerKind);
			}
			setView(trimmedModelId || modelExists ? "loaded" : "has-config");
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Unknown error";
			setError(`Failed to connect: ${msg}`);
		} finally {
			setBusy(false);
		}
	}

	async function removeConfig() {
		if (!confirm("Delete configuration?")) return;
		setBusy(true);
		setError("");
		try {
			await serviceManager.databaseService.use(({ db, schema }) => {
				return db
					.delete(schema.configurations)
					.where(eq(schema.configurations.key, configKey));
			});
			const serviceName = providerKind;
			if (serviceManager.llmService.has(serviceName)) {
				serviceManager.llmService.remove(serviceName);
			}

			setView("no-config");
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Unknown error";
			setError(`Failed to delete configuration: ${msg}`);
		} finally {
			setBusy(false);
		}
	}

	const isValidNew = baseUrl.trim().length > 0;
	const isValidExisting = existingBaseUrl.trim().length > 0;

	return (
		<div className="space-y-4">
			<div className="p-3 border rounded-lg bg-muted/20 border-border">
				<div className="flex items-center gap-2 mb-2">
					<Shield className="w-4 h-4 text-primary" />
					<span className="text-sm font-medium text-foreground">
						Local Endpoint
					</span>
				</div>
				<p className="text-xs text-primary">
					Configuration is stored locally (JSONB). No encryption for local
					endpoints.
				</p>
			</div>

			{view === "loading" && (
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 className="w-4 h-4 animate-spin" /> Checking configuration...
				</div>
			)}

			{view === "no-config" && (
				<div className="space-y-3">
					<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
						<div>
							<label className="text-xs text-muted-foreground">Base URL</label>
							<Input
								value={baseUrl}
								onChange={(e) => setBaseUrl(e.target.value)}
								disabled={busy}
							/>
							<div className="text-xs text-muted-foreground mt-1">
								Default: {defaultBase}
							</div>
						</div>
						<div>
							<label className="text-xs text-muted-foreground">
								Model ID (optional)
							</label>
							<Input
								placeholder={
									providerKind === "ollama" ? "e.g. llama3" : "your model id"
								}
								value={modelId}
								onChange={(e) => setModelId(e.target.value)}
								disabled={busy}
							/>
						</div>
					</div>
					<div className="flex gap-2">
						<Button onClick={save} disabled={busy || !isValidNew}>
							{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
							<span className="ml-2">Save Configuration</span>
						</Button>
					</div>
				</div>
			)}

			{view === "has-config" && (
				<div className="space-y-3">
					<div className="text-sm text-foreground">Configuration found.</div>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
						<div>
							<label className="text-xs text-muted-foreground">Base URL</label>
							<Input
								value={existingBaseUrl}
								onChange={(e) => setExistingBaseUrl(e.target.value)}
								disabled={busy}
							/>
							<div className="text-xs text-muted-foreground mt-1">
								Default: {defaultBase}
							</div>
						</div>
						<div>
							<label className="text-xs text-muted-foreground">
								Model ID (optional)
							</label>
							<Input
								placeholder={
									providerKind === "ollama" ? "e.g. llama3" : "your model id"
								}
								value={existingModelId}
								onChange={(e) => setExistingModelId(e.target.value)}
								disabled={busy}
							/>
						</div>
					</div>
					<div className="flex gap-2">
						<Button onClick={connect} disabled={busy || !isValidExisting}>
							{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
							<span className="ml-2">Connect</span>
						</Button>
						<Button onClick={save} variant="outline" disabled={busy}>
							Update
						</Button>
						<Button
							onClick={removeConfig}
							variant="outline"
							className="text-red-600"
							disabled={busy}
						>
							<Trash2 className="w-4 h-4" />
						</Button>
					</div>
				</div>
			)}

			{view === "loaded" && (
				<div className="space-y-3">
					<div className="flex items-center gap-2 p-3 border rounded-lg bg-muted/20 border-border">
						<CheckCircle className="w-4 h-4 text-primary" />
						<div>
							<div className="text-sm font-medium text-foreground">
								Local LLM Ready
							</div>
							<div className="text-xs text-primary">
								Configuration loaded and service connected
							</div>
						</div>
					</div>
					<div className="flex gap-2">
						<Button onClick={() => setView("has-config")} variant="outline">
							Disconnect
						</Button>
						<Button
							onClick={removeConfig}
							variant="outline"
							className="text-red-600"
							disabled={busy}
						>
							<Trash2 className="w-4 h-4" />
						</Button>
					</div>
				</div>
			)}

			{error && (
				<div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded border border-destructive/20">
					{error}
				</div>
			)}
		</div>
	);
};
