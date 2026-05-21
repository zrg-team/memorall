import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { serviceManager } from "@/services";
import type { SandboxHandleSwRequestResult } from "@/services/sandbox-container";
import { logError } from "@/utils/logger";
import { ArtifactActionsMenu, type ArtifactProps } from "./ArtifactActionsMenu";

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
