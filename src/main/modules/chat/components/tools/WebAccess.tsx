import React from "react";
import { useTranslation } from "react-i18next";
import { Globe, ExternalLink } from "lucide-react";
import { serviceManager } from "@/services";
import type {
	ActionRenderer,
	MessageActionItem,
} from "@/main/modules/chat/components/types";
import type { SandboxHandleSwRequestResult } from "@/services/sandbox-container";
import { defaultActionRenderer } from "./DefaultActionRenderer";
import {
	ApiResultPreview,
	type ApiResultPayload,
} from "@/main/modules/chat/components/tools/APIResult";
import { ToolItemRawIO } from "./ToolCommon";
import { platform } from "@/platform/current";

interface WebAccessPayload {
	url: string;
	requestedUrl?: string;
	html?: string;
	method?: string;
	path?: string;
	status?: number;
	ok?: boolean;
	contentType?: string;
	responseType?: string;
	body?: string;
}

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

interface RendererLoadErrorMessage {
	type: "renderer-load-error";
	error?: string;
	status?: number;
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

const isRendererLoadErrorMessage = (
	value: unknown,
): value is RendererLoadErrorMessage => {
	if (!isRecord(value)) {
		return false;
	}

	return value.type === "renderer-load-error";
};

const isFrameableUrl = (value: string): boolean => {
	if (value.startsWith("/__virtual__/")) return true;
	try {
		const parsed = new URL(
			value,
			typeof window !== "undefined"
				? window.location.origin
				: "http://localhost",
		);
		return (
			parsed.protocol === "http:" ||
			parsed.protocol === "https:" ||
			parsed.protocol === "chrome-extension:"
		);
	} catch {
		return false;
	}
};

const normalizePreviewUrl = (rawUrl: string): string => {
	if (rawUrl.startsWith("/__virtual__/")) {
		return /\/$/.test(rawUrl) ? rawUrl : `${rawUrl}/`;
	}
	try {
		const parsed = new URL(rawUrl);
		if (parsed.pathname.startsWith("/__virtual__/")) {
			const normalizedPath = /\/$/.test(parsed.pathname)
				? parsed.pathname
				: `${parsed.pathname}/`;
			return `${normalizedPath}${parsed.search}${parsed.hash}`;
		}
		if (parsed.hostname === "0.0.0.0" || parsed.hostname === "::") {
			parsed.hostname = "127.0.0.1";
		}
		return parsed.toString();
	} catch {
		return rawUrl;
	}
};

const getVirtualSandboxLocation = (
	rawUrl: string,
): VirtualSandboxLocation | null => {
	const parsePath = (pathname: string): VirtualSandboxLocation | null => {
		const match = pathname.match(/^\/__virtual__\/(\d+)(\/.*)?$/);
		if (!match) {
			return null;
		}

		return {
			port: Number(match[1]),
			path: match[2] || "/",
		};
	};

	if (rawUrl.startsWith("/__virtual__/")) {
		return parsePath(rawUrl);
	}

	try {
		return parsePath(new URL(rawUrl).pathname);
	} catch {
		return null;
	}
};

const extractWebAccessPayload = (
	item: MessageActionItem,
): WebAccessPayload | null => {
	const fromMetadata = item.metadata;
	if (fromMetadata && typeof fromMetadata.url === "string") {
		return {
			requestedUrl:
				typeof fromMetadata.requestedUrl === "string"
					? fromMetadata.requestedUrl
					: undefined,
			url: fromMetadata.url,
			html:
				typeof fromMetadata.html === "string" ? fromMetadata.html : undefined,
			method:
				typeof fromMetadata.method === "string"
					? fromMetadata.method
					: undefined,
			path:
				typeof fromMetadata.path === "string" ? fromMetadata.path : undefined,
			status:
				typeof fromMetadata.status === "number"
					? fromMetadata.status
					: undefined,
			ok: typeof fromMetadata.ok === "boolean" ? fromMetadata.ok : undefined,
			contentType:
				typeof fromMetadata.contentType === "string"
					? fromMetadata.contentType
					: undefined,
			responseType:
				typeof fromMetadata.responseType === "string"
					? fromMetadata.responseType
					: undefined,
			body:
				typeof fromMetadata.body === "string" ? fromMetadata.body : undefined,
		};
	}

	try {
		const parsed = JSON.parse(item.description);
		if (!isRecord(parsed) || typeof parsed.url !== "string") {
			return null;
		}
		return {
			requestedUrl:
				typeof parsed.requestedUrl === "string"
					? parsed.requestedUrl
					: undefined,
			url: parsed.url,
			html: typeof parsed.html === "string" ? parsed.html : undefined,
			method: typeof parsed.method === "string" ? parsed.method : undefined,
			path: typeof parsed.path === "string" ? parsed.path : undefined,
			status: typeof parsed.status === "number" ? parsed.status : undefined,
			ok: typeof parsed.ok === "boolean" ? parsed.ok : undefined,
			contentType:
				typeof parsed.contentType === "string" ? parsed.contentType : undefined,
			responseType:
				typeof parsed.responseType === "string"
					? parsed.responseType
					: undefined,
			body: typeof parsed.body === "string" ? parsed.body : undefined,
		};
	} catch {
		return null;
	}
};

const isApiPayload = (payload: WebAccessPayload): boolean => {
	const contentType = payload.contentType?.toLowerCase() ?? "";
	const responseType = payload.responseType?.toLowerCase() ?? "";

	if (responseType === "json" || responseType === "text") {
		return true;
	}

	if (contentType && !contentType.includes("text/html")) {
		return true;
	}

	return !payload.html && typeof payload.body === "string";
};

const WebAccessPreview: React.FC<{ payload: WebAccessPayload }> = ({
	payload,
}) => {
	const { t } = useTranslation("chat");
	const previewUrl = normalizePreviewUrl(payload.url);
	const virtualLocation = React.useMemo(
		() => getVirtualSandboxLocation(payload.url),
		[payload.url],
	);
	const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
	const [livePreviewUrl, setLivePreviewUrl] = React.useState<string | null>(
		null,
	);
	const [useHtmlFallback, setUseHtmlFallback] = React.useState(
		payload.ok === false,
	);
	const canFrameUrl = isFrameableUrl(previewUrl);
	const htmlPreview = payload.html?.trim() || "";
	const iframeSrc = useHtmlFallback
		? null
		: (livePreviewUrl ?? (canFrameUrl ? previewUrl : null));

	React.useEffect(() => {
		setUseHtmlFallback(payload.ok === false);
	}, [payload.ok]);

	React.useEffect(() => {
		let cancelled = false;

		const resolveLivePreview = async (): Promise<void> => {
			if (!virtualLocation) {
				setLivePreviewUrl(null);
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
					setLivePreviewUrl(result.url);
				}
			} catch (error) {
				if (!cancelled) {
					setLivePreviewUrl(null);
					if (htmlPreview) {
						setUseHtmlFallback(true);
					}
				}
			}
		};

		void resolveLivePreview();

		return () => {
			cancelled = true;
		};
	}, [htmlPreview, virtualLocation]);

	React.useEffect(() => {
		if (!livePreviewUrl) {
			return;
		}

		const onMessage = (event: MessageEvent<unknown>): void => {
			if (event.source !== iframeRef.current?.contentWindow) {
				return;
			}

			const data = event.data;
			if (isRendererLoadErrorMessage(data)) {
				if (htmlPreview) {
					setUseHtmlFallback(true);
				}
				return;
			}

			if (!isSwRelayRequestMessage(data)) {
				return;
			}

			const message = data;
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
					if (htmlPreview) {
						setUseHtmlFallback(true);
					}

					const response: SwRelayResponseMessage = {
						type: "sw-relay-response",
						id: message.id,
						error: error instanceof Error ? error.message : String(error),
					};
					iframeRef.current?.contentWindow?.postMessage(response, "*");
				});
		};

		window.addEventListener("message", onMessage);
		return () => {
			window.removeEventListener("message", onMessage);
		};
	}, [htmlPreview, livePreviewUrl]);

	return (
		<div className="w-full rounded-lg border border-border/60 overflow-hidden bg-background">
			<div className="flex items-center gap-2 px-3 py-2 border-b border-border/60 bg-muted/30">
				<Globe className="w-4 h-4 text-muted-foreground shrink-0" />
				<div className="flex-1 text-xs font-mono truncate">{previewUrl}</div>
				{typeof payload.status === "number" ? (
					<span
						className={`text-[10px] px-1.5 py-0.5 rounded border ${
							payload.ok
								? "text-green-600 border-green-600/30 bg-green-600/10"
								: "text-red-600 border-red-600/30 bg-red-600/10"
						}`}
					>
						{payload.status}
					</span>
				) : null}
				<button
					type="button"
					title="Open in new tab"
					className="text-muted-foreground hover:text-foreground shrink-0"
					onClick={() => {
						const targetUrl = livePreviewUrl ?? previewUrl;
						const url = targetUrl.startsWith("/")
							? platform.assets.url(targetUrl)
							: targetUrl;
						void platform.externalLinks.open(url);
					}}
				>
					<ExternalLink className="w-3.5 h-3.5" />
				</button>
			</div>
			{iframeSrc ? (
				<iframe
					ref={iframeRef}
					title={t("actions.webAccess.iframeTitle", {
						defaultValue: "Web access preview: {{url}}",
						url: payload.url,
					})}
					src={iframeSrc}
					className="w-full h-[360px] bg-white"
					sandbox="allow-forms allow-modals allow-pointer-lock allow-popups allow-presentation allow-same-origin allow-scripts"
					referrerPolicy="no-referrer"
					onError={() => {
						if (htmlPreview) {
							setUseHtmlFallback(true);
						}
					}}
				/>
			) : htmlPreview ? (
				<iframe
					title={t("actions.webAccess.htmlIframeTitle", {
						defaultValue: "Web access HTML preview",
					})}
					srcDoc={htmlPreview}
					className="w-full h-[360px] bg-white"
					sandbox="allow-forms allow-modals allow-pointer-lock allow-popups allow-presentation allow-same-origin allow-scripts"
				/>
			) : (
				<div className="px-3 py-4 text-sm text-muted-foreground">
					{t("actions.webAccess.emptyPreview", {
						defaultValue: "No renderable URL/HTML found for web preview.",
					})}
				</div>
			)}
			{htmlPreview ? (
				<details className="border-t border-border/60">
					<summary className="cursor-pointer select-none px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
						{t("actions.webAccess.htmlSourcePreview", {
							defaultValue: "HTML source preview",
						})}
					</summary>
					<pre className="max-h-64 overflow-auto p-3 text-xs whitespace-pre-wrap break-all bg-muted/20 border-t border-border/60">
						{htmlPreview}
					</pre>
				</details>
			) : null}
		</div>
	);
};

export const webAccessRenderer: ActionRenderer = (item, isOpen) => {
	if (!isOpen) return null;
	const payload = extractWebAccessPayload(item);
	if (!payload) {
		return defaultActionRenderer(item, isOpen);
	}

	if (isApiPayload(payload)) {
		const apiPayload: ApiResultPayload = {
			url: payload.url,
			method: payload.method,
			path: payload.path,
			status: payload.status,
			ok: payload.ok,
			contentType: payload.contentType,
			responseType: payload.responseType,
			body: payload.body,
		};

		return (
			<div className="space-y-3">
				<ApiResultPreview payload={apiPayload} />
				<ToolItemRawIO item={item} output={payload} />
			</div>
		);
	}

	return (
		<div className="space-y-3">
			<WebAccessPreview payload={payload} />
			<ToolItemRawIO item={item} output={payload} />
		</div>
	);
};
