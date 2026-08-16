import type { BackendSession, BrowserBackend } from "./browser-backend";
import {
	BrowserAutomationError,
	checkedHttpUrl,
	type BrowserMode,
	type BrowserSnapshot,
	type EngineStatus,
	withTimeoutSignal,
} from "./browser-runtime-types";

const decodeEntities = (value: string): string =>
	value
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'")
		.replace(/&#(\d+);/g, (_, code: string) =>
			String.fromCodePoint(Number.parseInt(code, 10)),
		);

const readableText = (html: string): string =>
	decodeEntities(
		html
			.replace(/<(script|style|noscript|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
			.replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
			.replace(/<[^>]+>/g, " "),
	)
		.replace(/[ \t\f\v]+/g, " ")
		.replace(/\s*\n\s*/g, "\n")
		.trim();

const titleOf = (html: string): string => {
	const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
	return match
		? decodeEntities(match[1] ?? "")
				.replace(/\s+/g, " ")
				.trim()
		: "";
};

export class DirectBrowserBackend implements BrowserBackend {
	readonly engine = "direct" as const;
	private nextHandle = 0;
	private readonly snapshots = new Map<number, BrowserSnapshot>();

	async status(_signal?: AbortSignal): Promise<EngineStatus> {
		return {
			engine: this.engine,
			readiness: "ready",
			version: process.version,
		};
	}

	async open(
		rawUrl: string,
		_mode: BrowserMode,
		timeoutMs: number,
		maxHtmlChars: number,
		signal?: AbortSignal,
	): Promise<{ session: BackendSession; snapshot: BrowserSnapshot }> {
		const url = checkedHttpUrl(rawUrl);
		const timed = withTimeoutSignal(timeoutMs, signal);
		let response: Response;
		try {
			response = await fetch(url, {
				redirect: "follow",
				signal: timed.signal,
				headers: {
					Accept:
						"text/html,application/xhtml+xml;q=0.9,text/plain;q=0.7,*/*;q=0.1",
					"User-Agent": "MemorallDesktop/1.0 (+browser automation)",
				},
			});
		} catch (error) {
			throw new BrowserAutomationError(
				timed.signal.aborted ? "NAVIGATION_TIMEOUT" : "DIRECT_FETCH_FAILED",
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			timed.dispose();
		}
		if (!response.ok) {
			throw new BrowserAutomationError(
				"DIRECT_HTTP_ERROR",
				`Direct fetch returned HTTP ${response.status}.`,
			);
		}
		const contentType =
			response.headers.get("content-type")?.toLowerCase() ?? "";
		if (!contentType.includes("html") && !contentType.includes("text/plain")) {
			throw new BrowserAutomationError(
				"DIRECT_UNSUPPORTED_CONTENT",
				`Direct fetch cannot render ${contentType || "this content type"}.`,
			);
		}
		const fullHtml = await response.text();
		const text = contentType.includes("text/plain")
			? fullHtml.trim()
			: readableText(fullHtml);
		const scriptCount = (fullHtml.match(/<script\b/gi) ?? []).length;
		const challengeShell =
			/(?:verify (?:that )?you are human|checking your browser|enable javascript and cookies|attention required|security verification|access denied)/i.test(
				text.slice(0, 10_000),
			);
		if ((text.length < 80 && scriptCount > 0) || challengeShell) {
			throw new BrowserAutomationError(
				"DIRECT_CONTENT_INCOMPLETE",
				"The response is an application or verification shell that requires a stateful browser engine.",
			);
		}
		const snapshot: BrowserSnapshot = {
			url: response.url || url,
			title: contentType.includes("text/plain") ? "" : titleOf(fullHtml),
			html: fullHtml.slice(0, maxHtmlChars),
			text,
			domAccessible: false,
		};
		const handle = ++this.nextHandle;
		this.snapshots.set(handle, snapshot);
		return {
			session: { engine: this.engine, handle, url: snapshot.url },
			snapshot,
		};
	}

	async snapshot(
		session: BackendSession,
		maxHtmlChars: number,
	): Promise<BrowserSnapshot> {
		const snapshot = this.snapshots.get(Number(session.handle));
		if (!snapshot) {
			throw new BrowserAutomationError(
				"SESSION_NOT_FOUND",
				"Direct browser session no longer exists.",
			);
		}
		return { ...snapshot, html: snapshot.html.slice(0, maxHtmlChars) };
	}

	async close(session: BackendSession): Promise<void> {
		this.snapshots.delete(Number(session.handle));
	}

	async stop(): Promise<void> {
		this.snapshots.clear();
	}
}
