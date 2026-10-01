import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { serviceManager } from "@/services";
import { serveEmbeddedPage } from "@/services/memon/embedded-browser";
import {
	attachSandboxFrame,
	frameAct,
	frameOutline,
	sandboxTargetOf,
} from "@/services/memon/embedded-frame";
import type { MemonBrowserTab } from "@/services/memon/types";
import { logError } from "@/utils/logger";
import type { MemonSend } from "../types";

/** How long a page may take to render before it is read anyway. */
const READY_TIMEOUT_MS = 20_000;
/** Time for the computer to hear that this frame took the page over. */
const TAKEOVER_SETTLE_MS = 300;

/**
 * An embedded Browser tab: the page of a server running in the computer,
 * in a frame. While it is shown, this frame is the page the agent reads
 * and clicks, so the user and the agent work on the same page.
 */
export const EmbeddedPage: React.FC<{
	machineKey: string;
	tab: MemonBrowserTab;
	send: MemonSend;
	hidden?: boolean;
}> = ({ machineKey, tab, send, hidden }) => {
	const { t } = useTranslation("common");
	const iframeRef = React.useRef<HTMLIFrameElement>(null);
	const [src, setSrc] = React.useState<string | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	/** The page this frame shows, as its server address. */
	const shownUrl = React.useRef<string | null>(null);
	/** Set while the agent navigates, so that load is not the user's. */
	const agentNavigation = React.useRef<string | null>(null);
	const readyWaiters = React.useRef<Array<() => void>>([]);
	const serving = React.useRef<(() => void) | null>(null);
	const sessionId = tab.sessionId;

	// Loads the tab's page. Once this frame serves the tab, the agent's
	// navigation goes through it instead.
	React.useEffect(() => {
		if (serving.current || tab.url === shownUrl.current) return;
		const target = sandboxTargetOf(tab.url);
		if (!target) {
			setError(t("memonComputer.browser.notAServer", { url: tab.url }));
			return;
		}
		let cancelled = false;
		void serviceManager
			.getSandboxContainerService()
			.getServerRenderUrl(target)
			.then(({ url }) => {
				if (cancelled) return;
				shownUrl.current = tab.url;
				setError(null);
				setSrc(url);
			})
			.catch((reason: unknown) => {
				if (!cancelled) {
					setError(reason instanceof Error ? reason.message : String(reason));
				}
			});
		return () => {
			cancelled = true;
		};
	}, [tab.url, t]);

	React.useLayoutEffect(() => {
		const iframe = iframeRef.current;
		if (!iframe || !src) return;
		const sandbox = serviceManager.getSandboxContainerService();
		const waitForPage = () =>
			new Promise<void>((resolve) => {
				readyWaiters.current.push(resolve);
				setTimeout(resolve, READY_TIMEOUT_MS);
			});
		const detach = attachSandboxFrame(iframe, sandbox, (url) => {
			for (const resolve of readyWaiters.current.splice(0)) resolve();
			const byAgent = agentNavigation.current !== null;
			agentNavigation.current = null;
			const moved = url !== shownUrl.current;
			shownUrl.current = url;
			if (!serving.current) {
				serving.current = serveEmbeddedPage(sessionId, {
					outline: () => frameOutline(iframe),
					act: (request) => frameAct(iframe, request),
					async navigate(next) {
						const target = sandboxTargetOf(next);
						if (!target)
							throw new Error(`${next} is not a server in this computer.`);
						agentNavigation.current = next;
						const loaded = waitForPage();
						iframe.src = (await sandbox.getServerRenderUrl(target)).url;
						await loaded;
					},
					async history(direction) {
						const loaded = waitForPage();
						agentNavigation.current = direction;
						if (direction === "back") iframe.contentWindow?.history.back();
						else iframe.contentWindow?.history.forward();
						await loaded;
					},
				});
				// This frame is the page now: the agent reads it from here, once
				// the computer has heard that it took over.
				setTimeout(
					() => void send("browser.refresh", { key: machineKey }),
					TAKEOVER_SETTLE_MS,
				);
			}
			// The user followed a link in the page: the agent reads it next.
			if (moved && !byAgent) {
				void send("browser.embeddedNavigated", { key: machineKey, url });
			}
		});
		return () => {
			detach();
			serving.current?.();
			serving.current = null;
		};
	}, [src, sessionId, machineKey, send]);

	if (error) {
		return (
			<p className="m-3 rounded-md border border-red-600/20 bg-red-600/5 px-2 py-1 text-xs text-red-700 dark:text-red-300">
				{error}
			</p>
		);
	}
	return src ? (
		<iframe
			ref={iframeRef}
			src={src}
			title={tab.title || tab.url}
			// Behind the agent's view it stays laid out: the outline reads only
			// what has a layout.
			className={cn(
				"absolute inset-0 h-full w-full border-0 bg-white",
				hidden && "pointer-events-none opacity-0",
			)}
			sandbox="allow-forms allow-modals allow-pointer-lock allow-popups allow-presentation allow-same-origin allow-scripts"
			referrerPolicy="no-referrer"
			onError={() => logError("[MEMON] Embedded page failed to load", tab.url)}
		/>
	) : (
		<p className="m-3 text-xs text-muted-foreground">
			{t("memonComputer.pageLoading")}
		</p>
	);
};
