import {
	describeWebBlock,
	detectWebBlock,
	type WebBlockKind,
} from "@memorall/agent-harness-flows/tools/web/challenge-detection";
import type { PageOutlineBlock } from "@/co-agent/dom/page-outline";
import type { WebPageOutline } from "@/services/web-browser/web-browser-protocol";

/**
 * Walls a person gets a page past by proving they are human. Sign-in walls are
 * left out: a page with a "Sign in to continue" corner is still the page.
 */
const VERIFICATION_KINDS = new Set<WebBlockKind>([
	"captcha",
	"cloudflare",
	"rate-limit",
]);

/** A wall is a sentence and a button; a page with more to read is the page. */
const MAX_WALL_TEXT_CHARS = 2_000;

export interface MemonVerificationWall {
	kind: WebBlockKind;
	/** What the site asked for, for the user and the agent. */
	description: string;
}

/** What the page says; never what a field holds. */
const blockText = (block: PageOutlineBlock): string => {
	switch (block.kind) {
		case "list":
			return block.items.join("\n");
		case "input":
			return [block.label, block.placeholder].filter(Boolean).join(" ");
		case "select":
		case "region":
			return block.label;
		case "image":
			return block.alt;
		default:
			return block.text;
	}
};

/**
 * The verification wall a page is (a CAPTCHA, a Cloudflare check, a rate
 * limit asking to prove the visitor is human), read from its outline so it
 * works for every tab the Browser shows.
 */
export const findVerificationWall = (
	outline: WebPageOutline,
): MemonVerificationWall | null => {
	if (outline.omittedAbove > 0 || outline.omittedBelow > 0) return null;
	const text = [outline.title, ...outline.blocks.map(blockText)].join("\n");
	if (text.length > MAX_WALL_TEXT_CHARS) return null;
	const signal = detectWebBlock({ html: "", text, url: outline.url });
	if (!signal || !VERIFICATION_KINDS.has(signal.kind)) return null;
	return { kind: signal.kind, description: describeWebBlock(signal) };
};
