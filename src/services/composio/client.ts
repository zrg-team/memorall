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
	logo?: string;
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
}

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
		return asList(payload).map((entry) => ({
			slug: String(pick(entry, "slug", "key", "name") ?? ""),
			name: String(pick(entry, "name", "display_name", "displayName") ?? ""),
			logo: pick<string>(entry, "logo", "logo_url", "logoUrl"),
			categories: Array.isArray(entry.categories)
				? entry.categories.map(String)
				: undefined,
			toolCount:
				Number(pick(entry, "tools_count", "toolsCount") ?? 0) || undefined,
			noAuth: Boolean(pick(entry, "no_auth", "noAuth")),
		}));
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
	 */
	async createMcpSession(options: {
		userId: string;
		toolkits: string[];
		tools?: Record<string, { enable: string[] }>;
	}): Promise<ComposioMcpSession> {
		const payload = asRecord(
			await this.request<unknown>("/tool_router/session", {
				method: "POST",
				body: JSON.stringify({
					user_id: options.userId,
					toolkits: options.toolkits,
					...(options.tools ? { tools: options.tools } : {}),
					mcp: true,
				}),
			}),
		);

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
		};
	}
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
