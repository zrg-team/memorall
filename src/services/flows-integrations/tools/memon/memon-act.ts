import type {
	Tool,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import z from "zod";
import { MEMON_ACT_TOOL, memonDisplayPath } from "@/services/memon/constants";
import { formatDownloadSize } from "@/services/memon/download";
import type { MemonMachine } from "@/services/memon/memon-machine";
import { kitAppForRef } from "@/services/memon/apps";
import { runMemonTool } from "./memon-tool-utils";

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
				"click a ref (a button, link, file or switch), or a page point with x and y; hover a page ref or point (menus that open on hover); press a key (text: Enter, Escape, Tab, ArrowDown, Control+a) on a page ref or the focused element; type text into a field or the editor (e1); toggle a switch or checkbox (text on/off sets it); select an option of a choice (text is the option); describe an image; scroll the focused window (page, Editor or Viewer), or with a page ref the area it scrolls in; back/forward the page; select_tab/close_tab by number. Files entries: move/copy into the folder in text, or cut/copy without text to the clipboard, then paste (into the open folder, or into a folder ref). download: save the file at the address in text (or a page image ref) into Files. zip: zip a folder (a Files ref, or its path in text) into Files and hand it to the user to download.",
			),
		text: z
			.string()
			.optional()
			.describe(
				"type: the text (it replaces the field's value; in the editor e1, the whole file). press: the key. select: the option. toggle: on or off. move/copy: the folder to put the entry in. download: the file's address. zip: the folder's path.",
			),
		x: z
			.number()
			.optional()
			.describe(
				"click/hover by position, in CSS pixels: from the left of the ref (a canvas b9) or, without a ref, of the page's viewport.",
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
				"scroll: which way (default down, one screen); left/right/top/bottom on a page.",
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

const act = async (machine: MemonMachine, input: Input): Promise<string> => {
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
			// Long files page in the Editor and Viewer; anything else is the page.
			const textWindow = input.ref ? null : machine.focusedTextWindow();
			if (textWindow) {
				if (direction !== "up" && direction !== "down") {
					throw new Error(`The ${textWindow} scrolls up or down.`);
				}
				machine.scrollText(textWindow, direction);
				return `Scrolled the ${textWindow} ${direction}.`;
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
		case "back":
		case "forward":
			await machine.browserHistory(input.action);
			return `Went ${input.action}.`;
		case "select_tab":
		case "close_tab": {
			if (!input.tab) throw new Error("Give the tab number.");
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
			const result = await machine.browserAction({
				action: input.action,
				...point,
			});
			return `${input.action === "click" ? "Clicked" : "Hovered"} ${(result.ok && result.detail) || `at (${input.x}, ${input.y})`}.`;
		}
		if (input.action === "press") {
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
		case "describe": {
			const result = await machine.browserAction({
				ref: input.ref,
				action: "describe",
			});
			return `Image ${input.ref} source: ${(result.ok && result.detail) || "unknown"}.`;
		}
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
				: input.ref
					? `${input.action === "type" ? "Typing into" : "Clicking"} ${input.ref}`
					: input.x !== undefined
						? `${input.action} at (${input.x}, ${input.y})`
						: `${input.action}`,
			(machine) => {
				const app =
					input.action === "download"
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
