import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComplexContentPartTool } from "@/types/chat";
import { siteAccessWithheldMessage } from "@/services/web-browser/site-access";

const platform = vi.hoisted(() => ({
	environment: "extension" as "extension" | "web" | "desktop",
	hostAccess: {
		has: vi.fn(async (_origins: string[]) => false),
		request: vi.fn(async (_origins: string[]) => true),
		onChange: vi.fn((_listener: () => void) => () => {}),
	},
}));

// The rest of the module graph reads other platform ports on import.
vi.mock("@/platform/current", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/platform/current")>();
	return {
		platform: new Proxy(actual.platform, {
			get: (target, key) =>
				key in platform
					? platform[key as keyof typeof platform]
					: target[key as keyof typeof target],
		}),
	};
});

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

// The document filesystem mounts IndexedDB on import, which jsdom has not got.
vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: {
		readFileAsBase64: vi.fn(async () => ""),
	},
}));

// The renderer registry reaches the PDF tools, which pull pdfjs into the module
// graph; it needs a canvas jsdom does not have and nothing here calls it.
vi.mock("pdfjs-dist", () => ({
	GlobalWorkerOptions: { workerSrc: "" },
	getDocument: () => ({ promise: Promise.resolve(null) }),
	OPS: {
		paintImageXObject: 1,
		paintImageXObjectRepeat: 2,
		paintInlineImageXObject: 3,
		paintJpegXObject: 4,
	},
}));

import { AssistantToolTimelinePart } from "../AssistantToolTimelinePart";

// The MemonOS card's "Show on computer" navigates, as it does in the app.
const renderCall = (call: ComplexContentPartTool) =>
	render(
		<MemoryRouter>
			<AssistantToolTimelinePart part={call} isLast />
		</MemoryRouter>,
	);

const URL = "https://batdongsan.com.vn/ban-nha-rieng-tp-ho-chi-minh";
const WITHHELD = siteAccessWithheldMessage(URL);

const part = (
	name: string,
	description: string,
	state: ComplexContentPartTool["state"] = "error",
): ComplexContentPartTool => ({
	type: "tool",
	id: `call_${name}`,
	name,
	description,
	state,
	metadata: { durationMs: 400 },
});

/** Every shape a web tool's result takes when the page could not be read. */
const failedCalls: Array<[string, ComplexContentPartTool]> = [
	[
		"a MemonOS open that failed",
		part(
			"memon_open",
			`${WITHHELD}\n\nscreen · driver: MemonOS Bot · focus: w1`,
		),
	],
	[
		"a MemonOS action whose screen shows the Browser's error",
		part(
			"memon_screen",
			`Read the screen.\n\nscreen · driver: MemonOS Bot · focus: w1\n── w1 Browser · tab 1 of 1\nurl: ${URL}\nerror: ${WITHHELD}`,
			"complete",
		),
	],
	[
		"a web tool outside MemonOS",
		part(
			"web_open",
			JSON.stringify({
				actionType: "web_open",
				success: false,
				url: URL,
				error: WITHHELD,
			}),
		),
	],
];

describe("a web tool call stopped by withheld site access", () => {
	beforeEach(() => {
		platform.environment = "extension";
		platform.hostAccess.has.mockResolvedValue(false);
	});

	it.each(failedCalls)(
		"opens %s with the button that grants it",
		async (_label, call) => {
			renderCall(call);

			expect(await screen.findByTestId("site-access-notice")).toBeVisible();
			expect(
				screen.getByRole("button", { name: /siteAccess\.allow/ }),
			).toBeVisible();
		},
	);

	it("shows nothing once access is back", async () => {
		platform.hostAccess.has.mockResolvedValue(true);
		renderCall(failedCalls[0][1]);

		await waitFor(() => expect(platform.hostAccess.has).toHaveBeenCalled());
		expect(screen.queryByTestId("site-access-notice")).toBeNull();
	});

	it.each(["web", "desktop"] as const)(
		"leaves the %s app alone: only the extension has site access",
		async (environment) => {
			platform.environment = environment;
			platform.hostAccess.has.mockClear();
			renderCall(failedCalls[0][1]);

			expect(screen.queryByTestId("site-access-notice")).toBeNull();
			expect(screen.getByRole("button", { expanded: false })).toBeVisible();
			expect(platform.hostAccess.has).not.toHaveBeenCalled();
		},
	);
});
