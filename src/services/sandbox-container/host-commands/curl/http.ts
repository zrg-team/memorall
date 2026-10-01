import type {
	SandboxHandleSwRequestPayload,
	SandboxHandleSwRequestResult,
} from "../../types";

/** One HTTP exchange as curl sees it. */
export interface CurlHttpRequest {
	url: URL;
	method: string;
	/** In order, as curl would send them. */
	headers: Array<[string, string]>;
	body?: Uint8Array;
	/** Let the transport follow redirects itself (only the browser needs to). */
	follow: boolean;
	timeoutMs?: number;
}

export interface CurlHttpResponse {
	status: number;
	statusText: string;
	httpVersion: "1.1" | "2";
	headers: Array<[string, string]>;
	body: Uint8Array;
	/** Where the response came from, after any redirects the transport took. */
	url: string;
	/** Redirects the transport followed on its own. */
	followed: number;
	/** Peer address for -v and %{remote_ip}, when known. */
	remoteIp?: string;
	remotePort: number;
}

/** A transfer failure with curl's exit code (6, 7, 28, …). */
export class CurlTransferError extends Error {
	constructor(
		readonly code: number,
		message: string,
		/** Extra lines for the user, after curl's own. */
		readonly note?: string,
	) {
		super(message);
	}
}

export interface CurlHttp {
	request(request: CurlHttpRequest): Promise<CurlHttpResponse>;
}

const LOCAL_HOSTS = new Set([
	"localhost",
	"127.0.0.1",
	"0.0.0.0",
	"[::1]",
	"::1",
]);

export const isLocalHost = (host: string): boolean =>
	LOCAL_HOSTS.has(host.toLowerCase());

export const defaultPort = (url: URL): number =>
	Number(url.port) || (url.protocol === "https:" ? 443 : 80);

const decodeBase64 = (base64: string): Uint8Array => {
	if (!base64) return new Uint8Array(0);
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
};

const withTimeout = async <T>(
	work: (signal: AbortSignal) => Promise<T>,
	timeoutMs: number | undefined,
	onTimeout: (elapsedMs: number) => CurlTransferError,
): Promise<T> => {
	const controller = new AbortController();
	const startedAt = Date.now();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		if (timeoutMs === undefined) return;
		timer = setTimeout(() => {
			controller.abort();
			reject(onTimeout(Date.now() - startedAt));
		}, timeoutMs);
	});
	try {
		return await Promise.race([work(controller.signal), timeout]);
	} finally {
		if (timer) clearTimeout(timer);
	}
};

const timedOut = (elapsedMs: number) =>
	new CurlTransferError(
		28,
		`Operation timed out after ${elapsedMs} milliseconds with 0 bytes received`,
	);

export interface CurlHttpDeps {
	/** Ports of the servers running in the computer. */
	servers(): Promise<number[]>;
	/** Sends one request to such a server, as the preview frames do. */
	relay(
		payload: SandboxHandleSwRequestPayload,
	): Promise<SandboxHandleSwRequestResult>;
	fetch: typeof fetch;
}

/**
 * Where curl's requests go. `localhost`, `127.0.0.1` and friends are this
 * computer: its servers answer byte for byte, every header and redirect as
 * sent. Anything else goes out through the browser, which reads only sites
 * that allow cross-origin requests and follows redirects on its own.
 */
export const createCurlHttp = (deps: CurlHttpDeps): CurlHttp => ({
	async request(request) {
		const { url } = request;
		const port = defaultPort(url);
		const startedAt = Date.now();

		if (isLocalHost(url.hostname)) {
			const servers = await deps.servers();
			if (!servers.includes(port)) {
				throw new CurlTransferError(
					7,
					`Failed to connect to ${url.hostname} port ${port} after ${Date.now() - startedAt} ms: Couldn't connect to server`,
				);
			}
			const headers: Record<string, string> = {};
			for (const [name, value] of request.headers) headers[name] = value;
			const result = await withTimeout(
				() =>
					deps.relay({
						id: Math.floor(Math.random() * 2 ** 31),
						port,
						method: request.method,
						path: `${url.pathname || "/"}${url.search}`,
						headers,
						body: request.body
							? (request.body.slice().buffer as ArrayBuffer)
							: null,
					}),
				request.timeoutMs,
				timedOut,
			);
			return {
				status: result.statusCode,
				statusText: result.statusMessage ?? "",
				httpVersion: "1.1",
				headers: Object.entries(result.headers ?? {}).map(
					([name, value]) => [name, String(value)] as [string, string],
				),
				body: decodeBase64(result.bodyBase64),
				url: url.href,
				followed: 0,
				remoteIp: "127.0.0.1",
				remotePort: port,
			};
		}

		const send = (redirect: RequestRedirect, signal: AbortSignal) =>
			deps.fetch(url.href, {
				method: request.method,
				headers: request.headers,
				body:
					request.body && request.method !== "GET" && request.method !== "HEAD"
						? (request.body.slice().buffer as ArrayBuffer)
						: undefined,
				redirect,
				// curl never sends the browser's cookies for a site.
				credentials: "omit",
				cache: "no-store",
				signal,
			});
		let response: Response;
		try {
			response = await withTimeout(
				(signal) => send(request.follow ? "follow" : "manual", signal),
				request.timeoutMs,
				timedOut,
			);
		} catch (error) {
			if (error instanceof CurlTransferError) throw error;
			throw new CurlTransferError(
				7,
				`Failed to connect to ${url.hostname} port ${port} after ${Date.now() - startedAt} ms: Couldn't connect to server`,
				`curl: (7) this computer reaches other sites through the browser, which can only read sites that allow cross-origin requests (CORS); ${url.hostname} does not, or is unreachable. Servers started in the Terminal answer at http://localhost:<port>.`,
			);
		}

		// The browser hides a redirect it was told not to follow. Find where it
		// leads, so curl without -L can still show it.
		if (response.type === "opaqueredirect") {
			let location = "";
			try {
				const followed = await withTimeout(
					(signal) => send("follow", signal),
					request.timeoutMs,
					timedOut,
				);
				location = followed.url;
				await followed.body?.cancel();
			} catch {
				location = "";
			}
			return {
				status: 302,
				statusText: "Found",
				httpVersion: "1.1",
				headers: location ? [["location", location]] : [],
				body: new Uint8Array(0),
				url: url.href,
				followed: 0,
				remotePort: port,
			};
		}

		const body = new Uint8Array(await response.arrayBuffer());
		const headers: Array<[string, string]> = [];
		for (const [name, value] of response.headers) headers.push([name, value]);
		return {
			status: response.status,
			statusText: response.statusText,
			// HTTP/2 has no reason phrase; an empty one means the browser spoke h2.
			httpVersion: response.statusText ? "1.1" : "2",
			headers,
			body,
			url: response.url || url.href,
			followed: response.redirected ? 1 : 0,
			remotePort: port,
		};
	},
});
