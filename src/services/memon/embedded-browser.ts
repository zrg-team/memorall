import type {
	WebHistoryDirection,
	WebOutlineActionRequest,
	WebOutlineActionResult,
	WebPageOutline,
} from "@/services/web-browser/web-browser-protocol";
import {
	attachSandboxFrame,
	frameAct,
	frameCapture,
	frameOutline,
	type SandboxFrameHost,
	type SandboxTarget,
	sandboxServerUrl,
	sandboxTargetOf,
} from "./embedded-frame";
import type { MemonBrowserPort } from "./memon-machine";
import type { MemonCaptureRequest, MemonPageCapture } from "./page-capture";
import { settleOutline } from "./settle-outline";

/**
 * Who shows an embedded tab. While the Computer window shows the tab, that
 * frame is the page: the agent reads and clicks the page the user sees and
 * types into. Otherwise the computer keeps a hidden frame of its own.
 * Hosts and computers talk over a BroadcastChannel, which reaches every
 * extension page and the offscreen document alike, and the same page on
 * the web and desktop builds.
 */
const CHANNEL = "memorall-memon-embedded";

export type EmbeddedOp = "outline" | "act" | "navigate" | "history" | "capture";

type HostMessage =
	| { kind: "claim"; sessionId: string; hostId: string }
	| { kind: "release"; sessionId: string; hostId: string }
	| {
			kind: "request";
			id: string;
			hostId: string;
			sessionId: string;
			op: EmbeddedOp;
			args?: unknown;
	  }
	| { kind: "response"; id: string; ok: true; result: unknown }
	| { kind: "response"; id: string; ok: false; error: string };

const openChannel = (): BroadcastChannel | null =>
	typeof BroadcastChannel === "undefined"
		? null
		: new BroadcastChannel(CHANNEL);

const randomId = () => Math.random().toString(36).slice(2, 10);

export interface EmbeddedPageHandlers {
	outline(): Promise<WebPageOutline> | WebPageOutline;
	act(
		request: WebOutlineActionRequest,
	): Promise<{ result: WebOutlineActionResult; outline?: WebPageOutline }>;
	navigate(url: string): Promise<void>;
	history(direction: WebHistoryDirection): Promise<void>;
	/** A picture of a ref of the page. */
	capture(request: MemonCaptureRequest): Promise<MemonPageCapture>;
}

/**
 * Serves one embedded tab from the window that shows it. Call once the
 * frame shows the tab's page; the returned function hands it back.
 */
export const serveEmbeddedPage = (
	sessionId: string,
	handlers: EmbeddedPageHandlers,
): (() => void) => {
	const channel = openChannel();
	if (!channel) return () => undefined;
	const hostId = randomId();
	channel.onmessage = (event: MessageEvent<HostMessage>) => {
		const message = event.data;
		if (message.kind !== "request" || message.hostId !== hostId) return;
		const run = async (): Promise<unknown> => {
			switch (message.op) {
				case "outline":
					return handlers.outline();
				case "act":
					return handlers.act(message.args as WebOutlineActionRequest);
				case "navigate":
					return handlers.navigate(String(message.args));
				case "history":
					return handlers.history(message.args as WebHistoryDirection);
				case "capture":
					return handlers.capture(message.args as MemonCaptureRequest);
			}
		};
		void run().then(
			(result) =>
				channel.postMessage({
					kind: "response",
					id: message.id,
					ok: true,
					result,
				} satisfies HostMessage),
			(error: unknown) =>
				channel.postMessage({
					kind: "response",
					id: message.id,
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				} satisfies HostMessage),
		);
	};
	channel.postMessage({
		kind: "claim",
		sessionId,
		hostId,
	} satisfies HostMessage);
	return () => {
		channel.postMessage({
			kind: "release",
			sessionId,
			hostId,
		} satisfies HostMessage);
		channel.close();
	};
};

export interface MemonEmbeddedPort extends MemonBrowserPort {
	/** Ports of the servers running in the sandbox. */
	servers(): Promise<number[]>;
	/** Closes a server, such as one a stopped command opened. */
	stopServer?(port: number): Promise<void>;
	/** A picture of an element: drawn from the page, which this window can reach. */
	capture(
		sessionId: string,
		request: MemonCaptureRequest,
	): Promise<MemonPageCapture>;
}

interface EmbeddedSession {
	target: SandboxTarget;
	hostId?: string;
	frame?: {
		iframe: HTMLIFrameElement;
		detach: () => void;
		ready: Promise<void>;
	};
}

const READY_TIMEOUT_MS = 20_000;
const HOST_TIMEOUT_MS = 15_000;

/** Resolves the sandbox the same way the rest of the app does. */
const defaultSandbox = async (): Promise<
	SandboxFrameHost & {
		listServers(): Promise<{ servers: { port: number }[] }>;
		stopServer?(request: { port: number }): Promise<unknown>;
	}
> => {
	const { serviceManager } = await import("@/services");
	return serviceManager.getSandboxContainerService();
};

/** Embedded Browser tabs, behind the same port as real tabs. */
export const createMemonEmbeddedPort = (
	getSandbox = defaultSandbox,
	{ readyTimeoutMs = READY_TIMEOUT_MS }: { readyTimeoutMs?: number } = {},
): MemonEmbeddedPort => {
	const sessions = new Map<string, EmbeddedSession>();
	const pending = new Map<
		string,
		{
			resolve: (value: unknown) => void;
			reject: (error: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	const channel = openChannel();

	const dropFrame = (session: EmbeddedSession) => {
		session.frame?.detach();
		session.frame?.iframe.remove();
		session.frame = undefined;
	};

	if (channel) {
		channel.onmessage = (event: MessageEvent<HostMessage>) => {
			const message = event.data;
			if (message.kind === "claim") {
				const session = sessions.get(message.sessionId);
				if (!session) return;
				session.hostId = message.hostId;
				// The window's frame is the page now; the hidden one goes.
				dropFrame(session);
				return;
			}
			if (message.kind === "release") {
				const session = sessions.get(message.sessionId);
				if (session?.hostId === message.hostId) session.hostId = undefined;
				return;
			}
			if (message.kind === "response") {
				const waiter = pending.get(message.id);
				if (!waiter) return;
				pending.delete(message.id);
				clearTimeout(waiter.timer);
				if (message.ok) waiter.resolve(message.result);
				else waiter.reject(new Error(message.error));
			}
		};
	}

	const requireSession = (sessionId: string): EmbeddedSession => {
		const session = sessions.get(sessionId);
		if (!session) throw new Error("This embedded tab is closed.");
		return session;
	};

	/** Asks the window showing the tab; null when no window answers. */
	const askHost = async <T>(
		session: EmbeddedSession,
		sessionId: string,
		op: EmbeddedOp,
		args?: unknown,
	): Promise<{ value: T } | null> => {
		const hostId = session.hostId;
		if (!channel || !hostId) return null;
		const id = randomId();
		try {
			const value = await new Promise<unknown>((resolve, reject) => {
				pending.set(id, {
					resolve,
					reject,
					timer: setTimeout(() => {
						pending.delete(id);
						reject(new Error("timeout"));
					}, HOST_TIMEOUT_MS),
				});
				channel.postMessage({
					kind: "request",
					id,
					hostId,
					sessionId,
					op,
					args,
				} satisfies HostMessage);
			});
			return { value: value as T };
		} catch (error) {
			if (error instanceof Error && error.message === "timeout") {
				// The window went away without saying so; use a frame of our own.
				if (session.hostId === hostId) session.hostId = undefined;
				return null;
			}
			throw error;
		}
	};

	/** The computer's own hidden frame, loaded with the session's page. */
	const ownFrame = async (session: EmbeddedSession) => {
		if (session.frame) {
			await session.frame.ready;
			return session.frame.iframe;
		}
		if (typeof document === "undefined") {
			throw new Error("Embedded pages need a page to run in.");
		}
		const sandbox = await getSandbox();
		const iframe = document.createElement("iframe");
		iframe.style.cssText =
			"position:fixed;top:-9999px;left:-9999px;width:1280px;height:800px;opacity:0;pointer-events:none;";
		iframe.setAttribute("aria-hidden", "true");
		let markReady: () => void = () => undefined;
		const ready = new Promise<void>((resolve) => {
			markReady = resolve;
			setTimeout(resolve, readyTimeoutMs);
		});
		const detach = attachSandboxFrame(iframe, sandbox, () => markReady());
		session.frame = { iframe, detach, ready };
		const { url } = await sandbox.getServerRenderUrl(session.target);
		iframe.src = url;
		document.body.appendChild(iframe);
		await ready;
		return iframe;
	};

	const load = async (session: EmbeddedSession, target: SandboxTarget) => {
		session.target = target;
		if (!session.frame) return ownFrame(session);
		let markReady: () => void = () => undefined;
		const ready = new Promise<void>((resolve) => {
			markReady = resolve;
			setTimeout(resolve, readyTimeoutMs);
		});
		const sandbox = await getSandbox();
		session.frame.detach();
		session.frame.detach = attachSandboxFrame(
			session.frame.iframe,
			sandbox,
			() => markReady(),
		);
		session.frame.ready = ready;
		session.frame.iframe.src = (await sandbox.getServerRenderUrl(target)).url;
		await ready;
		return session.frame.iframe;
	};

	const readOutline = async (sessionId: string): Promise<WebPageOutline> => {
		const session = requireSession(sessionId);
		const hosted = await askHost<WebPageOutline>(session, sessionId, "outline");
		if (hosted) return hosted.value;
		return frameOutline(await ownFrame(session));
	};

	const targetOf = (url: string): SandboxTarget => {
		const target = sandboxTargetOf(url);
		if (!target) {
			throw new Error(
				`${url} is not a server in this computer. Embedded tabs show servers started in the Terminal, like http://localhost:3000; open other sites in a real tab.`,
			);
		}
		return target;
	};

	return {
		availability: () =>
			typeof document === "undefined"
				? { available: false, reason: "embedded pages need a page to run in" }
				: { available: true },

		async open(url) {
			const target = targetOf(url);
			const sessionId = `embedded-${randomId()}`;
			const session: EmbeddedSession = { target };
			sessions.set(sessionId, session);
			try {
				await ownFrame(session);
			} catch (error) {
				sessions.delete(sessionId);
				throw error;
			}
			return { sessionId, url: sandboxServerUrl(target), title: "" };
		},

		async navigate(sessionId, url) {
			const session = requireSession(sessionId);
			const target = targetOf(url);
			const hosted = await askHost<void>(session, sessionId, "navigate", url);
			if (hosted) session.target = target;
			else await load(session, target);
			return { url: sandboxServerUrl(target), title: "" };
		},

		outline: readOutline,

		settle: (sessionId, { timeoutMs }) =>
			settleOutline(() => readOutline(sessionId), { timeoutMs }),

		async act(sessionId, request) {
			const session = requireSession(sessionId);
			const hosted = await askHost<{
				result: WebOutlineActionResult;
				outline?: WebPageOutline;
			}>(session, sessionId, "act", request);
			if (hosted) return hosted.value;
			return frameAct(await ownFrame(session), request);
		},

		async capture(sessionId, request) {
			const session = requireSession(sessionId);
			const hosted = await askHost<MemonPageCapture>(
				session,
				sessionId,
				"capture",
				request,
			);
			if (hosted) return hosted.value;
			return frameCapture(await ownFrame(session), request);
		},

		async history(sessionId, direction) {
			const session = requireSession(sessionId);
			const hosted = await askHost<void>(
				session,
				sessionId,
				"history",
				direction,
			);
			if (hosted) return;
			const frame = await ownFrame(session);
			if (direction === "back") frame.contentWindow?.history.back();
			else frame.contentWindow?.history.forward();
		},

		// The page is the window itself; there is no other to bring forward.
		focus: async () => undefined,

		async close(sessionId) {
			const session = sessions.get(sessionId);
			if (!session) return;
			dropFrame(session);
			sessions.delete(sessionId);
		},

		reserve: () => () => undefined,

		async servers() {
			try {
				const sandbox = await getSandbox();
				const { servers } = await sandbox.listServers();
				return servers.map((server) => server.port).sort((a, b) => a - b);
			} catch {
				return [];
			}
		},

		async stopServer(port) {
			const sandbox = await getSandbox();
			await sandbox.stopServer?.({ port });
		},
	};
};
