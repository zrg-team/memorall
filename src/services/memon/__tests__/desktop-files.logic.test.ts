import { describe, expect, it } from "vitest";
import {
	changeDesktopEntries,
	desktopFileForPrompt,
	listDesktopEntries,
	MEMON_MEMORY_TEMPLATE,
} from "../desktop-files";

const memory = `# Memory.md

My own note: keep this paragraph.

- Prefers answers in Vietnamese
- Works on Memorall, a browser extension
  that runs agents locally
`;

describe("desktop file entries", () => {
	it("lists entries, joining indented lines into their entry", () => {
		expect(listDesktopEntries(memory)).toEqual([
			"Prefers answers in Vietnamese",
			"Works on Memorall, a browser extension that runs agents locally",
		]);
	});

	it("adds the first entry under the template's text", () => {
		const next = changeDesktopEntries(MEMON_MEMORY_TEMPLATE, {
			action: "add",
			text: "Researches agent quality",
		});
		expect(next).toBe(`${MEMON_MEMORY_TEMPLATE}\n- Researches agent quality\n`);
		expect(listDesktopEntries(next)).toEqual(["Researches agent quality"]);
	});

	it("updates and removes one entry, keeping everything else", () => {
		const updated = changeDesktopEntries(memory, {
			action: "update",
			entry: 2,
			text: "Works on Memorall",
		});
		expect(updated).toContain("My own note: keep this paragraph.");
		expect(listDesktopEntries(updated)).toEqual([
			"Prefers answers in Vietnamese",
			"Works on Memorall",
		]);

		const removed = changeDesktopEntries(updated, {
			action: "remove",
			entry: 1,
		});
		expect(listDesktopEntries(removed)).toEqual(["Works on Memorall"]);
		expect(removed).toContain("# Memory.md");
	});

	it("refuses missing entries, empty text and secrets", () => {
		expect(() =>
			changeDesktopEntries(memory, { action: "remove", entry: 5 }),
		).toThrow(
			"There is no entry 5; the file has 2, numbered as now:\n[1] Prefers answers in Vietnamese\n[2] Works on Memorall",
		);
		expect(() =>
			changeDesktopEntries(MEMON_MEMORY_TEMPLATE, {
				action: "update",
				entry: 2,
				text: "Likes short answers",
			}),
		).toThrow(
			'There is no entry 2: the file has no entries yet. Save the fact as a new one with { action: "add", text }.',
		);
		expect(() =>
			changeDesktopEntries(memory, { action: "add", text: "  " }),
		).toThrow("An entry needs some text.");
		expect(() =>
			changeDesktopEntries(memory, {
				action: "add",
				text: "OpenAI key sk-abcdefghijklmnopqrstuv",
			}),
		).toThrow("must not hold secrets");
		expect(() =>
			changeDesktopEntries(memory, {
				action: "add",
				text: "password: hunter2",
			}),
		).toThrow("must not hold secrets");
	});

	it("takes a numbered list as entries, and keeps its numbers", () => {
		const numbered = "# Memory.md\n\n1. Likes tea\n2. Lives in Hanoi\n";
		expect(listDesktopEntries(numbered)).toEqual([
			"Likes tea",
			"Lives in Hanoi",
		]);
		expect(desktopFileForPrompt(numbered, MEMON_MEMORY_TEMPLATE)).toContain(
			"[2] Lives in Hanoi",
		);

		const updated = changeDesktopEntries(numbered, {
			action: "update",
			entry: 2,
			text: "Lives in Da Nang",
		});
		expect(updated).toBe("# Memory.md\n\n1. Likes tea\n2. Lives in Da Nang\n");
		expect(
			changeDesktopEntries(updated, {
				action: "add",
				text: "Runs on weekends",
			}),
		).toBe(
			"# Memory.md\n\n1. Likes tea\n2. Lives in Da Nang\n3. Runs on weekends\n",
		);
	});

	it("numbers entries for the prompt and skips the bare template", () => {
		expect(
			desktopFileForPrompt(MEMON_MEMORY_TEMPLATE, MEMON_MEMORY_TEMPLATE),
		).toBeNull();
		const prompt = desktopFileForPrompt(memory, MEMON_MEMORY_TEMPLATE);
		expect(prompt).toContain("[1] Prefers answers in Vietnamese");
		expect(prompt).toContain("[2] Works on Memorall, a browser extension");
		expect(prompt).toContain("My own note: keep this paragraph.");
	});
});
