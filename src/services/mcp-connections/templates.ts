/**
 * Ready-made local MCP servers.
 *
 * Every package is pinned. The user approves the exact command line, and an
 * unpinned `npx -y pkg` would run whatever was published after that approval.
 * Names, descriptions, field labels and key guides live in the `connections`
 * locale under `template.catalog.<id>`, `template.fields.<id>.<key>` and
 * `template.guides.<id>.<key>`.
 *
 * Values become argv entries or environment variables; nothing is passed through
 * a shell, so a field value cannot inject a second command. Secrets only ever
 * travel as environment variables: an argument would show in the approval, the
 * process list and the log.
 */

import type { StdioConnectionDetail } from "./types";

export type LocalServerRuntime = "node" | "python" | "docker";

export type LocalServerCategory =
	| "local"
	| "web"
	| "work"
	| "developer"
	| "utilities";

export const LOCAL_SERVER_CATEGORIES: readonly LocalServerCategory[] = [
	"local",
	"web",
	"work",
	"developer",
	"utilities",
];

export type TemplateFieldType =
	| "directory"
	| "directories"
	| "text"
	| "secret"
	/** On or off; the value is "true" or "false". */
	| "toggle";

export type TemplateFieldTarget =
	/** Appended to the arguments (one entry per line for `directories`). */
	| { kind: "args" }
	/** Passed as `flag value`. */
	| { kind: "flag"; flag: string }
	/** Set as an environment variable. */
	| { kind: "env"; name: string }
	/** A toggle: `on` when enabled, `off` (if any) when not. */
	| { kind: "switch"; on: string; off?: string };

/**
 * How to get a key, shown in a popover next to the field. The steps are
 * `template.guides.<templateId>.<fieldKey>.step1` … `stepN`.
 */
export interface KeyGuide {
	/** The page where the key is created. */
	url: string;
	steps: number;
}

export interface LocalServerTemplateField {
	key: string;
	type: TemplateFieldType;
	required: boolean;
	target: TemplateFieldTarget;
	placeholder?: string;
	defaultValue?: string;
	guide?: KeyGuide;
}

export interface LocalServerTemplate {
	id: string;
	category: LocalServerCategory;
	runtime: LocalServerRuntime;
	/** npm package, PyPI package, or container image. */
	packageName: string;
	/** Exact version, or the image tag. */
	version: string;
	/** Fixed arguments after the package, before any field's. */
	baseArgs?: string[];
	/** Fixed, non-secret environment (e.g. switching off a server's telemetry). */
	baseEnv?: Record<string, string>;
	/**
	 * Python only: exact extra requirements for `uvx --with`, for a package that
	 * does not cap a dependency which later broke it.
	 */
	pythonWith?: string[];
	fields: LocalServerTemplateField[];
	docsUrl: string;
	/** Downloads something large (a browser, an image) on first run. */
	heavy?: boolean;
}

const REFERENCE_SERVERS =
	"https://github.com/modelcontextprotocol/servers/tree/main/src";

const secret = (
	key: string,
	envName: string,
	guide: KeyGuide,
	required = true,
): LocalServerTemplateField => ({
	key,
	type: "secret",
	required,
	target: { kind: "env", name: envName },
	guide,
});

export const LOCAL_SERVER_TEMPLATES: readonly LocalServerTemplate[] = [
	// On this computer
	{
		id: "filesystem",
		category: "local",
		runtime: "node",
		packageName: "@modelcontextprotocol/server-filesystem",
		version: "2026.8.31",
		fields: [
			{
				key: "directories",
				type: "directories",
				required: true,
				target: { kind: "args" },
			},
		],
		docsUrl: `${REFERENCE_SERVERS}/filesystem`,
	},
	{
		id: "git",
		category: "local",
		runtime: "python",
		packageName: "mcp-server-git",
		version: "2026.8.18",
		fields: [
			{
				key: "repository",
				type: "directory",
				required: true,
				target: { kind: "flag", flag: "--repository" },
			},
		],
		docsUrl: `${REFERENCE_SERVERS}/git`,
	},
	{
		id: "memory",
		category: "local",
		runtime: "node",
		packageName: "@modelcontextprotocol/server-memory",
		version: "2026.8.31",
		fields: [
			{
				key: "memoryFile",
				type: "text",
				required: false,
				target: { kind: "env", name: "MEMORY_FILE_PATH" },
			},
		],
		docsUrl: `${REFERENCE_SERVERS}/memory`,
	},
	{
		id: "postgres",
		category: "local",
		runtime: "python",
		packageName: "postgres-mcp",
		version: "0.3.0",
		// It imports mcp.server.fastmcp, which mcp 2.x removed, and does not cap it.
		pythonWith: ["mcp==1.30.0"],
		fields: [
			secret("databaseUrl", "DATABASE_URI", {
				url: "https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNSTRING-URIS",
				steps: 3,
			}),
			{
				key: "readOnly",
				type: "toggle",
				required: false,
				defaultValue: "true",
				target: {
					kind: "switch",
					on: "--access-mode=restricted",
					off: "--access-mode=unrestricted",
				},
			},
		],
		docsUrl: "https://github.com/crystaldba/postgres-mcp",
	},

	// Web and research
	{
		id: "fetch",
		category: "web",
		runtime: "python",
		packageName: "mcp-server-fetch",
		version: "2026.8.18",
		fields: [],
		docsUrl: `${REFERENCE_SERVERS}/fetch`,
	},
	{
		id: "duckduckgo",
		category: "web",
		runtime: "python",
		packageName: "duckduckgo-mcp-server",
		version: "0.7.0",
		fields: [],
		docsUrl: "https://github.com/nickclyde/duckduckgo-mcp-server",
	},
	{
		id: "brave-search",
		category: "web",
		runtime: "node",
		packageName: "@brave/brave-search-mcp-server",
		version: "2.1.3",
		fields: [
			secret("apiKey", "BRAVE_API_KEY", {
				url: "https://api-dashboard.search.brave.com/app/keys",
				steps: 3,
			}),
		],
		docsUrl: "https://github.com/brave/brave-search-mcp-server",
	},
	{
		id: "tavily",
		category: "web",
		runtime: "node",
		packageName: "tavily-mcp",
		version: "0.2.22",
		fields: [
			secret("apiKey", "TAVILY_API_KEY", {
				url: "https://app.tavily.com/home",
				steps: 2,
			}),
		],
		docsUrl: "https://github.com/tavily-ai/tavily-mcp",
	},
	{
		id: "exa",
		category: "web",
		runtime: "node",
		packageName: "exa-mcp-server",
		version: "3.4.1",
		fields: [
			secret(
				"apiKey",
				"EXA_API_KEY",
				{ url: "https://dashboard.exa.ai/api-keys", steps: 2 },
				false,
			),
		],
		docsUrl: "https://github.com/exa-labs/exa-mcp-server",
	},
	{
		id: "firecrawl",
		category: "web",
		runtime: "node",
		packageName: "firecrawl-mcp",
		version: "3.24.0",
		fields: [
			secret("apiKey", "FIRECRAWL_API_KEY", {
				url: "https://www.firecrawl.dev/app/api-keys",
				steps: 2,
			}),
		],
		docsUrl: "https://github.com/firecrawl/firecrawl-mcp-server",
	},
	{
		id: "context7",
		category: "web",
		runtime: "node",
		packageName: "@upstash/context7-mcp",
		version: "4.1.0",
		fields: [
			secret(
				"apiKey",
				"CONTEXT7_API_KEY",
				{ url: "https://context7.com/dashboard", steps: 2 },
				false,
			),
		],
		docsUrl: "https://github.com/upstash/context7",
	},
	{
		id: "playwright",
		category: "web",
		runtime: "node",
		packageName: "@playwright/mcp",
		version: "0.0.80",
		fields: [],
		docsUrl: "https://github.com/microsoft/playwright-mcp",
		heavy: true,
	},

	// Work apps
	{
		id: "notion",
		category: "work",
		runtime: "node",
		packageName: "@notionhq/notion-mcp-server",
		version: "2.5.1",
		fields: [
			secret("token", "NOTION_TOKEN", {
				url: "https://www.notion.so/profile/integrations",
				steps: 3,
			}),
		],
		docsUrl: "https://github.com/makenotion/notion-mcp-server",
	},
	{
		id: "airtable",
		category: "work",
		runtime: "node",
		packageName: "airtable-mcp-server",
		version: "1.14.0",
		fields: [
			secret("token", "AIRTABLE_API_KEY", {
				url: "https://airtable.com/create/tokens/new",
				steps: 3,
			}),
		],
		docsUrl: "https://github.com/domdomegg/airtable-mcp-server",
	},
	{
		id: "jira",
		category: "work",
		runtime: "python",
		packageName: "mcp-atlassian",
		version: "0.23.1",
		fields: [
			{
				key: "siteUrl",
				type: "text",
				required: true,
				target: { kind: "env", name: "JIRA_URL" },
				placeholder: "https://your-team.atlassian.net",
			},
			{
				key: "email",
				type: "text",
				required: true,
				target: { kind: "env", name: "JIRA_USERNAME" },
				placeholder: "you@company.com",
			},
			secret("apiToken", "JIRA_API_TOKEN", {
				url: "https://id.atlassian.com/manage-profile/security/api-tokens",
				steps: 3,
			}),
		],
		docsUrl: "https://github.com/sooperset/mcp-atlassian",
	},
	{
		id: "figma",
		category: "work",
		runtime: "node",
		packageName: "figma-developer-mcp",
		version: "0.13.2",
		baseArgs: ["--stdio"],
		// Its usage telemetry is on unless told otherwise.
		baseEnv: { FRAMELINK_TELEMETRY: "off" },
		fields: [
			secret("token", "FIGMA_API_KEY", {
				url: "https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens",
				steps: 3,
			}),
		],
		docsUrl: "https://github.com/GLips/Figma-Context-MCP",
	},

	// Developer services
	{
		id: "github",
		category: "developer",
		runtime: "docker",
		packageName: "ghcr.io/github/github-mcp-server",
		version: "v1.12.1",
		fields: [
			secret("token", "GITHUB_PERSONAL_ACCESS_TOKEN", {
				url: "https://github.com/settings/personal-access-tokens/new",
				steps: 3,
			}),
		],
		docsUrl: "https://github.com/github/github-mcp-server",
		heavy: true,
	},
	{
		id: "sentry",
		category: "developer",
		runtime: "node",
		packageName: "@sentry/mcp-server",
		version: "0.39.0",
		fields: [
			secret("token", "SENTRY_ACCESS_TOKEN", {
				url: "https://sentry.io/settings/account/api/auth-tokens/",
				steps: 3,
			}),
			{
				key: "host",
				type: "text",
				required: false,
				target: { kind: "env", name: "SENTRY_HOST" },
				placeholder: "sentry.example.com",
			},
		],
		docsUrl: "https://github.com/getsentry/sentry-mcp",
	},
	{
		id: "supabase",
		category: "developer",
		runtime: "node",
		packageName: "@supabase/mcp-server-supabase",
		version: "0.12.0",
		fields: [
			secret("token", "SUPABASE_ACCESS_TOKEN", {
				url: "https://supabase.com/dashboard/account/tokens",
				steps: 2,
			}),
			{
				key: "projectRef",
				type: "text",
				required: false,
				target: { kind: "flag", flag: "--project-ref" },
			},
			{
				key: "readOnly",
				type: "toggle",
				required: false,
				defaultValue: "true",
				target: { kind: "switch", on: "--read-only" },
			},
		],
		docsUrl: "https://github.com/supabase-community/supabase-mcp",
	},

	// Utilities
	{
		id: "time",
		category: "utilities",
		runtime: "python",
		packageName: "mcp-server-time",
		version: "2026.8.18",
		fields: [
			{
				key: "timezone",
				type: "text",
				required: false,
				target: { kind: "flag", flag: "--local-timezone" },
				placeholder: "Asia/Ho_Chi_Minh",
			},
		],
		docsUrl: `${REFERENCE_SERVERS}/time`,
	},
	{
		id: "sequential-thinking",
		category: "utilities",
		runtime: "node",
		packageName: "@modelcontextprotocol/server-sequential-thinking",
		version: "2026.8.31",
		fields: [],
		docsUrl: `${REFERENCE_SERVERS}/sequentialthinking`,
	},
];

export const findLocalServerTemplate = (
	id: string | undefined,
): LocalServerTemplate | undefined =>
	LOCAL_SERVER_TEMPLATES.find((template) => template.id === id);

/** The launcher each runtime needs on PATH. */
export const RUNTIME_COMMAND: Record<
	LocalServerRuntime,
	"npx" | "uvx" | "docker"
> = {
	node: "npx",
	python: "uvx",
	docker: "docker",
};

/** Whether the template asks for a key, and whether it can run without one. */
export const templateKeyRequirement = (
	template: LocalServerTemplate,
): "required" | "optional" | "none" => {
	const secrets = template.fields.filter((field) => field.type === "secret");
	if (secrets.length === 0) return "none";
	return secrets.some((field) => field.required) ? "required" : "optional";
};

/** Starting values for a template's fields. */
export const templateDefaults = (
	template: LocalServerTemplate,
): Record<string, string> =>
	Object.fromEntries(
		template.fields
			.filter((field) => field.defaultValue !== undefined)
			.map((field) => [field.key, field.defaultValue as string]),
	);

const splitLines = (value: string): string[] =>
	value
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);

export interface TemplateBuildOptions {
	/**
	 * Secret environment variables already stored for this connection. A secret
	 * field left blank while editing keeps its stored value, so it still counts
	 * as filled in.
	 */
	storedSecretEnvKeys?: readonly string[];
}

const valueOf = (
	field: LocalServerTemplateField,
	values: Record<string, string>,
): string => (values[field.key] ?? field.defaultValue ?? "").trim();

const hasStoredSecret = (
	field: LocalServerTemplateField,
	options: TemplateBuildOptions,
): boolean =>
	field.type === "secret" &&
	field.target.kind === "env" &&
	(options.storedSecretEnvKeys ?? []).includes(field.target.name);

/** Keys of required fields that have no value. */
export function missingTemplateFields(
	template: LocalServerTemplate,
	values: Record<string, string>,
	options: TemplateBuildOptions = {},
): string[] {
	return template.fields
		.filter(
			(field) =>
				field.required &&
				!valueOf(field, values) &&
				!hasStoredSecret(field, options),
		)
		.map((field) => field.key);
}

export interface TemplateStdio {
	detail: StdioConnectionDetail;
	/** Values for `detail.secretEnvKeys` that were typed in, to store encrypted. */
	secretValues: Record<string, string>;
}

export function buildTemplateStdio(
	template: LocalServerTemplate,
	values: Record<string, string>,
	options: TemplateBuildOptions = {},
): TemplateStdio {
	const missing = missingTemplateFields(template, values, options);
	if (missing.length > 0) {
		throw new Error(`Missing required fields: ${missing.join(", ")}`);
	}

	const fieldArgs: string[] = [];
	const env: Record<string, string> = { ...(template.baseEnv ?? {}) };
	const secretEnvKeys: string[] = [];
	const secretValues: Record<string, string> = {};
	const templateValues: Record<string, string> = {};

	for (const field of template.fields) {
		const raw = valueOf(field, values);
		const { target } = field;

		if (field.type === "secret" && target.kind === "env") {
			if (raw) {
				secretEnvKeys.push(target.name);
				secretValues[target.name] = raw;
			} else if (hasStoredSecret(field, options)) {
				secretEnvKeys.push(target.name);
			}
			continue;
		}
		if (target.kind === "switch") {
			const enabled = raw === "true";
			templateValues[field.key] = enabled ? "true" : "false";
			const flag = enabled ? target.on : target.off;
			if (flag) fieldArgs.push(flag);
			continue;
		}
		if (!raw) continue;
		templateValues[field.key] = raw;
		if (target.kind === "env") {
			env[target.name] = raw;
			continue;
		}
		const entries = field.type === "directories" ? splitLines(raw) : [raw];
		if (target.kind === "flag") {
			for (const entry of entries) fieldArgs.push(target.flag, entry);
		} else {
			fieldArgs.push(...entries);
		}
	}

	const baseArgs = template.baseArgs ?? [];
	let args: string[];
	if (template.runtime === "docker") {
		// `-e NAME` with no value: docker copies the variable from its own
		// environment, so the value never appears on the command line.
		const passEnv = [...Object.keys(env), ...secretEnvKeys].flatMap((name) => [
			"-e",
			name,
		]);
		args = [
			"run",
			"-i",
			"--rm",
			...passEnv,
			`${template.packageName}:${template.version}`,
			...baseArgs,
			...fieldArgs,
		];
	} else if (template.runtime === "node") {
		args = [
			"-y",
			`${template.packageName}@${template.version}`,
			...baseArgs,
			...fieldArgs,
		];
	} else {
		args = [
			...(template.pythonWith ?? []).flatMap((requirement) => [
				"--with",
				requirement,
			]),
			`${template.packageName}==${template.version}`,
			...baseArgs,
			...fieldArgs,
		];
	}

	return {
		detail: {
			command: RUNTIME_COMMAND[template.runtime],
			args,
			...(Object.keys(env).length > 0 ? { env } : {}),
			...(secretEnvKeys.length > 0 ? { secretEnvKeys } : {}),
			templateId: template.id,
			templateValues,
		},
		secretValues,
	};
}
