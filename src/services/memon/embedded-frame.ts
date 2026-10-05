import {
	actOnRef,
	buildPageOutline,
	elementOfRef,
	type PageOutlineBlock,
} from "@/co-agent/dom/page-outline";
import type { SandboxHandleSwRequestResult } from "@/services/sandbox-container";
import {
	captureElement,
	type MemonCaptureRequest,
	type MemonPageCapture,
} from "./page-capture";
import type {
	WebOutlineActionRequest,
	WebOutlineActionResult,
	WebPageOutline,
} from "@/services/web-browser/web-browser-protocol";

/**
 * Embedded Browser tabs: pages of servers started in the computer's
 * Terminal. The sandbox serves them through its renderer page
 * (`/sandbox/pages/renderer.html?port=…&path=…`), which writes the server's
 * HTML into itself and relays the page's requests to the sandbox through
 * the document that frames it. A real browser tab cannot reach these
 * servers; a frame can, and its document is readable for the agent.
 */
export interface SandboxTarget {
	port: number;
	/** Path with query, starting with "/". */
	path: string;
}

/** What a frame needs from the sandbox container. */
export interface SandboxFrameHost {
	getServerRenderUrl(request: {
		port: number;
		path: string;
	}): Promise<{ url: string }>;
	handleSwRequestWithRetry(params: {
		id: number;
		port: number;
		method: string;
		path: string;
		headers: Record<string, string>;
		body: ArrayBuffer | null;
	}): Promise<SandboxHandleSwRequestResult>;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);
/** The renderer's own script, gone once the server's page replaced it. */
const RENDERER_SCRIPT = 'script[src$="renderer.js"]';
/** A written page's scripts get this long to run before it is read. */
const PAGE_SETTLE_MS = 800;
/** Longest wait for a page that never replaces the renderer (a failed fetch). */
const PAGE_WAIT_MS = 15_000;
const VIRTUAL_PATH = /^\/__virtual__\/(\d+)(\/.*)?$/;
const RENDERER_PATH = "/sandbox/pages/renderer.html";

const parse = (url: string): URL | null => {
	try {
		return new URL(
			url,
			typeof location !== "undefined" ? location.href : "http://localhost/",
		);
	} catch {
		return null;
	}
};

/** True for "localhost:3000", "127.0.0.1:8080/x" and the like. */
export const isLocalAddress = (input: string): boolean =>
	/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/\S*)?$/i.test(
		input.trim(),
	);

/**
 * The sandbox server a URL names: `http://localhost:3000/x`, or the
 * renderer and virtual URLs the sandbox itself uses.
 */
export const sandboxTargetOf = (url: string): SandboxTarget | null => {
	const parsed = parse(isLocalAddress(url) ? `http://${url.trim()}` : url);
	if (!parsed) return null;
	const virtual = VIRTUAL_PATH.exec(parsed.pathname);
	if (virtual) {
		return {
			port: Number(virtual[1]),
			path: `${virtual[2] || "/"}${parsed.search}`,
		};
	}
	if (parsed.pathname.endsWith(RENDERER_PATH)) {
		const port = Number(parsed.searchParams.get("port"));
		if (!Number.isInteger(port) || port <= 0) return null;
		return { port, path: parsed.searchParams.get("path") || "/" };
	}
	if (
		(parsed.protocol === "http:" || parsed.protocol === "https:") &&
		LOCAL_HOSTS.has(parsed.hostname) &&
		parsed.port
	) {
		return {
			port: Number(parsed.port),
			path: `${parsed.pathname || "/"}${parsed.search}`,
		};
	}
	return null;
};

/**
 * True for an address on this machine's loopback (localhost:3000), as
 * opposed to the renderer and virtual URLs that only the sandbox has.
 */
export const isLoopbackUrl = (url: string): boolean => {
	const parsed = parse(isLocalAddress(url) ? `http://${url.trim()}` : url);
	return Boolean(parsed && LOCAL_HOSTS.has(parsed.hostname));
};

/** The address the user and the agent see for a sandbox page. */
export const sandboxServerUrl = ({ port, path }: SandboxTarget): string =>
	`http://localhost:${port}${path.startsWith("/") ? path : `/${path}`}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

/**
 * Connects a renderer frame to the sandbox: answers the page's requests,
 * keeps link clicks and in-page navigations inside the renderer (the
 * virtual paths they lead to are outside the sandbox worker's scope), and
 * reports each page once it has rendered.
 */
export const attachSandboxFrame = (
	iframe: HTMLIFrameElement,
	sandbox: SandboxFrameHost,
	onReady: (url: string) => void,
): (() => void) => {
	const view = iframe.ownerDocument.defaultView ?? window;
	let readyTimer: ReturnType<typeof setTimeout> | undefined;

	const goTo = (target: SandboxTarget) => {
		void sandbox
			.getServerRenderUrl(target)
			.then(({ url }) => {
				iframe.src = url;
			})
			.catch(() => undefined);
	};

	const frameUrl = (): string | null => {
		try {
			const href = iframe.contentWindow?.location.href;
			const target = href ? sandboxTargetOf(href) : null;
			return target ? sandboxServerUrl(target) : null;
		} catch {
			return null;
		}
	};

	const ready = () => {
		if (readyTimer) clearTimeout(readyTimer);
		readyTimer = undefined;
		const url = frameUrl();
		if (url) onReady(url);
	};

	const onMessage = (event: MessageEvent<unknown>) => {
		if (event.source !== iframe.contentWindow || !isRecord(event.data)) return;
		const data = event.data;
		if (data.type === "virtual-renderer-ready") {
			ready();
			return;
		}
		if (
			data.type !== "sw-relay-request" ||
			typeof data.id !== "number" ||
			typeof data.portNum !== "number" ||
			typeof data.method !== "string" ||
			typeof data.url !== "string"
		) {
			return;
		}
		const id = data.id;
		const reply = (message: Record<string, unknown>) =>
			iframe.contentWindow?.postMessage(
				{ type: "sw-relay-response", id, ...message },
				"*",
			);
		void sandbox
			.handleSwRequestWithRetry({
				id,
				port: data.portNum,
				method: data.method,
				path: data.url,
				headers: isRecord(data.headers)
					? (data.headers as Record<string, string>)
					: {},
				body: data.body instanceof ArrayBuffer ? data.body : null,
			})
			.then((result) => reply({ data: result }))
			.catch((error: unknown) =>
				reply({
					error: error instanceof Error ? error.message : String(error),
				}),
			);
	};

	// Listened for as the click bubbles: the page's own handlers come first,
	// and a link they cancel (return false, a router's preventDefault) stays.
	const onClick = (event: MouseEvent) => {
		const anchor = (event.target as Element | null)?.closest?.("a[href]");
		if (!anchor || event.defaultPrevented) return;
		const raw = anchor.getAttribute("href") ?? "";
		if (raw.startsWith("#")) {
			// The page's <base> points at the server: an in-page link only scrolls.
			event.preventDefault();
			const id = decodeURIComponent(raw.slice(1));
			(id ? anchor.ownerDocument.getElementById(id) : null)?.scrollIntoView();
			return;
		}
		if (
			anchor.getAttribute("target") === "_blank" ||
			anchor.hasAttribute("download")
		) {
			return;
		}
		const target = sandboxTargetOf((anchor as HTMLAnchorElement).href);
		if (!target) return;
		event.preventDefault();
		goTo(target);
	};

	const onLoad = () => {
		let doc: Document | null = null;
		try {
			doc = iframe.contentDocument;
		} catch {
			return;
		}
		const pathname = doc?.location.pathname ?? "";
		// A navigation landed on a virtual path the worker does not serve:
		// show it through the renderer instead.
		const virtual = VIRTUAL_PATH.exec(pathname);
		if (virtual && doc) {
			goTo({
				port: Number(virtual[1]),
				path: `${virtual[2] || "/"}${doc.location.search}`,
			});
			return;
		}
		doc?.addEventListener("click", onClick);
		// The renderer says when its page is up. Without that, the page is up
		// once it has replaced the renderer's own document (the renderer
		// fetches the server's HTML first); a page that never comes is read
		// after a while anyway.
		if (readyTimer) clearTimeout(readyTimer);
		const loadedAt = Date.now();
		const watch = () => {
			let written = false;
			try {
				const current = iframe.contentDocument;
				// A written page may never reach "complete" (its window load does
				// not always fire); its parsed HTML is enough to read.
				written = Boolean(
					current &&
						current.readyState !== "loading" &&
						!current.querySelector(RENDERER_SCRIPT),
				);
				// document.write() starts a new document: keep catching links.
				if (written) current?.addEventListener("click", onClick);
			} catch {
				written = false;
			}
			if (written) {
				readyTimer = setTimeout(ready, PAGE_SETTLE_MS);
				return;
			}
			readyTimer =
				Date.now() - loadedAt > PAGE_WAIT_MS
					? setTimeout(ready, 0)
					: setTimeout(watch, 250);
		};
		readyTimer = setTimeout(watch, 250);
	};

	view.addEventListener("message", onMessage);
	iframe.addEventListener("load", onLoad);
	return () => {
		if (readyTimer) clearTimeout(readyTimer);
		view.removeEventListener("message", onMessage);
		iframe.removeEventListener("load", onLoad);
	};
};

const frameDocument = (iframe: HTMLIFrameElement): Document => {
	let doc: Document | null = null;
	try {
		doc = iframe.contentDocument;
	} catch {
		doc = null;
	}
	if (!doc) throw new Error("The embedded page is not readable yet.");
	return doc;
};

/** Links and the page address as the sandbox server's, not the renderer's. */
const toServerUrls = (outline: WebPageOutline): WebPageOutline => {
	const server = (url: string) => {
		const target = sandboxTargetOf(url);
		return target ? sandboxServerUrl(target) : url;
	};
	return {
		...outline,
		url: server(outline.url),
		blocks: outline.blocks.map((block: PageOutlineBlock) =>
			block.kind === "link" ? { ...block, href: server(block.href) } : block,
		),
	};
};

export const frameOutline = (
	iframe: HTMLIFrameElement,
	maxChars?: number,
): WebPageOutline =>
	toServerUrls(buildPageOutline(frameDocument(iframe), { maxChars }));

export const frameAct = async (
	iframe: HTMLIFrameElement,
	request: WebOutlineActionRequest,
	maxChars?: number,
): Promise<{ result: WebOutlineActionResult; outline?: WebPageOutline }> => {
	const result = actOnRef(frameDocument(iframe), request);
	await new Promise((resolve) => setTimeout(resolve, 120));
	let outline: WebPageOutline | undefined;
	try {
		outline = frameOutline(iframe, maxChars);
	} catch {
		outline = undefined;
	}
	return { result, outline };
};

/** A picture of a ref of the page in the frame, drawn from the page itself. */
export const frameCapture = async (
	iframe: HTMLIFrameElement,
	request: MemonCaptureRequest,
): Promise<MemonPageCapture> => {
	const doc = frameDocument(iframe);
	// Brings it into view and reads an image's address.
	const described = actOnRef(doc, { ...request, action: "describe" });
	const source = (described.ok && described.detail) || undefined;
	return captureElement(
		elementOfRef(doc, request.ref, request.docToken),
		source,
	);
};
