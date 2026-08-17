/**
 * Naming for Composio tools.
 *
 * Composio identifies everything by an uppercase slug — the toolkit is
 * `GOOGLECALENDAR`, the tool is `GOOGLECALENDAR_FIND_FREE_SLOTS`. Rendered
 * verbatim these read as machine identifiers, and the app a call belongs to is
 * only visible if you already know the naming scheme. These helpers turn a slug
 * back into "Google Calendar · Find free slots".
 *
 * The map exists because the slugs are unpunctuated: no rule recovers
 * "Google Calendar" from "GOOGLECALENDAR". Anything absent falls back to
 * title-casing, which is right for single-word toolkits (`NOTION`, `SLACK`,
 * `LINEAR`) — the large majority.
 */

/** Composio toolkit slug → the name the vendor actually uses. */
const TOOLKIT_LABELS: Record<string, string> = {
	ACTIVE_CAMPAIGN: "ActiveCampaign",
	AIRTABLE: "Airtable",
	AMPLITUDE: "Amplitude",
	APIFY: "Apify",
	ASANA: "Asana",
	ATTIO: "Attio",
	BITBUCKET: "Bitbucket",
	BROWSERBASE_TOOL: "Browserbase",
	CAL: "Cal.com",
	CALENDLY: "Calendly",
	CANVA: "Canva",
	CLICKUP: "ClickUp",
	CODEINTERPRETER: "Code Interpreter",
	CONFLUENCE: "Confluence",
	COMPOSIO: "Composio",
	COMPOSIO_SEARCH: "Composio Search",
	DISCORD: "Discord",
	DISCORDBOT: "Discord Bot",
	DROPBOX: "Dropbox",
	ELEVENLABS: "ElevenLabs",
	EXA: "Exa",
	FIGMA: "Figma",
	FIRECRAWL: "Firecrawl",
	FRESHDESK: "Freshdesk",
	GITHUB: "GitHub",
	GITLAB: "GitLab",
	GMAIL: "Gmail",
	GOOGLEADS: "Google Ads",
	GOOGLEANALYTICS: "Google Analytics",
	GOOGLEBIGQUERY: "BigQuery",
	GOOGLECALENDAR: "Google Calendar",
	GOOGLEDOCS: "Google Docs",
	GOOGLEDRIVE: "Google Drive",
	GOOGLEMAPS: "Google Maps",
	GOOGLEMEET: "Google Meet",
	GOOGLEPHOTOS: "Google Photos",
	GOOGLESHEETS: "Google Sheets",
	GOOGLESLIDES: "Google Slides",
	GOOGLETASKS: "Google Tasks",
	HACKERNEWS: "Hacker News",
	HUBSPOT: "HubSpot",
	INTERCOM: "Intercom",
	JIRA: "Jira",
	KLAVIYO: "Klaviyo",
	LINEAR: "Linear",
	LINKEDIN: "LinkedIn",
	MAILCHIMP: "Mailchimp",
	MICROSOFT_TEAMS: "Microsoft Teams",
	MIXPANEL: "Mixpanel",
	MONDAY: "monday.com",
	MONGODB: "MongoDB",
	NASA: "NASA",
	NOTION: "Notion",
	ONEDRIVE: "OneDrive",
	OUTLOOK: "Outlook",
	PAGERDUTY: "PagerDuty",
	PERPLEXITYAI: "Perplexity",
	PIPEDRIVE: "Pipedrive",
	POSTGRES: "PostgreSQL",
	POSTHOG: "PostHog",
	REDDIT: "Reddit",
	SALESFORCE: "Salesforce",
	SENDGRID: "SendGrid",
	SENTRY: "Sentry",
	SHAREPOINT: "SharePoint",
	SHOPIFY: "Shopify",
	SLACK: "Slack",
	SLACKBOT: "Slack Bot",
	SNOWFLAKE: "Snowflake",
	SPOTIFY: "Spotify",
	STRIPE: "Stripe",
	SUPABASE: "Supabase",
	TAVILY: "Tavily",
	TELEGRAM: "Telegram",
	TRELLO: "Trello",
	TWILIO: "Twilio",
	TWITTER: "X",
	TYPEFORM: "Typeform",
	WEATHERMAP: "OpenWeatherMap",
	WEBFLOW: "Webflow",
	WHATSAPP: "WhatsApp",
	YOUTUBE: "YouTube",
	ZENDESK: "Zendesk",
	ZOHO: "Zoho",
	ZOOM: "Zoom",
};

/**
 * Router meta-tools. These are Composio's own control surface rather than any
 * one app's API, so they must not be mistaken for a toolkit named "COMPOSIO".
 */
export const COMPOSIO_ROUTER_TOOLS = new Set([
	"COMPOSIO_CHECK_ACTIVE_CONNECTION",
	"COMPOSIO_CREATE_TRIGGER",
	"COMPOSIO_EXECUTE_TOOL",
	"COMPOSIO_GET_TOOL_SCHEMAS",
	"COMPOSIO_INITIATE_CONNECTION",
	"COMPOSIO_MANAGE_CONNECTIONS",
	"COMPOSIO_MULTI_EXECUTE_TOOL",
	"COMPOSIO_REMOTE_BASH_TOOL",
	"COMPOSIO_REMOTE_WORKBENCH",
	"COMPOSIO_RETRIEVE_ACTIONS",
	"COMPOSIO_SEARCH_TOOLS",
	"COMPOSIO_WAIT_FOR_CONNECTION",
]);

/** Strips the MCP server prefix an aggregated tool arrives with. */
export const stripServerPrefix = (toolName: string): string => {
	const separator = toolName.lastIndexOf("__");
	return separator >= 0 ? toolName.slice(separator + 2) : toolName;
};

export const isComposioRouterTool = (toolName: string): boolean =>
	COMPOSIO_ROUTER_TOOLS.has(stripServerPrefix(toolName).toUpperCase());

/**
 * True for anything Composio serves: its router meta-tools, or a toolkit tool
 * reached through a Composio MCP connection.
 */
export const isComposioTool = (
	toolName: string,
	serverName?: string,
): boolean => {
	if (isComposioRouterTool(toolName)) {
		return true;
	}
	if (serverName && serverName.toLowerCase().includes("composio")) {
		return true;
	}
	return stripServerPrefix(toolName).toUpperCase().startsWith("COMPOSIO_");
};

const titleCaseWord = (word: string): string =>
	word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

/**
 * Whether a string is shaped like a Composio tool slug: SCREAMING_SNAKE with at
 * least two segments, e.g. `GOOGLECALENDAR_FIND_EVENT`.
 *
 * This gate matters because tool payloads are objects whose *other* keys are
 * ordinary lowercase field names (`results`, `session`, `next_steps_guidance`).
 * Without it those get read as tools and invent toolkits called "Results" and
 * "Session".
 */
export const looksLikeToolSlug = (value: string): boolean =>
	/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(stripServerPrefix(value));

/**
 * The toolkit a tool slug belongs to, or null for router meta-tools and
 * anything that is not `TOOLKIT_ACTION` shaped.
 *
 * Longest known prefix wins, so `GOOGLE_CALENDAR_FIND_EVENT` and
 * `GOOGLECALENDAR_FIND_EVENT` both resolve, and `MICROSOFT_TEAMS_SEND` is not
 * mistaken for a `MICROSOFT` toolkit.
 */
export const toolkitFromSlug = (slug: string): string | null => {
	const bare = stripServerPrefix(slug).toUpperCase();
	if (!bare || COMPOSIO_ROUTER_TOOLS.has(bare)) {
		return null;
	}

	let best: string | null = null;
	for (const known of Object.keys(TOOLKIT_LABELS)) {
		if (bare === known || bare.startsWith(`${known}_`)) {
			if (!best || known.length > best.length) {
				best = known;
			}
		}
	}
	if (best) {
		return best;
	}

	// Unknown toolkit: take the conventional single-token prefix, but only from
	// something actually slug-shaped. Guessing a toolkit out of a lowercase
	// field name is how "results" became an app called Results.
	if (!looksLikeToolSlug(slug)) {
		return null;
	}
	const underscore = bare.indexOf("_");
	return underscore > 0 ? bare.slice(0, underscore) : null;
};

/** "GOOGLECALENDAR" → "Google Calendar". */
export const toolkitLabel = (toolkit: string): string => {
	const key = toolkit.toUpperCase();
	return (
		TOOLKIT_LABELS[key] ??
		key
			.split(/[\s_-]+/)
			.filter(Boolean)
			.map(titleCaseWord)
			.join(" ")
	);
};

/** The Composio logo CDN keys on the lowercased slug. */
export const toolkitLogoSlug = (toolkit: string): string =>
	toolkit.toLowerCase().replace(/_/g, "");

/**
 * The action half of a tool slug, as a sentence.
 * "GOOGLECALENDAR_FIND_FREE_SLOTS" → "Find free slots".
 */
export const actionLabel = (slug: string): string => {
	const bare = stripServerPrefix(slug).toUpperCase();
	const toolkit = toolkitFromSlug(bare);
	const action =
		toolkit && bare.startsWith(`${toolkit}_`)
			? bare.slice(toolkit.length + 1)
			: bare;

	const words = action.split("_").filter(Boolean);
	if (words.length === 0) {
		return bare;
	}

	return words
		.map((word, index) =>
			index === 0 ? titleCaseWord(word) : word.toLowerCase(),
		)
		.join(" ");
};

/**
 * Title-cases an arbitrary SCREAMING_SNAKE string.
 *
 * Unlike `actionLabel` this strips no toolkit prefix, which matters for values
 * that merely look like slugs — an agent's own step name such as
 * `LISTING_CALENDARS` would otherwise lose "LISTING" to the unknown-toolkit
 * fallback and render as "Calendars".
 */
export const humanizeSlug = (value: string): string => {
	const words = value.split(/[\s_-]+/).filter(Boolean);
	if (words.length === 0) return value;
	return words
		.map((word, index) =>
			index === 0 ? titleCaseWord(word) : word.toLowerCase(),
		)
		.join(" ");
};

/** Plain-language names for the router's own control surface. */
const ROUTER_TOOL_LABELS: Record<string, string> = {
	COMPOSIO_CHECK_ACTIVE_CONNECTION: "Check connection",
	COMPOSIO_CREATE_TRIGGER: "Create trigger",
	COMPOSIO_EXECUTE_TOOL: "Run tool",
	COMPOSIO_GET_TOOL_SCHEMAS: "Read tool schemas",
	COMPOSIO_INITIATE_CONNECTION: "Connect app",
	COMPOSIO_MANAGE_CONNECTIONS: "Manage connections",
	COMPOSIO_MULTI_EXECUTE_TOOL: "Run tools",
	COMPOSIO_REMOTE_BASH_TOOL: "Remote shell",
	COMPOSIO_REMOTE_WORKBENCH: "Remote workbench",
	COMPOSIO_RETRIEVE_ACTIONS: "Find actions",
	COMPOSIO_SEARCH_TOOLS: "Find tools",
	COMPOSIO_WAIT_FOR_CONNECTION: "Wait for connection",
};

export const routerToolLabel = (slug: string): string | null => {
	const bare = stripServerPrefix(slug).toUpperCase();
	if (!COMPOSIO_ROUTER_TOOLS.has(bare)) {
		return null;
	}
	return (
		ROUTER_TOOL_LABELS[bare] ?? actionLabel(bare.replace(/^COMPOSIO_/, ""))
	);
};

/**
 * How a Composio call should be titled in the run timeline.
 *
 * `executedSlugs` are the toolkit tools a router call actually ran. A bare
 * "Composio · Run tools" says nothing about which app was touched, so when the
 * arguments name one, that becomes the title instead — which is the whole point
 * of the header.
 */
export const composioCallTitle = (
	slug: string,
	executedSlugs: string[] = [],
): string => {
	const bare = stripServerPrefix(slug).toUpperCase();
	const router = routerToolLabel(bare);

	if (router) {
		const toolkits = [
			...new Set(
				executedSlugs
					.map((executed) => toolkitFromSlug(executed))
					.filter((toolkit): toolkit is string => Boolean(toolkit)),
			),
		];

		if (executedSlugs.length === 1) {
			return composioCallTitle(executedSlugs[0]);
		}
		if (toolkits.length === 1) {
			return `${toolkitLabel(toolkits[0])} · ${router} (${executedSlugs.length})`;
		}
		if (toolkits.length > 1) {
			return `${toolkits.map(toolkitLabel).join(", ")} · ${router}`;
		}
		return `Composio · ${router}`;
	}

	const toolkit = toolkitFromSlug(bare);
	if (!toolkit) {
		return actionLabel(bare);
	}
	return `${toolkitLabel(toolkit)} · ${actionLabel(bare)}`;
};
