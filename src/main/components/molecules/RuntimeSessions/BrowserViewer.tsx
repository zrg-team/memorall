import React, { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { serviceManager } from "@/services";
import type { SandboxServerInfo } from "./types";
import { isSwRelayRequestMessage } from "./types";
import { normalizePreviewUrl } from "./utils";
import { platform } from "@/platform/current";

export const BrowserViewer: React.FC<{
	server: SandboxServerInfo;
	showOverlay?: boolean;
}> = ({ server, showOverlay = false }) => {
	const { t } = useTranslation();
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [renderUrl, setRenderUrl] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		serviceManager
			.getSandboxContainerService()
			.getServerRenderUrl({ port: server.port, path: "/" })
			.then((r) => {
				if (!cancelled) setRenderUrl(r.url);
			})
			.catch(() => {
				if (!cancelled) setRenderUrl(normalizePreviewUrl(server.url));
			});
		return () => {
			cancelled = true;
		};
	}, [server.port, server.url]);

	useEffect(() => {
		if (!renderUrl) return;
		const onMessage = (event: MessageEvent<unknown>) => {
			if (event.source !== iframeRef.current?.contentWindow) return;
			if (!isSwRelayRequestMessage(event.data)) return;
			const msg = event.data;
			void serviceManager
				.getSandboxContainerService()
				.handleSwRequestWithRetry({
					id: msg.id,
					port: msg.portNum,
					method: msg.method,
					path: msg.url,
					headers: msg.headers ?? {},
					body: msg.body ?? null,
				})
				.then((result) => {
					iframeRef.current?.contentWindow?.postMessage(
						{ type: "sw-relay-response", id: msg.id, data: result },
						"*",
					);
				})
				.catch((err: unknown) => {
					iframeRef.current?.contentWindow?.postMessage(
						{
							type: "sw-relay-response",
							id: msg.id,
							error: err instanceof Error ? err.message : String(err),
						},
						"*",
					);
				});
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [renderUrl]);

	const openInTab = () => {
		const url = renderUrl ?? server.url;
		const final = url.startsWith("/") ? platform.assets.url(url) : url;
		void platform.externalLinks.open(final);
	};

	if (!renderUrl) {
		return (
			<div className="p-3 text-xs text-muted-foreground">
				{t("sandboxPanel.resolvingUrl")}
			</div>
		);
	}

	return (
		<div className="flex flex-col h-full">
			<div className="flex items-center gap-1 border-t border-border/60 bg-muted/20 px-2 py-1 shrink-0">
				<span className="flex-1 truncate text-[10px] font-mono text-muted-foreground">
					{renderUrl}
				</span>
				<button
					type="button"
					title={t("sandboxPanel.openInTab")}
					onClick={openInTab}
					className="shrink-0 p-1 text-muted-foreground hover:text-foreground"
				>
					<ExternalLink size={11} />
				</button>
			</div>
			<div className="relative flex-1">
				<iframe
					ref={iframeRef}
					src={renderUrl}
					title={`Sandbox server :${server.port}`}
					className="w-full h-full bg-white"
					sandbox="allow-forms allow-modals allow-pointer-lock allow-popups allow-presentation allow-same-origin allow-scripts"
					referrerPolicy="no-referrer"
				/>
				{showOverlay && <div className="absolute inset-0" />}
			</div>
		</div>
	);
};
