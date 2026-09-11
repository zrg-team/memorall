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
 * The opposite mistake is worse, because it interrupts work that was going
 * fine. Two rules keep it in check:
 *
 * - **Wording is looked for in the text, markup in the html.** Searching one
 *   haystack for both let a script URL decide what the page was: any site
 *   embedding Google sign-in pulls in `recaptcha/api.js`, and a news article
 *   carrying that widget was reported as a CAPTCHA wall.
 * - **A page with real content is not a wall.** A challenge page is a sentence
 *   and a button; an article has paragraphs. Markup-level markers are ignored
 *   once the page has substantial readable text.
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
 * Only the head of each document is searched. Markers for these walls are always
 * above the fold, and scanning a full 160 kB per snapshot would cost far more
 * than it finds. Text and html are capped separately — concatenating them let a
 * large `<head>` spend the whole budget before the readable text was reached.
 */
const HAYSTACK_LIMIT = 20_000;

/**
 * Readable text above which the page is treated as having real content.
 *
 * A challenge page is a sentence and a button. Anything with paragraphs is the
 * thing that was asked for, whatever third-party widgets its markup loads.
 */
const REAL_CONTENT_CHARS = 500;

type MarkerScope = "text" | "html" | "either";

interface MarkerRule {
	kind: WebBlockKind;
	marker: string;
	/** Where the evidence has to appear. */
	scope: MarkerScope;
	/** All fragments must be present — used for phrases that are ambiguous alone. */
	all?: string[];
	/** Any one fragment is enough. */
	any?: string[];
	/**
	 * Evidence too weak to overrule the page having content. Set on markup-level
	 * markers, which say a widget is present, not that it is the page.
	 */
	onlyWhenEmpty?: boolean;
}

const MARKER_RULES: MarkerRule[] = [
	// Cloudflare first: its interstitials also mention "captcha" and "verify you
	// are human", and naming the actual product is more useful than "captcha".
	{
		kind: "cloudflare",
		marker: "cloudflare_interstitial",
		scope: "either",
		all: ["just a moment", "cloudflare"],
	},
	{
		kind: "cloudflare",
		marker: "cloudflare_blocked",
		scope: "either",
		any: ["sorry, you have been blocked", "performing security verification"],
	},
	{
		// "Attention Required!" is Cloudflare's title and nothing else's; on its own
		// it is an ordinary heading, so it has to be paired.
		kind: "cloudflare",
		marker: "cloudflare_attention_required",
		scope: "either",
		all: ["attention required", "cloudflare"],
	},
	{
		// The challenge runtime itself. Still gated: a site may embed Turnstile on a
		// form that works.
		kind: "cloudflare",
		marker: "cloudflare_challenge_platform",
		scope: "html",
		any: [
			"cdn-cgi/challenge-platform",
			"cf-browser-verification",
			"cf_chl_opt",
		],
		onlyWhenEmpty: true,
	},
	{
		kind: "cloudflare",
		marker: "browser_check",
		scope: "text",
		any: ["checking your browser", "enable javascript and cookies"],
	},

	// Search-engine throttling. Distinct from a CAPTCHA: the user is not being
	// asked to prove anything, the engine is refusing volume.
	{
		kind: "rate-limit",
		marker: "unusual_traffic",
		scope: "text",
		any: [
			"our systems have detected unusual traffic",
			"unusual traffic from your computer network",
		],
	},
	{
		kind: "rate-limit",
		marker: "robot_policy",
		scope: "text",
		any: ["please respect our robot policy"],
	},

	// Human-verification challenges, recognised by what the page says to the
	// reader. Deliberately not the bare word "captcha": it appears in script URLs,
	// in class names, and in any article about bot detection.
	{
		kind: "captcha",
		marker: "human_verification",
		scope: "text",
		any: [
			"verify you are human",
			"verify that you are human",
			"i'm not a robot",
			"i am not a robot",
			"complete the security check",
			"press and hold to confirm",
			"please complete the captcha",
			"solve the captcha",
		],
	},
	{
		// A challenge widget in the markup. Decisive only on a page with nothing
		// else on it — otherwise it is a sign-in box on a working page, which is
		// what made a news site read as a CAPTCHA wall.
		kind: "captcha",
		marker: "captcha_widget",
		scope: "html",
		any: [
			"g-recaptcha",
			"h-captcha",
			"cf-turnstile",
			"recaptcha/api.js",
			"hcaptcha.com/1/api.js",
		],
		onlyWhenEmpty: true,
	},
	{
		kind: "captcha",
		marker: "google_consent",
		scope: "either",
		any: ["before you continue to google", "consent.google.com"],
	},

	// Gates the user can clear because their own browser profile is signed in.
	// Not gated on the page being empty: a paywalled article still shows a teaser.
	{
		kind: "login-wall",
		marker: "sign_in_required",
		scope: "text",
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
		scope: "text",
		any: [
			"subscribe to continue reading",
			"this article is for subscribers",
			"subscribers only",
		],
	},
];

const matchesIn = (haystack: string, rule: MarkerRule): boolean => {
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
	const textHay = (input.text ?? "").slice(0, HAYSTACK_LIMIT).toLowerCase();
	const htmlHay = (input.html ?? "").slice(0, HAYSTACK_LIMIT).toLowerCase();
	const eitherHay = `${htmlHay}\n${textHay}`;
	const hasRealContent = (input.text ?? "").trim().length >= REAL_CONTENT_CHARS;

	for (const rule of MARKER_RULES) {
		if (rule.onlyWhenEmpty && hasRealContent) continue;
		const haystack =
			rule.scope === "text"
				? textHay
				: rule.scope === "html"
					? htmlHay
					: eitherHay;
		if (matchesIn(haystack, rule)) {
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
