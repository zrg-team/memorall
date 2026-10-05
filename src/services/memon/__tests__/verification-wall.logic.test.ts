import { describe, expect, it } from "vitest";
import type { WebPageOutline } from "@/services/web-browser/web-browser-protocol";
import { findVerificationWall } from "../verification-wall";

const page = (
	title: string,
	texts: string[],
	extra: Partial<WebPageOutline> = {},
): WebPageOutline => ({
	url: "https://shop.test/",
	title,
	docToken: "doc-1",
	blocks: texts.map((text) => ({ kind: "text" as const, text })),
	omittedAbove: 0,
	omittedBelow: 0,
	scroll: { y: 0, viewportHeight: 800, pageHeight: 800 },
	...extra,
});

describe("findVerificationWall", () => {
	it("recognises a CAPTCHA page by what it asks the reader", () => {
		expect(
			findVerificationWall(
				page("Security check", ["Please verify you are human to continue."]),
			),
		).toEqual({
			kind: "captcha",
			description:
				"The site asked for human verification (CAPTCHA) instead of serving the content.",
		});
	});

	it("names a Cloudflare check as Cloudflare", () => {
		expect(
			findVerificationWall(
				page("Just a moment...", [
					"Verifying you are human. This may take a few seconds.",
					"Performance & security by Cloudflare",
				]),
			)?.kind,
		).toBe("cloudflare");
	});

	it("recognises a search engine refusing automated traffic", () => {
		expect(
			findVerificationWall(
				page("Sorry...", [
					"Our systems have detected unusual traffic from your computer network.",
				]),
			)?.kind,
		).toBe("rate-limit");
	});

	it("reads the labels of the page's controls too", () => {
		const outline = page("Check", []);
		outline.blocks = [
			{
				kind: "button",
				ref: "b1",
				text: "I'm not a robot",
				submits: false,
			},
		];
		expect(findVerificationWall(outline)?.kind).toBe("captcha");
	});

	it("leaves a page with real content alone, whatever it mentions", () => {
		const article = page("How CAPTCHAs work", [
			"Sites ask you to verify you are human in many ways.",
			"x".repeat(2_500),
		]);
		expect(findVerificationWall(article)).toBeNull();
		expect(
			findVerificationWall(
				page("Long page", ["Please verify you are human."], {
					omittedBelow: 40,
				}),
			),
		).toBeNull();
	});

	it("does not stop on a sign-in prompt", () => {
		expect(
			findVerificationWall(page("Account", ["Sign in to continue"])),
		).toBeNull();
	});
});
