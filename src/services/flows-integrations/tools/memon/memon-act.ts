import type {
	Tool,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import z from "zod";
import { MEMON_ACT_TOOL, memonDisplayPath } from "@/services/memon/constants";
import { formatDownloadSize } from "@/services/memon/download";
import type { MemonMachine } from "@/services/memon/memon-machine";
import type { MemonPageCapture } from "@/services/memon/page-capture";
import { kitAppForRef } from "@/services/memon/apps";
import { memonWindowLabel } from "@/services/memon/screen-serializer";
import { memonFileKind } from "@/services/memon/file-kinds";
import { type MemonToolOutput, runMemonTool } from "./memon-tool-utils";

const schema = z
	.object({
		ref: z
			.string()
			.optional()
			.describe(
				'A ref from the latest screen: "b12" (browser), "f3" (files), "e1"/"e2" (editor), or a control of an app window such as "s5" (Studio), "n2" (Tasks), "k3" (Skills), "c1" (Connections), "h4" (Scheduler).',
			),
		action: z
			.enum([
				"click",
				"hover",
				"press",
				"type",
				"toggle",
				"select",
				"describe",
				"focus",
				"scroll",
				"back",
				"forward",
				"select_tab",
				"close_tab",
				"move",
				"copy",
				"cut",
				"paste",
				"download",
				"zip",
			])
			.describe(
				"click a ref (a button, link, file or switch), or a page point with x and y; hover a page ref or point (menus that open on hover); press a key (text: Enter, Escape, Tab, ArrowDown, Control+a) on a page ref or the focused element; type text into a field or the editor (e1); toggle a switch or checkbox (text on/off sets it); select an option of a choice (text is the option); describe to see a picture: a page ref (a canvas, an image or any part of the page; an image also gives its address), an image in Files (f3), or with no ref the image the Viewer shows, else the page as it shows; scroll the focused window (the page, a file in the Editor or Viewer, or a long list: Files, Tasks, Skills, the Terminal's output, pi's conversation), or with a page ref the area it scrolls in; back/forward the page; select_tab/close_tab by number. Files entries: move/copy into the folder in text, or cut/copy without text to the clipboard, then paste (into the open folder, or into a folder ref). download: save the file at the address in text (or a page image ref) into Files. zip: zip a folder (a Files ref, or its path in text) into Files and hand it to the user to download.",
			),
		text: z
			.string()
			.optional()
			.describe(
				"type: the text (it replaces the field's value; in the editor e1, the whole file). press: the key. select: the option. toggle: on or off. move/copy: the folder to put the entry in. download: the file's address. zip: the folder's path.",
			),
		path: z
			.string()
			.trim()
			.min(1)
			.optional()
			.describe(
				'describe: the exact image file path from search results, such as "/agents/Bot/assets/hero.webp" or "~/assets/hero.webp". No Files ref or open Viewer is needed. A folder opens in Files so you can choose an image.',
			),
		x: z
			.number()
			.optional()
			.describe(
				"click/hover by position on the Browser's page only, in CSS pixels: from the left of the ref (a canvas b9) or, without a ref, of the page's viewport. Other windows (Files, Tasks, the Editor…) take refs, never x/y.",
			),
		y: z
			.number()
			.optional()
			.describe("click/hover by position: from the top, like x."),
		to: z
			.string()
			.optional()
			.describe(
				"download/zip: a folder (the file keeps its name) or a file path; ~/Downloads by default.",
			),
		submit: z
			.boolean()
			.optional()
			.describe("type: press Enter after typing (submit a search box)."),
		direction: z
			.enum(["up", "down", "left", "right", "top", "bottom"])
			.optional()
			.describe(
				"scroll: which way (default down, one screen); top/bottom jump to an end; left/right on a page.",
			),
		tab: z
			.number()
			.int()
			.min(1)
			.optional()
			.describe("select_tab/close_tab: the tab number from the screen."),
	})
	.describe("Act on the computer screen.");

type Input = z.infer<typeof schema>;

const refApp = (
	ref: string | undefined,
): "browser" | "files" | "editor" | null => {
	if (!ref) return null;
	if (/^b\d+$/.test(ref)) return "browser";
	if (/^f\d+$/.test(ref)) return "files";
	if (/^e\d+$/.test(ref)) return "editor";
	return null;
};

/**
 * describe on an image in Files (a Files ref, or the image the Viewer shows):
 * the picture itself. A model that cannot take images is pointed at Studio's
 * captions instead; the file is in Files already.
 */
const describeFile = async (
	machine: MemonMachine,
	path: string,
): Promise<string | MemonToolOutput> => {
	const shown = memonDisplayPath(path, machine.home);
	if (await machine.isFolder(path)) {
		await machine.openFolder(path);
		return `Opened folder ${shown} in Files. This is a folder, not an image. Choose an image from the listing and use memon_act { action: "describe", path: "<exact image file path>" }. For images found by embedding_search, use the returned source path directly; text grep cannot inspect image content.`;
	}
	if (memonFileKind(path) !== "image") {
		return `${shown} is not an image file. Use memon_open to read this file, or describe an image using the exact path returned by embedding_search.`;
	}
	if (!(await machine.modelAcceptsImages())) {
		return `The chat's model cannot look at images. If Studio has an Image tools model, memon_studio { action: "run", tool: "image_tools", path: "${shown}" } can caption it.`;
	}
	const picture = await machine.pictureOfFile(path);
	return {
		summary: `The picture of ${shown} (${picture.width}×${picture.height}) is attached: look at it.`,
		image: picture.dataUrl,
	};
};

/**
 * describe: a picture to look at. Of a page ref (a canvas, an image, any part
 * of the page), of an image in Files (a Files ref), or with no ref, of the
 * image the Viewer shows, else of the page as it shows. A model that takes
 * images looks at it; otherwise a page picture is saved to Files. An image
 * whose picture cannot be taken still gives its address.
 */
const describe = async (
	machine: MemonMachine,
	ref: string | undefined,
	path?: string,
): Promise<string | MemonToolOutput> => {
	if (path) return describeFile(machine, machine.resolvePath(path));
	const app = refApp(ref);
	if (app === "files" && ref) {
		return describeFile(machine, machine.fileRefPath(ref));
	}
	if (ref && app !== "browser") {
		throw new Error(
			"describe takes a page ref (b9), an image in Files (f3), an exact image path in path, or no ref: the image the Viewer shows, else the page.",
		);
	}
	const viewed = ref ? null : machine.viewerImage();
	if (viewed) return describeFile(machine, viewed);
	const what = ref ?? "the page";
	let picture: MemonPageCapture;
	try {
		picture = await machine.captureRef(ref);
	} catch (error) {
		if (!ref) throw error;
		const result = await machine
			.browserAction({ ref, action: "describe" })
			.catch(() => undefined);
		const source = result?.ok ? result.detail : "";
		if (!source) throw error;
		const reason = error instanceof Error ? error.message : String(error);
		return `No picture of ${ref} (${reason}). Image ${ref} source: ${source}.`;
	}
	const size = `${picture.width}×${picture.height}`;
	const source = picture.source ? ` Image source: ${picture.source}.` : "";
	if (await machine.modelAcceptsImages()) {
		return {
			summary: `The picture of ${what} (${size}) is attached: look at it.${source}`,
			image: picture.dataUrl,
		};
	}
	const saved = await machine.savePicture(
		picture.dataUrl,
		`${ref ?? "page"}-picture`,
	);
	return `Saved a picture of ${what} (${size}) to ${memonDisplayPath(saved, machine.home)}. The chat's model cannot look at images; if Studio has an Image tools model, memon_studio can caption it.${source}`;
};

/**
 * A point or a bare key acts on the Browser's page. Without one, say what
 * acts on the window in front instead, so the next call is the right one.
 */
const requirePage = (machine: MemonMachine, what: string): void => {
	const { browser, windows, focusedWindowId } = machine.snapshot();
	if (browser.activeTabId) return;
	const focused = windows.find((window) => window.id === focusedWindowId);
	const front =
		focused && focused.app !== "browser"
			? ` ${memonWindowLabel(focused.app)} is in front: act on it by a ref from the screen (like f3 in Files, n2 in Tasks, e1 in the Editor).`
			: " Act on another window by a ref from the screen (like f3 in Files).";
	throw new Error(
		`${what} acts on a Browser page, and no page is open.${front} To use a website, memon_open { url } first.`,
	);
};

const act = async (
	machine: MemonMachine,
	input: Input,
): Promise<string | MemonToolOutput> => {
	// Controls of the app windows (Studio, Tasks, Skills, …) share one path.
	if (input.ref && kitAppForRef(input.ref)) {
		if (
			input.action !== "click" &&
			input.action !== "type" &&
			input.action !== "toggle" &&
			input.action !== "select"
		) {
			throw new Error(`${input.ref} takes click, type, toggle or select.`);
		}
		const summary = await machine.actOnControl(
			input.ref,
			input.action,
			input.text,
		);
		return summary || `Updated ${input.ref}.`;
	}
	const app = refApp(input.ref);
	const point =
		input.x !== undefined || input.y !== undefined
			? { x: input.x, y: input.y }
			: {};
	switch (input.action) {
		case "scroll": {
			const direction = input.direction ?? "down";
			const toward =
				direction === "top" || direction === "bottom"
					? `to the ${direction}`
					: direction;
			// Long files page in the Editor and Viewer, lists in their own
			// window (Files, Tasks, the Terminal, …); the Browser is the page.
			if (!input.ref) {
				const textWindow = machine.focusedTextWindow();
				if (textWindow) {
					if (direction === "left" || direction === "right") {
						throw new Error(
							`The ${textWindow} scrolls up, down, top or bottom.`,
						);
					}
					machine.scrollText(textWindow, direction);
					return `Scrolled the ${textWindow} ${toward}.`;
				}
				if (direction !== "left" && direction !== "right") {
					const scrolled = machine.scrollWindow(direction);
					if (scrolled) {
						const label = memonWindowLabel(scrolled.app);
						return scrolled.moved
							? `Scrolled ${label} ${toward}.`
							: `${label} cannot scroll ${direction} any further.`;
					}
				}
			}
			if (input.ref && app !== "browser") {
				throw new Error(
					"scroll takes a page ref (b5) to scroll the area it is in.",
				);
			}
			const result = await machine.browserAction({
				action: "scrollScreen",
				value: direction,
				ref: input.ref,
			});
			return (result.ok && result.detail) || `Scrolled ${direction}.`;
		}
		case "describe":
			return describe(machine, input.ref, input.path ?? input.text);
		case "back":
		case "forward":
			await machine.browserHistory(input.action);
			return `Went ${input.action}.`;
		case "select_tab":
		case "close_tab": {
			if (!input.tab) {
				const { tabs } = machine.snapshot().browser;
				throw new Error(
					tabs.length
						? `${input.action} needs \`tab\`, its number: ${tabs.map((tab, index) => `${index + 1}. ${tab.title || tab.url}`).join("; ")}.`
						: `${input.action} needs \`tab\`, but no page is open. Use memon_open with a url.`,
				);
			}
			if (input.action === "select_tab") await machine.selectTab(input.tab);
			else await machine.closeTab(input.tab);
			return `${input.action === "select_tab" ? "Switched to" : "Closed"} tab ${input.tab}.`;
		}
		case "download": {
			let url = input.text?.trim() ?? "";
			if (input.ref) {
				if (app !== "browser") {
					throw new Error(
						"download takes an image ref from the page (b7) or the address in text.",
					);
				}
				const result = await machine.browserAction({
					ref: input.ref,
					action: "describe",
				});
				url = (result.ok && result.detail) || "";
			}
			if (!url) {
				throw new Error(
					'Give the address in text, or an image ref: { action: "download", text: "https://…/logo.png", to: "~/site/assets/" }.',
				);
			}
			const saved = await machine.downloadFile(url, input.to);
			return `Saved ${memonDisplayPath(saved.path, machine.home)} (${formatDownloadSize(saved.size)}${saved.type ? `, ${saved.type}` : ""}).`;
		}
		case "zip": {
			if (input.ref && app !== "files") {
				throw new Error(
					"zip takes a folder ref from Files (f3) or a path in text.",
				);
			}
			const folder = input.ref
				? machine.fileRefPath(input.ref)
				: input.text?.trim();
			if (!folder) {
				throw new Error(
					'Give the folder: a Files ref or its path, like { action: "zip", text: "~/site" }.',
				);
			}
			const zipped = await machine.exportFolderZip(folder, input.to);
			return `Zipped ${zipped.fileCount} files into ${memonDisplayPath(zipped.path, machine.home)} (${formatDownloadSize(zipped.size)}) and handed it to the user to download.`;
		}
		case "paste": {
			const to = input.ref ? machine.fileRefPath(input.ref) : undefined;
			const { mode, placed } = await machine.pasteFiles(to);
			return `${mode === "cut" ? "Moved" : "Copied"} to ${placed.join(", ")}.`;
		}
		default:
			break;
	}
	// The page by position, or the focused element by keyboard: no ref.
	if (!input.ref) {
		if (
			(input.action === "click" || input.action === "hover") &&
			input.x !== undefined &&
			input.y !== undefined
		) {
			requirePage(machine, `${input.action} by x, y`);
			const result = await machine.browserAction({
				action: input.action,
				...point,
			});
			return `${input.action === "click" ? "Clicked" : "Hovered"} ${(result.ok && result.detail) || `at (${input.x}, ${input.y})`}.`;
		}
		if (input.action === "press") {
			requirePage(machine, "press without a ref");
			const result = await machine.browserAction({
				action: "press",
				value: input.text,
			});
			return `${`Pressed ${input.text} ${(result.ok && result.detail) || ""}`.trim()}.`;
		}
	}
	if (!input.ref || !app) {
		throw new Error(
			`${input.action} needs a ref from the screen, like b12, f3 or e1.`,
		);
	}
	if (app === "files") {
		if (input.action === "click") {
			await machine.openFileRef(input.ref);
			return `Opened ${input.ref}.`;
		}
		const path = machine.fileRefPath(input.ref);
		const to = input.text?.trim();
		if ((input.action === "copy" || input.action === "move") && to) {
			const placed =
				input.action === "move"
					? await machine.moveFiles([path], to)
					: await machine.copyFiles([path], to);
			return `${input.action === "move" ? "Moved" : "Copied"} ${path} to ${placed.join(", ")}.`;
		}
		if (input.action === "copy" || input.action === "cut") {
			machine.setFileClipboard(input.action, [path]);
			return `${input.action === "cut" ? "Cut" : "Copied"} ${path}; paste it into a folder.`;
		}
		if (input.action === "move") {
			throw new Error("Give the folder to move it to in text.");
		}
		throw new Error(
			"Files entries take click, move, copy or cut (then paste).",
		);
	}
	if (app === "editor") {
		if (input.ref === "e1" && input.action === "type") {
			machine.setEditorContent(input.text ?? "");
			return "Replaced the editor text (not saved yet — click e2 to save).";
		}
		if (input.ref === "e2" && input.action === "click") {
			await machine.saveEditor();
			return "Saved the file.";
		}
		throw new Error(
			'Use { ref: "e1", action: "type" } to write and { ref: "e2", action: "click" } to save.',
		);
	}
	switch (input.action) {
		case "click":
		case "hover": {
			await machine.browserAction({
				ref: input.ref,
				action: input.action,
				...point,
			});
			const at = input.x !== undefined ? ` at (${input.x}, ${input.y})` : "";
			return `${input.action === "click" ? "Clicked" : "Hovered"} ${input.ref}${at}.`;
		}
		case "press": {
			await machine.browserAction({
				ref: input.ref,
				action: "press",
				value: input.text,
			});
			return `Pressed ${input.text} on ${input.ref}.`;
		}
		case "select":
			if (input.text === undefined) throw new Error("Give the option in text.");
			await machine.browserAction({
				ref: input.ref,
				action: "input",
				value: input.text,
			});
			return `Selected "${input.text}" in ${input.ref}.`;
		case "toggle": {
			const result = await machine.browserAction({
				ref: input.ref,
				action: "toggle",
				value: input.text,
			});
			return `${input.ref} ${(result.ok && result.detail) || "toggled"}.`;
		}
		case "type":
			await machine.browserAction({
				ref: input.ref,
				action: input.submit ? "submit" : "input",
				value: input.text ?? "",
			});
			return `Typed into ${input.ref}${input.submit ? " and pressed Enter" : ""}.`;
		case "focus":
			await machine.browserAction({ ref: input.ref, action: "focus" });
			return `Focused ${input.ref}.`;
		default:
			throw new Error(`Unsupported action ${input.action}.`);
	}
};

export const createMemonActTool: ToolFactory<Input> = (): Tool<Input> => ({
	name: MEMON_ACT_TOOL,
	description:
		"Act on the computer: click, hover or type on a ref from the latest screen (or click a page point by x, y), press keys, scroll, go back/forward, switch tabs, or write and save in the Editor. Returns the new screen.",
	schema,
	execute: (input, context) =>
		runMemonTool(
			MEMON_ACT_TOOL,
			context,
			input.action === "download"
				? "Downloading a file"
				: input.action === "describe" && (input.path || input.text)
					? `Looking at ${input.path ?? input.text}`
					: input.action === "describe" && !input.ref
						? "Looking at the screen"
						: input.ref
							? `${input.action === "type" ? "Typing into" : input.action === "describe" ? "Looking at" : "Clicking"} ${input.ref}`
							: input.x !== undefined
								? `${input.action} at (${input.x}, ${input.y})`
								: `${input.action}`,
			(machine) => {
				const app =
					input.action === "download" ||
					(input.action === "describe" && (input.path || input.text))
						? "files"
						: ((input.ref && kitAppForRef(input.ref)?.[0]) ??
							refApp(input.ref) ??
							"browser");
				return { windowId: machine.findWindow(app)?.id, ref: input.ref };
			},
			(machine) => act(machine, input),
		),
});

toolRegistry.register(MEMON_ACT_TOOL, createMemonActTool);

declare global {
	interface ToolTypeRegistry {
		[MEMON_ACT_TOOL]: { input: Input; services: void };
	}
}
