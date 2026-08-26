/**
 * Composio REST client — management surface only.
 *
 * Verified against docs.composio.dev (Aug 2026):
 *   base    https://backend.composio.dev/api/v3
 *   auth    x-api-key: <project key>
 *   apps    GET  /toolkits
 *   auth    GET/POST /auth_configs   (underscore; the docs' prose writes it hyphenated)
 *   connect POST /connected_accounts/link -> { connected_account_id, redirect_url }
 *   poll    GET  /connected_accounts/{id} -> { status: ACTIVE | ... }
 *   mcp     POST /tool_router/session { mcp: true } -> { session_id, mcp: { url, headers } }
 *
 * The hosted MCP *server* API (/mcp/*) is deprecated in favour of tool-router
 * sessions, so nothing here touches it.
 *
 * Responses are read defensively — the docs are inconsistent about snake vs
 * camel case and about v3 vs v3.1 on a few routes — so every accessor tolerates
 * both spellings rather than throwing on a field name.
 */

import { logError } from "@/utils/logger";

export const COMPOSIO_BASE_URL = "https://backend.composio.dev/api/v3";

export class ComposioError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "ComposioError";
	}
}

export interface ComposioToolkit {
	slug: string;
	name: string;
	/** Square brand mark, `image/svg+xml` from Composio's logo CDN. */
	logo?: string;
	description?: string;
	categories?: string[];
	toolCount?: number;
	noAuth?: boolean;
}

export interface ComposioConnectedAccount {
	id: string;
	toolkitSlug?: string;
	status: string;
	label?: string;
}

export interface ComposioConnectionRequest {
	id: string;
	redirectUrl?: string;
	status: string;
}

export interface ComposioMcpSession {
	sessionId: string;
	url: string;
	headers: Record<string, string>;
	/**
	 * Tool slugs the session actually serves directly, read back from the config
	 * Composio echoes.
	 *
	 * Asked-for and got are not the same thing here, and the difference is
	 * invisible from the URL alone — so the caller is told rather than left to
	 * assume. Empty means a plain router session: six meta-tools, every real
	 * tool behind them.
	 */
	preloadedTools: string[];
}

/**
 * What the session says it preloaded, from the config it echoes back.
 *
 * Composio accepts and then ignores fields it does not know, so a request is no
 * evidence of a result; the echo is.
 */
const readPreloadedTools = (payload: Record<string, unknown>): string[] => {
	const config = asRecord(pick(payload, "config") ?? {});
	const preload = asRecord(pick(config, "preload") ?? {});
	const tools = pick<unknown>(preload, "tools");
	return Array.isArray(tools)
		? tools.filter((slug): slug is string => typeof slug === "string")
		: [];
};

const pick = <T>(
	source: Record<string, unknown>,
	...keys: string[]
): T | undefined => {
	for (const key of keys) {
		const value = source[key];
		if (value !== undefined && value !== null) return value as T;
	}
	return undefined;
};

const asRecord = (value: unknown): Record<string, unknown> =>
	typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: {};

/** Both `{items:[…]}` and `{data:{items:[…]}}` shapes appear in the docs. */
const asList = (payload: unknown): Record<string, unknown>[] => {
	const root = asRecord(payload);
	const candidates = [
		root.items,
		root.data,
		asRecord(root.data).items,
		root.results,
		payload,
	];
	for (const candidate of candidates) {
		if (Array.isArray(candidate)) return candidate.map(asRecord);
	}
	return [];
};

export class ComposioClient {
	constructor(
		private readonly apiKey: string,
		private readonly baseUrl: string = COMPOSIO_BASE_URL,
	) {}

	private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
		const response = await fetch(`${this.baseUrl}${path}`, {
			...init,
			headers: {
				"x-api-key": this.apiKey,
				"content-type": "application/json",
				...(init.headers ?? {}),
			},
		});

		if (!response.ok) {
			const body = await response.text().catch(() => "");
			// Name the status and the route: a bare "Not Found" from a mistyped path
			// is indistinguishable from a genuinely missing record. Composio's 4xx
			// bodies also carry the remedy — which endpoint to use instead — well
			// past the first 300 characters, so keep enough of it to read.
			const detail = body.slice(0, 900) || response.statusText;
			throw new ComposioError(
				response.status,
				`${response.status} on ${path.split("?")[0]} — ${detail}`,
			);
		}

		return (await response.json()) as T;
	}

	/** Cheapest call that proves the key is real and the project is reachable. */
	async verifyKey(): Promise<boolean> {
		try {
			await this.request("/toolkits?limit=1");
			return true;
		} catch (error) {
			if (error instanceof ComposioError && error.status === 401) {
				return false;
			}
			throw error;
		}
	}

	async listToolkits(search?: string): Promise<ComposioToolkit[]> {
		const query = new URLSearchParams({ limit: "100" });
		if (search?.trim()) query.set("search", search.trim());

		const payload = await this.request<unknown>(`/toolkits?${query}`);
		return asList(payload).map((entry) => {
			// Everything descriptive lives under `meta` — logo, tools_count,
			// description, categories. Reading only the root, as this did, left
			// every toolkit with no logo and no tool count, which is why the
			// catalog rendered as initials in grey squares. The root spellings
			// stay as a fallback for the older response shape.
			const meta = asRecord(entry.meta);
			const categories = pick<unknown>(meta, "categories") ?? entry.categories;
			return {
				slug: String(pick(entry, "slug", "key", "name") ?? ""),
				name: String(pick(entry, "name", "display_name", "displayName") ?? ""),
				logo:
					pick<string>(meta, "logo", "logo_url", "logoUrl") ??
					pick<string>(entry, "logo", "logo_url", "logoUrl"),
				description: pick<string>(meta, "description") ?? undefined,
				// Categories arrive as `{ id, name }` objects on v3 and as bare
				// strings on the older shape.
				categories: Array.isArray(categories)
					? categories.map((category) =>
							typeof category === "string"
								? category
								: String(pick(asRecord(category), "name", "id") ?? ""),
						)
					: undefined,
				toolCount:
					Number(
						pick(meta, "tools_count", "toolsCount") ??
							pick(entry, "tools_count", "toolsCount") ??
							0,
					) || undefined,
				noAuth: Boolean(pick(entry, "no_auth", "noAuth")),
			};
		});
	}

	async listConnectedAccounts(
		userId: string,
	): Promise<ComposioConnectedAccount[]> {
		const query = new URLSearchParams({ user_id: userId, limit: "100" });
		const payload = await this.request<unknown>(`/connected_accounts?${query}`);
		return asList(payload).map((entry) => ({
			id: String(pick(entry, "id", "nanoid") ?? ""),
			// The toolkit arrives nested as `toolkit: { slug }`; the flat spellings
			// are older shapes. Missing it means an already-connected app looks
			// unconnected when the catalog is reopened.
			toolkitSlug:
				pick<string>(asRecord(entry.toolkit), "slug", "name") ??
				pick<string>(entry, "toolkit_slug", "toolkitSlug", "appName"),
			status: String(pick(entry, "status") ?? "UNKNOWN"),
			label: pick<string>(entry, "alias", "label"),
		}));
	}

	/**
	 * Reuse an existing auth config for the toolkit, creating one only when the
	 * project has none. Composio treats these as reusable blueprints, so making a
	 * fresh one per connection would litter the user's dashboard.
	 */
	async ensureAuthConfig(toolkitSlug: string): Promise<string> {
		const query = new URLSearchParams({
			toolkit_slug: toolkitSlug,
			limit: "1",
		});
		const existing = asList(
			await this.request<unknown>(`/auth_configs?${query}`),
		);
		const found = existing[0] && pick<string>(existing[0], "id", "nanoid");
		if (found) return found;

		const created = asRecord(
			await this.request<unknown>("/auth_configs", {
				method: "POST",
				body: JSON.stringify({
					toolkit: { slug: toolkitSlug },
					auth_config: { type: "use_composio_managed_auth" },
				}),
			}),
		);
		const id =
			pick<string>(created, "id", "nanoid") ??
			pick<string>(asRecord(created.auth_config), "id", "nanoid");

		if (!id) {
			throw new ComposioError(0, "Composio did not return an auth config id.");
		}
		return id;
	}

	/**
	 * Start an OAuth connection.
	 *
	 * Must be `/connected_accounts/link`, not `/connected_accounts`: the plain
	 * endpoint now rejects Composio-managed OAuth auth configs outright
	 * ("no longer supported. Use POST /api/v3/connected_accounts/link instead").
	 * Its body is flat — `auth_config_id` / `user_id`, not the nested
	 * `auth_config.id` / `connection.user_id` the other endpoint takes — and the
	 * account id comes back as `connected_account_id`.
	 */
	async initiateConnection(options: {
		authConfigId: string;
		userId: string;
		callbackUrl?: string;
	}): Promise<ComposioConnectionRequest> {
		const payload = asRecord(
			await this.request<unknown>("/connected_accounts/link", {
				method: "POST",
				body: JSON.stringify({
					auth_config_id: options.authConfigId,
					user_id: options.userId,
					...(options.callbackUrl ? { callback_url: options.callbackUrl } : {}),
				}),
			}),
		);

		return {
			id: String(
				pick(
					payload,
					"connected_account_id",
					"connectedAccountId",
					"id",
					"nanoid",
				) ?? "",
			),
			redirectUrl: pick<string>(
				payload,
				"redirect_url",
				"redirectUrl",
				"redirect_uri",
				"redirectUri",
			),
			status: String(pick(payload, "status") ?? "INITIALIZING"),
		};
	}

	async getConnectedAccount(id: string): Promise<ComposioConnectedAccount> {
		const payload = asRecord(
			await this.request<unknown>(`/connected_accounts/${id}`),
		);
		return {
			id: String(pick(payload, "id", "nanoid") ?? id),
			toolkitSlug: pick<string>(payload, "toolkit_slug", "toolkitSlug"),
			status: String(pick(payload, "status") ?? "UNKNOWN"),
		};
	}

	/**
	 * Mint the MCP endpoint. Toolkit and tool scoping are session parameters, so
	 * narrowing the agent's toolbox happens here rather than as a later mutation.
	 *
	 * The docs type `toolkits` as `any` and their example shows `null`, so the
	 * accepted shape is not knowable from them — and a wrong one comes back as a
	 * flat "Error in payload.toolkits: Invalid input". Rather than pin one guess,
	 * try the plausible encodings in order and keep the first the API accepts.
	 * Only validation rejections advance the ladder; auth or server errors throw
	 * immediately so a real problem is not retried four times.
	 *
	 * `preload` is what makes the named tools reachable as themselves rather than
	 * through `COMPOSIO_MULTI_EXECUTE_TOOL`, whose `arguments` object is typed as
	 * an open object with no properties — a shape `{}` satisfies, which is how a
	 * model ends up calling GitHub with nothing in it. Preloaded, the same tool
	 * arrives with `owner` and `repo` as required typed parameters and an empty
	 * call stops being expressible. Verified against the live API: the meta-tools
	 * stay either way, and `preload.tools` must be an array of slugs — the SDK's
	 * `session_preset` is accepted and then ignored by this endpoint, and
	 * `{tools: "all"}` is rejected outright.
	 */
	async createMcpSession(options: {
		userId: string;
		toolkits: string[];
		tools?: Record<string, { enable: string[] }>;
		/** Tool slugs to serve directly, beside the router meta-tools. */
		preloadTools?: string[];
	}): Promise<ComposioMcpSession> {
		const slugs = options.toolkits;
		const toolkitShapes: unknown[] = [
			{ enable: slugs },
			slugs,
			slugs.map((slug) => ({ toolkit: slug })),
			{ enable: slugs.map((slug) => slug.toUpperCase()) },
		];

		const preload = options.preloadTools?.length
			? { preload: { tools: options.preloadTools } }
			: {};

		let payload: Record<string, unknown> | null = null;
		let lastError: ComposioError | null = null;

		for (const toolkits of toolkitShapes) {
			try {
				payload = asRecord(
					await this.request<unknown>("/tool_router/session", {
						method: "POST",
						body: JSON.stringify({
							user_id: options.userId,
							toolkits,
							...(options.tools ? { tools: options.tools } : {}),
							...preload,
							// No `mcp` flag exists on this endpoint; the session always
							// returns its MCP details in the response.
						}),
					}),
				);
				break;
			} catch (error) {
				if (!(error instanceof ComposioError)) throw error;
				const isValidationError =
					(error.status === 400 || error.status === 422) &&
					/toolkit|preload/i.test(error.message);
				if (!isValidationError) throw error;
				lastError = error;
			}
		}

		if (!payload) {
			throw (
				lastError ??
				new ComposioError(0, "Composio rejected every session payload shape.")
			);
		}

		const mcp = asRecord(pick(payload, "mcp") ?? {});
		const url = pick<string>(mcp, "url", "endpoint");
		const sessionId = String(
			pick(payload, "session_id", "sessionId", "id") ?? "",
		);

		if (!url) {
			throw new ComposioError(
				0,
				"Composio returned a session without an MCP URL.",
			);
		}

		return {
			sessionId,
			url,
			headers: (pick<Record<string, string>>(mcp, "headers") ?? {}) as Record<
				string,
				string
			>,
			preloadedTools: readPreloadedTools(payload),
		};
	}
}

/**
 * Turn a Composio failure into something a user can act on.
 *
 * The one that matters most: minting a tool-router session needs `sessions`
 * write access, and a scoped project key answers 403 with a message about
 * permissions. Left raw, that reads as "something went wrong" and the app looks
 * broken rather than under-permissioned.
 */
export function describeComposioError(error: unknown): string {
	const detail = error instanceof Error ? error.message : String(error);
	if (error instanceof ComposioError && error.status === 403) {
		return `This Composio API key is not allowed to create tool sessions. Give it "sessions" write access in the Composio dashboard, or use a full-access project key. (${detail.slice(0, 160)})`;
	}
	if (error instanceof ComposioError && error.status === 401) {
		return "Composio rejected this API key. Check it in the Composio dashboard.";
	}
	// Nothing came back at all. In the extension this is almost always the
	// browser refusing the request before it left: Composio sends no
	// `Access-Control-Allow-Origin` for extension origins, so a withheld host
	// permission turns every call into this one opaque TypeError.
	if (error instanceof TypeError && /fetch/i.test(detail)) {
		return "The browser blocked the request to Composio. Allow Memorall to access backend.composio.dev — reopen this step and accept the permission prompt, or turn site access back on from the extension's menu.";
	}
	return detail;
}

/**
 * Poll a pending connection until it goes ACTIVE. Composio's own SDK exposes
 * `waitForConnection`; this is the REST equivalent with an abort signal so the
 * UI can cancel when the user gives up on the consent tab.
 */
export async function waitForConnection(
	client: ComposioClient,
	connectedAccountId: string,
	options: {
		signal?: AbortSignal;
		intervalMs?: number;
		timeoutMs?: number;
	} = {},
): Promise<ComposioConnectedAccount> {
	const interval = options.intervalMs ?? 2000;
	const deadline = Date.now() + (options.timeoutMs ?? 5 * 60_000);

	while (Date.now() < deadline) {
		if (options.signal?.aborted) {
			throw new DOMException("Connection wait aborted", "AbortError");
		}

		try {
			const account = await client.getConnectedAccount(connectedAccountId);
			if (account.status === "ACTIVE") return account;
			if (account.status === "FAILED" || account.status === "EXPIRED") {
				throw new ComposioError(
					0,
					`Authorization ${account.status.toLowerCase()}.`,
				);
			}
		} catch (error) {
			if (error instanceof ComposioError && error.status !== 404) throw error;
			// A 404 right after initiating is normal; keep waiting.
			logError("[COMPOSIO] Poll attempt failed:", error);
		}

		await new Promise((resolve) => setTimeout(resolve, interval));
	}

	throw new ComposioError(0, "Timed out waiting for authorization.");
}
