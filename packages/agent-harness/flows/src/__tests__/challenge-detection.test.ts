import { describe, expect, it } from "vitest";
import {
	describeWebBlock,
	detectWebBlock,
} from "../tools/web/challenge-detection";

const page = (text: string, html = "") => ({ html, text });

describe("detectWebBlock", () => {
	it("names Cloudflare rather than the generic captcha it also mentions", () => {
		// A Cloudflare interstitial contains "captcha" too. Reporting it as
		// `captcha` would tell the user less than naming the actual wall, so the
		// specific rule has to win the ordering.
		const signal = detectWebBlock(
			page(
				"Just a moment... Enable JavaScript and cookies to continue. captcha",
				"<title>Just a moment...</title><div>Cloudflare Ray ID</div>",
			),
		);
		expect(signal).toEqual({
			kind: "cloudflare",
			marker: "cloudflare_interstitial",
		});
	});

	it("recognises a Cloudflare hard block", () => {
		expect(detectWebBlock(page("Sorry, you have been blocked"))).toEqual({
			kind: "cloudflare",
			marker: "cloudflare_blocked",
		});
	});

	it("treats a search engine refusing volume as a rate limit, not a captcha", () => {
		expect(
			detectWebBlock(
				page("Our systems have detected unusual traffic from your network."),
			),
		).toEqual({ kind: "rate-limit", marker: "unusual_traffic" });
	});

	it("detects the common human-verification challenges", () => {
		expect(detectWebBlock(page("Please verify you are human"))?.kind).toBe(
			"captcha",
		);
		expect(detectWebBlock(page("I'm not a robot"))?.kind).toBe("captcha");
		expect(detectWebBlock(page("", "<div class='g-recaptcha'>"))?.kind).toBe(
			"captcha",
		);
	});

	it("detects login and paywall gates", () => {
		expect(detectWebBlock(page("Sign in to continue"))).toEqual({
			kind: "login-wall",
			marker: "sign_in_required",
		});
		expect(detectWebBlock(page("Subscribe to continue reading"))).toEqual({
			kind: "login-wall",
			marker: "paywall",
		});
	});

	it("reports blocking HTTP statuses when the body gives nothing away", () => {
		expect(detectWebBlock({ ...page("Forbidden"), status: 403 })).toEqual({
			kind: "http-block",
			marker: "http_403",
		});
		expect(detectWebBlock({ ...page(""), status: 429 })).toEqual({
			kind: "http-block",
			marker: "http_429",
		});
		expect(detectWebBlock({ ...page(""), status: 401 })).toEqual({
			kind: "login-wall",
			marker: "http_401",
		});
	});

	it("prefers the challenge over the status when a wall is served with a 403", () => {
		// "Cloudflare blocked you" is more actionable than "the server said 403".
		expect(
			detectWebBlock({
				...page("Sorry, you have been blocked", "cloudflare"),
				status: 403,
			}),
		).toEqual({ kind: "cloudflare", marker: "cloudflare_blocked" });
	});

	it("ignores statuses that are not walls", () => {
		expect(detectWebBlock({ ...page("Not Found"), status: 404 })).toBeNull();
		expect(detectWebBlock({ ...page("Server Error"), status: 500 })).toBeNull();
	});

	it("does not fire on ordinary content", () => {
		// The expensive failure mode: a false positive interrupts a working read
		// with a wall that is not there.
		expect(
			detectWebBlock(
				page(
					"Qwen 3.8 27B: Specs, Hardware Requirements, and How to Run It. The model ships with a 262144 token context window and runs on a single GPU.",
					"<article><h1>Qwen 3.8 27B</h1></article>",
				),
			),
		).toBeNull();
	});

	it("does not fire on an article that merely discusses captchas", () => {
		// Known limitation, pinned deliberately: the word appears in the body, so
		// this DOES fire. If it ever becomes a real annoyance the fix is to scope
		// the captcha markers to the head/title rather than loosen them silently.
		expect(
			detectWebBlock(page("A history of CAPTCHA and bot detection"))?.kind,
		).toBe("captcha");
	});

	it("only searches the head of the document", () => {
		const buried = `${"lorem ipsum ".repeat(3_000)}sorry, you have been blocked`;
		expect(detectWebBlock(page(buried))).toBeNull();
	});

	it("describes every kind it can return", () => {
		const kinds = [
			"captcha",
			"cloudflare",
			"rate-limit",
			"login-wall",
			"http-block",
		] as const;
		for (const kind of kinds) {
			expect(describeWebBlock({ kind, marker: "x" })).toMatch(/\S/);
		}
	});
});
