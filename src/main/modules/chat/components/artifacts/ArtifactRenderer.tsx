import React, { useEffect, useMemo, useRef, useState } from "react";
import "@hyperframes/player";
import { useTranslation } from "react-i18next";
import { Save, Check, ExternalLink, MoreHorizontal } from "lucide-react";
import { Button } from "@/main/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/main/components/ui/dropdown-menu";
import { serviceManager } from "@/services";
import type { SandboxHandleSwRequestResult } from "@/services/sandbox-container";
import { logError } from "@/utils/logger";
import { DocumentSaveFolderDialog } from "../DocumentSaveFolderDialog";
import type { ArtifactType } from "./artifact-protocol";
import MarkdownMessage from "../MarkdownMessage";

interface ArtifactProps {
	content: string;
	identifier?: string;
	title?: string;
}

type SaveState = "idle" | "saving" | "saved";

interface VirtualSandboxLocation {
	port: number;
	path: string;
}

interface SwRelayRequestMessage {
	type: "sw-relay-request";
	id: number;
	portNum: number;
	method: string;
	url: string;
	headers?: Record<string, string>;
	body?: ArrayBuffer | null;
}

interface SwRelayResponseMessage {
	type: "sw-relay-response";
	id: number;
	data?: SandboxHandleSwRequestResult;
	error?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const isSwRelayRequestMessage = (
	value: unknown,
): value is SwRelayRequestMessage => {
	if (!isRecord(value)) {
		return false;
	}

	return (
		value.type === "sw-relay-request" &&
		typeof value.id === "number" &&
		typeof value.portNum === "number" &&
		typeof value.method === "string" &&
		typeof value.url === "string"
	);
};

const toUrl = (rawUrl: string): URL | null => {
	try {
		return new URL(
			rawUrl,
			typeof window !== "undefined"
				? window.location.origin
				: "http://localhost",
		);
	} catch {
		return null;
	}
};

const getVirtualSandboxLocation = (
	rawUrl: string,
): VirtualSandboxLocation | null => {
	const parsed = toUrl(rawUrl);
	if (!parsed) {
		return null;
	}

	const virtualMatch = parsed.pathname.match(/^\/__virtual__\/(\d+)(\/.*)?$/);
	if (virtualMatch) {
		return {
			port: Number(virtualMatch[1]),
			path: `${virtualMatch[2] || "/"}${parsed.search}`,
		};
	}

	if (parsed.pathname.endsWith("/sandbox/pages/renderer.html")) {
		const port = Number(parsed.searchParams.get("port"));
		if (!Number.isFinite(port)) {
			return null;
		}
		return {
			port,
			path: parsed.searchParams.get("path") || "/",
		};
	}

	return null;
};

const isFrameableUrl = (rawUrl: string): boolean => {
	const parsed = toUrl(rawUrl);
	if (!parsed) {
		return false;
	}

	return (
		parsed.protocol === "http:" ||
		parsed.protocol === "https:" ||
		parsed.protocol === "chrome-extension:"
	);
};

const toSafeFileName = (value?: string) => {
	const name = (value?.trim() || "artifact")
		.replace(/[^a-z0-9._-]+/gi, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);

	return name || "artifact";
};

interface ArtifactAction {
	label: string;
	icon: React.ReactNode;
	onClick: () => void;
	disabled?: boolean;
}

const ArtifactActionsMenu: React.FC<{
	actions: ArtifactAction[];
	label: string;
}> = ({ actions, label }) => {
	if (actions.length === 0) {
		return null;
	}

	return (
		<div className="absolute right-2 top-2 z-10">
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						title={label}
						className="h-7 w-7 bg-background/75 text-muted-foreground opacity-80 shadow-sm backdrop-blur transition-opacity hover:bg-background/90 hover:text-foreground hover:opacity-100"
					>
						<MoreHorizontal size={15} />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					{actions.map((action) => (
						<DropdownMenuItem
							key={action.label}
							onClick={action.onClick}
							disabled={action.disabled}
							className="flex items-center gap-2"
						>
							{action.icon}
							<span>{action.label}</span>
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
};

const HtmlArtifact: React.FC<ArtifactProps> = ({
	content,
	identifier,
	title,
}) => {
	const [saveState, setSaveState] = useState<SaveState>("idle");
	const [saveDialogOpen, setSaveDialogOpen] = useState(false);
	const { t } = useTranslation("chat");

	const handleSave = () => {
		if (saveState !== "idle") return;
		setSaveDialogOpen(true);
	};

	return (
		<div className="relative my-2 overflow-hidden rounded-md">
			<ArtifactActionsMenu
				label={t("htmlPreview.artifactActions")}
				actions={[
					{
						label:
							saveState === "saved"
								? t("htmlPreview.saved")
								: saveState === "saving"
									? t("htmlPreview.saving")
									: t("htmlPreview.save"),
						icon:
							saveState === "saved" ? (
								<Check className="h-3.5 w-3.5" />
							) : (
								<Save className="h-3.5 w-3.5" />
							),
						onClick: handleSave,
						disabled: saveState !== "idle",
					},
				]}
			/>
			<DocumentSaveFolderDialog
				open={saveDialogOpen}
				content={content}
				initialFileName={`${toSafeFileName(identifier || title)}-${Date.now()}.html`}
				mimeType="text/html"
				onOpenChange={setSaveDialogOpen}
				onSaved={() => {
					setSaveState("saved");
					setTimeout(() => setSaveState("idle"), 2000);
				}}
				onError={(err) => {
					logError("Failed to save artifact HTML to documents:", err);
					setSaveState("idle");
				}}
			/>
			<iframe
				srcDoc={content}
				sandbox="allow-scripts allow-same-origin"
				className="w-full bg-white"
				style={{ height: "60vh", border: "none" }}
				title={title || t("htmlPreview.title")}
			/>
		</div>
	);
};

export const UrlArtifact: React.FC<ArtifactProps> = ({ content, title }) => {
	const { t } = useTranslation("chat");
	const url = content.trim();
	const iframeRef = useRef<HTMLIFrameElement | null>(null);
	const virtualLocation = useMemo(() => getVirtualSandboxLocation(url), [url]);
	const [renderUrl, setRenderUrl] = useState<string | null>(null);
	const iframeSrc = virtualLocation
		? renderUrl
		: isFrameableUrl(url)
			? url
			: null;

	useEffect(() => {
		let cancelled = false;

		const resolveSandboxRenderUrl = async (): Promise<void> => {
			if (!virtualLocation) {
				setRenderUrl(null);
				return;
			}

			try {
				const result = await serviceManager
					.getSandboxContainerService()
					.getServerRenderUrl({
						port: virtualLocation.port,
						path: virtualLocation.path,
					});
				if (!cancelled) {
					setRenderUrl(result.url);
				}
			} catch (error) {
				logError("Failed to resolve sandbox artifact render URL:", error);
				if (!cancelled) {
					setRenderUrl(null);
				}
			}
		};

		void resolveSandboxRenderUrl();

		return () => {
			cancelled = true;
		};
	}, [virtualLocation]);

	useEffect(() => {
		if (!virtualLocation || !iframeSrc) {
			return;
		}

		const onMessage = (event: MessageEvent<unknown>): void => {
			if (event.source !== iframeRef.current?.contentWindow) {
				return;
			}
			if (!isSwRelayRequestMessage(event.data)) {
				return;
			}

			const message = event.data;
			void serviceManager
				.getSandboxContainerService()
				.handleSwRequestWithRetry({
					id: message.id,
					port: message.portNum,
					method: message.method,
					path: message.url,
					headers: message.headers ?? {},
					body: message.body ?? null,
				})
				.then((result) => {
					const response: SwRelayResponseMessage = {
						type: "sw-relay-response",
						id: message.id,
						data: result,
					};
					iframeRef.current?.contentWindow?.postMessage(response, "*");
				})
				.catch((error: unknown) => {
					const response: SwRelayResponseMessage = {
						type: "sw-relay-response",
						id: message.id,
						error: error instanceof Error ? error.message : String(error),
					};
					iframeRef.current?.contentWindow?.postMessage(response, "*");
				});
		};

		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [iframeSrc, virtualLocation]);

	const openInTab = () => {
		if (!iframeSrc) return;
		const tabUrl = iframeSrc.startsWith("/")
			? chrome.runtime.getURL(iframeSrc.replace(/^\//, ""))
			: iframeSrc;
		chrome.tabs.create({ url: tabUrl });
	};

	return (
		<div className="relative my-2 overflow-hidden rounded-md">
			<ArtifactActionsMenu
				label={t("htmlPreview.artifactActions")}
				actions={
					iframeSrc
						? [
								{
									label: t("htmlPreview.openInNewTab"),
									icon: <ExternalLink className="h-3.5 w-3.5" />,
									onClick: openInTab,
								},
							]
						: []
				}
			/>
			{iframeSrc ? (
				<iframe
					ref={iframeRef}
					src={iframeSrc}
					className="w-full bg-white"
					style={{ height: "60vh", border: "none" }}
					title={title || url}
					sandbox="allow-forms allow-modals allow-pointer-lock allow-popups allow-presentation allow-same-origin allow-scripts"
					referrerPolicy="no-referrer"
				/>
			) : virtualLocation ? (
				<div className="px-3 py-4 text-sm text-muted-foreground">
					{t("htmlPreview.resolvingSandboxPreview")}
				</div>
			) : (
				<div className="px-3 py-4 text-sm text-muted-foreground">
					{t("htmlPreview.unsupportedUrl", { url })}
				</div>
			)}
		</div>
	);
};

const HyperframesArtifact: React.FC<ArtifactProps> = ({ content, title }) => {
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const blob = new Blob([content], { type: "text/html" });
		const blobUrl = URL.createObjectURL(blob);

		const player = document.createElement("hyperframes-player");
		player.setAttribute("src", blobUrl);
		player.setAttribute("controls", "");
		player.setAttribute("autoplay", "");
		player.setAttribute("muted", "");
		player.style.cssText = "display:block;width:100%;height:100%";
		container.appendChild(player);

		return () => {
			player.remove();
			URL.revokeObjectURL(blobUrl);
		};
	}, [content]);

	return (
		<div
			ref={containerRef}
			className="my-2 overflow-hidden rounded-md bg-black"
			style={{ height: "60vh" }}
			aria-label={title || "HyperFrames composition"}
		/>
	);
};

interface ArtifactRendererProps {
	type: ArtifactType;
	content: string;
	identifier?: string;
	title?: string;
}

export const ArtifactRenderer: React.FC<ArtifactRendererProps> = ({
	type,
	content,
	identifier,
	title,
}) => {
	switch (type) {
		case "html":
			return (
				<HtmlArtifact content={content} identifier={identifier} title={title} />
			);
		case "url":
			return <UrlArtifact content={content} title={title} />;
		case "hyperframes":
			return (
				<HyperframesArtifact
					content={content}
					identifier={identifier}
					title={title}
				/>
			);
		case "markdown":
			return (
				<div className="my-2 rounded-md border border-border/70 bg-muted/10 p-3">
					<MarkdownMessage>{content}</MarkdownMessage>
				</div>
			);
		case "text":
			return (
				<pre className="my-2 max-h-96 overflow-auto rounded-md border border-border/70 bg-muted/10 p-3 text-xs leading-relaxed text-muted-foreground">
					{content}
				</pre>
			);
		default:
			return null;
	}
};
