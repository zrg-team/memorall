import React, { useEffect, useState } from "react";
import { SiGithub as Github } from "@icons-pack/react-simple-icons";
import {
	Brain,
	Check,
	Copy,
	Database,
	FileSearch,
	FolderOpen,
	GitBranch,
	Globe,
	Info,
	MemoryStick,
	Plus,
	Search,
	Server,
	Terminal,
	Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/main/components/ui/dialog";
import { Input } from "@/main/components/ui/input";
import { Label } from "@/main/components/ui/label";
import { Badge } from "@/main/components/ui/badge";
import { Textarea } from "@/main/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { MCPServerConfig } from "@/services/flows-legacy/steps/features/mcp-feature";

interface MCPServersEditorProps {
	servers: MCPServerConfig[];
	onChange: (servers: MCPServerConfig[]) => void;
	className?: string;
}

interface PredefinedMCPCommand {
	id: string;
	icon: React.ComponentType<{ size?: number; className?: string }>;
	command: string;
}

const DEFAULT_HTTP_URL = "http://127.0.0.1:8000/mcp";

const predefinedMCPCommands: PredefinedMCPCommand[] = [
	{
		id: "filesystem",
		icon: FolderOpen,
		command:
			'npx -y supergateway --stdio "npx -y @modelcontextprotocol/server-filesystem ." --outputTransport streamableHttp --port 8000',
	},
	{
		id: "git",
		icon: GitBranch,
		command:
			'npx -y supergateway --stdio "npx -y @modelcontextprotocol/server-git ." --outputTransport streamableHttp --port 8001',
	},
	{
		id: "github",
		icon: Github,
		command:
			'npx -y supergateway --stdio "npx -y @modelcontextprotocol/server-github" --outputTransport streamableHttp --port 8002',
	},
	{
		id: "postgres",
		icon: Database,
		command:
			'npx -y supergateway --stdio "npx -y @modelcontextprotocol/server-postgres postgresql://user:password@localhost:5432/db" --outputTransport streamableHttp --port 8003',
	},
	{
		id: "sqlite",
		icon: Database,
		command:
			'npx -y supergateway --stdio "npx -y @modelcontextprotocol/server-sqlite ./data.db" --outputTransport streamableHttp --port 8004',
	},
	{
		id: "puppeteer",
		icon: Globe,
		command:
			'npx -y supergateway --stdio "npx -y @modelcontextprotocol/server-puppeteer" --outputTransport streamableHttp --port 8005',
	},
	{
		id: "braveSearch",
		icon: Search,
		command:
			'npx -y supergateway --stdio "npx -y @modelcontextprotocol/server-brave-search" --outputTransport streamableHttp --port 8006',
	},
	{
		id: "memory",
		icon: MemoryStick,
		command:
			'npx -y supergateway --stdio "npx -y @modelcontextprotocol/server-memory" --outputTransport streamableHttp --port 8007',
	},
	{
		id: "sequentialThinking",
		icon: Brain,
		command:
			'npx -y supergateway --stdio "npx -y @modelcontextprotocol/server-sequential-thinking" --outputTransport streamableHttp --port 8008',
	},
	{
		id: "fetch",
		icon: FileSearch,
		command:
			'npx -y supergateway --stdio "npx -y @modelcontextprotocol/server-fetch" --outputTransport streamableHttp --port 8009',
	},
];

const serializeHeaders = (headers?: Record<string, string>): string =>
	Object.entries(headers ?? {})
		.map(([key, value]) => `${key}: ${value}`)
		.join("\n");

const parseHeaders = (text: string): Record<string, string> => {
	const result: Record<string, string> = {};
	for (const line of text.split("\n")) {
		const colon = line.indexOf(":");
		if (colon > 0) {
			const key = line.slice(0, colon).trim();
			const value = line.slice(colon + 1).trim();
			if (key) {
				result[key] = value;
			}
		}
	}
	return result;
};

const createEmptyServer = (): MCPServerConfig => ({
	type: "http",
	name: "",
	url: DEFAULT_HTTP_URL,
	headers: {},
});

export const MCPServersEditor: React.FC<MCPServersEditorProps> = ({
	servers,
	onChange,
	className,
}) => {
	const { t } = useTranslation(["agents"]);
	const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
	const [addDialogOpen, setAddDialogOpen] = useState(false);
	const [commandListOpen, setCommandListOpen] = useState(false);
	const [draftServer, setDraftServer] =
		useState<MCPServerConfig>(createEmptyServer);
	const [headersDraft, setHeadersDraft] = useState("");
	const [copiedCommandId, setCopiedCommandId] = useState<string | null>(null);

	const selectedServer =
		selectedIndex === null ? null : (servers[selectedIndex] ?? null);

	useEffect(() => {
		if (selectedIndex !== null && !servers[selectedIndex]) {
			setSelectedIndex(null);
		}
	}, [selectedIndex, servers]);

	useEffect(() => {
		if (addDialogOpen) {
			setHeadersDraft(serializeHeaders(draftServer.headers));
		}
	}, [addDialogOpen, draftServer]);

	const updateServer = (index: number, server: MCPServerConfig) => {
		const next = [...servers];
		next[index] = server;
		onChange(next);
	};

	const removeServer = (index: number) => {
		onChange(servers.filter((_, itemIndex) => itemIndex !== index));
		if (selectedIndex === index) {
			setSelectedIndex(null);
		}
	};

	const openAddDialog = () => {
		setDraftServer(createEmptyServer());
		setHeadersDraft("");
		setAddDialogOpen(true);
	};

	const addServer = () => {
		const normalizedName = draftServer.name.trim();
		const normalizedUrl = draftServer.url.trim();

		if (!normalizedName || !normalizedUrl) {
			return;
		}

		onChange([
			...servers,
			{
				...draftServer,
				name: normalizedName,
				url: normalizedUrl,
				headers: parseHeaders(headersDraft),
			},
		]);
		setAddDialogOpen(false);
	};

	const copyPredefinedCommand = async (command: PredefinedMCPCommand) => {
		if (!navigator.clipboard?.writeText) {
			return;
		}

		await navigator.clipboard.writeText(command.command);
		setCopiedCommandId(command.id);
		window.setTimeout(() => setCopiedCommandId(null), 1500);
	};

	return (
		<div className={cn("space-y-4", className)}>
			<div className="flex items-start gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
				<Info size={12} className="mt-0.5 shrink-0" />
				<span>{t("mcps.editor.bridgeHint")}</span>
			</div>

			<div className="flex flex-wrap items-center justify-between gap-2">
				<Badge variant="secondary" className="text-[10px]">
					{t("mcps.editor.serverCount", { count: servers.length })}
				</Badge>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="h-7 rounded-lg px-2 text-[10px]"
						onClick={() => setCommandListOpen((value) => !value)}
					>
						<Terminal size={10} className="mr-1" />
						{t("mcps.editor.predefinedAction")}
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="h-7 rounded-lg px-2 text-[10px]"
						onClick={openAddDialog}
					>
						<Plus size={10} className="mr-1" />
						{t("mcps.editor.addServer")}
					</Button>
				</div>
			</div>

			{commandListOpen ? (
				<div className="grid gap-2 sm:grid-cols-2">
					{predefinedMCPCommands.map((command) => {
						const Icon = command.icon;
						const copied = copiedCommandId === command.id;

						return (
							<button
								key={command.id}
								type="button"
								title={command.command}
								onClick={() => void copyPredefinedCommand(command)}
								className="group relative flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-left transition-colors hover:border-border hover:bg-muted/40"
							>
								<span className="flex min-w-0 items-center gap-2">
									<span className="rounded-lg bg-muted p-1.5 text-muted-foreground">
										<Icon size={13} />
									</span>
									<span className="min-w-0">
										<span className="block truncate text-xs font-semibold">
											{t(`mcps.predefined.${command.id}.name`)}
										</span>
										<span className="block truncate text-[10px] text-muted-foreground">
											{t(`mcps.predefined.${command.id}.port`)}
										</span>
									</span>
								</span>
								{copied ? (
									<Check size={13} className="shrink-0 text-emerald-600" />
								) : (
									<Copy size={13} className="shrink-0 text-muted-foreground" />
								)}
								<span className="pointer-events-none absolute left-0 top-[calc(100%+0.375rem)] z-50 hidden w-[min(560px,calc(100vw-2rem))] rounded-lg border border-border bg-popover px-3 py-2 font-mono text-[10px] leading-relaxed text-popover-foreground shadow-lg group-hover:block group-focus-visible:block">
									{command.command}
								</span>
							</button>
						);
					})}
				</div>
			) : null}

			{servers.length === 0 ? (
				<div className="rounded-xl border border-dashed border-border/70 px-3 py-6 text-center text-xs text-muted-foreground">
					{t("mcps.editor.empty")}
				</div>
			) : (
				<div className="divide-y rounded-xl border border-border/60 bg-background/60">
					{servers.map((server, index) => (
						<div
							key={`${server.name}-${index}`}
							className="flex items-center gap-2 px-3 py-2"
						>
							<button
								type="button"
								onClick={() => setSelectedIndex(index)}
								className="flex min-w-0 flex-1 items-center gap-2 text-left"
							>
								<Server size={13} className="shrink-0 text-muted-foreground" />
								<span className="min-w-0 flex-1">
									<span className="block truncate text-xs font-semibold">
										{server.name || t("mcps.editor.unnamed")}
									</span>
									<span className="block truncate font-mono text-[10px] text-muted-foreground">
										{server.url}
									</span>
								</span>
								<Badge variant="outline" className="shrink-0 text-[10px]">
									{server.type.toUpperCase()}
								</Badge>
							</button>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="h-7 w-7 shrink-0 rounded-lg text-destructive hover:text-destructive"
								onClick={() => removeServer(index)}
								aria-label={t("mcps.editor.deleteServer")}
							>
								<Trash2 size={12} />
							</Button>
						</div>
					))}
				</div>
			)}

			<Dialog
				open={selectedServer !== null}
				onOpenChange={(open) => !open && setSelectedIndex(null)}
			>
				{selectedServer && selectedIndex !== null ? (
					<DialogContent className="sm:max-w-[560px]">
						<DialogHeader>
							<DialogTitle>{t("mcps.editor.detailTitle")}</DialogTitle>
							<DialogDescription>
								{t("mcps.editor.detailDescription")}
							</DialogDescription>
						</DialogHeader>

						<ServerFields
							server={selectedServer}
							headersText={serializeHeaders(selectedServer.headers)}
							onChange={(server) => updateServer(selectedIndex, server)}
						/>

						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setSelectedIndex(null)}
							>
								{t("actions.cancel")}
							</Button>
						</DialogFooter>
					</DialogContent>
				) : null}
			</Dialog>

			<Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
				<DialogContent className="sm:max-w-[560px]">
					<DialogHeader>
						<DialogTitle>{t("mcps.editor.addTitle")}</DialogTitle>
						<DialogDescription>
							{t("mcps.editor.addDescription")}
						</DialogDescription>
					</DialogHeader>

					<ServerFields
						server={draftServer}
						headersText={headersDraft}
						onHeadersChange={setHeadersDraft}
						onChange={setDraftServer}
					/>

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => setAddDialogOpen(false)}
						>
							{t("actions.cancel")}
						</Button>
						<Button
							type="button"
							onClick={addServer}
							disabled={!draftServer.name.trim() || !draftServer.url.trim()}
						>
							{t("mcps.editor.addServer")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
};

interface ServerFieldsProps {
	server: MCPServerConfig;
	headersText: string;
	onChange: (server: MCPServerConfig) => void;
	onHeadersChange?: (value: string) => void;
}

const ServerFields: React.FC<ServerFieldsProps> = ({
	server,
	headersText,
	onChange,
	onHeadersChange,
}) => {
	const { t } = useTranslation(["agents"]);

	const handleHeadersChange = (value: string) => {
		onHeadersChange?.(value);
		onChange({ ...server, headers: parseHeaders(value) });
	};

	return (
		<div className="space-y-4">
			<div className="grid gap-4 sm:grid-cols-2">
				<div>
					<Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
						{t("mcps.editor.nameLabel")}
					</Label>
					<Input
						value={server.name}
						onChange={(event) =>
							onChange({ ...server, name: event.target.value })
						}
						placeholder={t("mcps.editor.namePlaceholder")}
						className="mt-1 h-9 rounded-lg text-xs"
					/>
				</div>
				<div>
					<Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
						{t("mcps.editor.transportLabel")}
					</Label>
					<select
						value={server.type}
						onChange={(event) =>
							onChange({
								...server,
								type: event.target.value as MCPServerConfig["type"],
							})
						}
						className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-xs font-medium uppercase"
					>
						<option value="http">HTTP</option>
						<option value="sse">SSE</option>
					</select>
				</div>
			</div>

			<div>
				<Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
					{t("mcps.editor.urlLabel")}
				</Label>
				<Input
					value={server.url}
					onChange={(event) => onChange({ ...server, url: event.target.value })}
					placeholder={
						server.type === "http"
							? t("mcps.editor.httpUrlPlaceholder")
							: t("mcps.editor.sseUrlPlaceholder")
					}
					className="mt-1 h-9 rounded-lg font-mono text-xs"
				/>
			</div>

			<div>
				<Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
					{t("mcps.editor.headersLabel")}
				</Label>
				<Textarea
					value={headersText}
					onChange={(event) => handleHeadersChange(event.target.value)}
					placeholder={t("mcps.editor.headersPlaceholder")}
					rows={4}
					className="mt-1 min-h-[108px] rounded-lg font-mono text-xs"
				/>
			</div>
		</div>
	);
};
