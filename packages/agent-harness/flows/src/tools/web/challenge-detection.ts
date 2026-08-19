/**
 * Recognises pages that are a bot wall rather than the content that was asked
 * for: CAPTCHA and Cloudflare interstitials, search-engine rate limiting, login
 * and paywall gates, and HTTP-level blocks.
 *
 * These pages are dangerous precisely because they look healthy. A Cloudflare
 * interstitial has readable text, so the render-stability check settles and the
 * session reports `success`/`renderReady`/`domAccessible` — the model then reads
 * "Verify you are human" as if it were the article.
 *
 * Detection previously existed in four disconnected places, none of which
 * reached the user: the desktop direct backend threw an error that the engine
 * fallback swallowed, the search tool classified a `challenge` the UI discarded,
 * an unrelated asset-explorer tool carried the richest marker list, and the read
 * tool's app-shell regex was anchored so real interstitials never matched. This
 * module is the consolidation of all four; callers should use it instead of
 * adding a fifth regex.
 *
 * Ordering matters. Markers are checked most-specific first so a Cloudflare page
 * that also contains the word "captcha" is reported as `cloudflare`, which is
 * what tells the user which wall they are actually looking at.
 */

export type WebBlockKind =
	| "captcha"
	| "cloudflare"
	| "rate-limit"
	| "login-wall"
	| "http-block";

export interface WebBlockSignal {
	/** Which kind of wall this is, for the UI to explain and the model to report. */
	kind: WebBlockKind;
	/** The specific evidence that matched, for logs and for the details grid. */
	marker: string;
}

export interface WebBlockInput {
	html: string;
	text: string;
	url?: string;
	/** HTTP status, when the caller fetched the page itself and knows it. */
	status?: number;
}

/**
 * Only the head of the document is searched. Markers for these walls are always
 * above the fold, and scanning a full 160 kB of HTML per snapshot would cost far
 * more than it finds.
 */
const HAYSTACK_LIMIT = 20_000;

interface MarkerRule {
	kind: WebBlockKind;
	marker: string;
	/** All fragments must be present — used for phrases that are ambiguous alone. */
	all?: string[];
	/** Any one fragment is enough. */
	any?: string[];
}

const MARKER_RULES: MarkerRule[] = [
	// Cloudflare first: its interstitials also mention "captcha" and "verify you
	// are human", and naming the actual product is more useful than "captcha".
	{
		kind: "cloudflare",
		marker: "cloudflare_interstitial",
		all: ["just a moment", "cloudflare"],
	},
	{
		kind: "cloudflare",
		marker: "cloudflare_blocked",
		any: ["sorry, you have been blocked", "performing security verification"],
	},
	{
		kind: "cloudflare",
		marker: "browser_check",
		any: ["checking your browser", "enable javascript and cookies"],
	},

	// Search-engine throttling. Distinct from a CAPTCHA: the user is not being
	// asked to prove anything, the engine is refusing volume.
	{
		kind: "rate-limit",
		marker: "unusual_traffic",
		any: [
			"our systems have detected unusual traffic",
			"unusual traffic from your computer network",
		],
	},
	{
		kind: "rate-limit",
		marker: "robot_policy",
		any: ["please respect our robot policy"],
	},

	// Generic human-verification challenges.
	{
		kind: "captcha",
		marker: "captcha",
		any: ["captcha", "not a robot", "recaptcha", "hcaptcha"],
	},
	{
		kind: "captcha",
		marker: "human_verification",
		any: [
			"verify you are human",
			"verify that you are human",
			"security verification",
			"attention required",
		],
	},
	{
		kind: "captcha",
		marker: "google_consent",
		any: ["before you continue to google", "consent.google.com"],
	},

	// Gates the user can clear because their own browser profile is signed in.
	{
		kind: "login-wall",
		marker: "sign_in_required",
		any: [
			"sign in to continue",
			"log in to continue",
			"please log in to continue",
			"you must be logged in",
			"create an account to continue",
		],
	},
	{
		kind: "login-wall",
		marker: "paywall",
		any: [
			"subscribe to continue reading",
			"this article is for subscribers",
			"subscribers only",
		],
	},
];

const matches = (haystack: string, rule: MarkerRule): boolean => {
	if (rule.all) return rule.all.every((needle) => haystack.includes(needle));
	if (rule.any) return rule.any.some((needle) => haystack.includes(needle));
	return false;
};

/**
 * HTTP statuses worth surfacing. A handoff genuinely helps with these — 403 is
 * usually a bot rule the user's own session passes, and 429 clears on its own —
 * whereas 404 or 500 are not walls and must not raise the card.
 */
const BLOCKING_STATUSES = new Map<number, string>([
	[401, "http_401"],
	[403, "http_403"],
	[429, "http_429"],
]);

export function detectWebBlock(input: WebBlockInput): WebBlockSignal | null {
	const haystack = `${input.html}\n${input.text}`
		.slice(0, HAYSTACK_LIMIT)
		.toLowerCase();

	for (const rule of MARKER_RULES) {
		if (matches(haystack, rule)) {
			return { kind: rule.kind, marker: rule.marker };
		}
	}

	// Status is checked last so a challenge page served with a 403 is still
	// reported as the challenge it is, which is the more actionable label.
	if (typeof input.status === "number") {
		const marker = BLOCKING_STATUSES.get(input.status);
		if (marker) {
			return {
				kind: input.status === 401 ? "login-wall" : "http-block",
				marker,
			};
		}
	}

	return null;
}

/** Short, user-facing summary of a block. */
export function describeWebBlock(signal: WebBlockSignal): string {
	switch (signal.kind) {
		case "cloudflare":
			return "The site served a Cloudflare verification page instead of the content.";
		case "captcha":
			return "The site asked for human verification (CAPTCHA) instead of serving the content.";
		case "rate-limit":
			return "The site is rate limiting automated requests and asked for verification.";
		case "login-wall":
			return "The site requires a signed-in session to show this content.";
		case "http-block":
			return "The site refused the request at the HTTP level.";
	}
}
