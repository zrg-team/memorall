import { describe, expect, it } from "vitest";
import { OKF_INDEXER_ACTOR } from "../constants";
import { appendLogEntries, renderIndexFile } from "../okf/bundle-files";
import {
	buildFileConcept,
	fileResource,
	isCardCurrent,
	resourcePath,
} from "../okf/concept";
import { summarizeText } from "../okf/content-summary";
import {
	isStale,
	parseOkfDocument,
	serializeOkfDocument,
	trustTier,
} from "../okf/frontmatter";
import type { IndexedFileInfo } from "../types";

const file: IndexedFileInfo = {
	path: "/Work/Invoices 2026/acme.pdf",
	name: "acme.pdf",
	documentType: "pdf",
	mimeType: "application/pdf",
	size: 182_000,
	modifiedAt: "2026-10-02T09:00:00.000Z",
};
const now = new Date("2026-10-11T12:00:00.000Z");

describe("OKF documents", () => {
	it("round-trips frontmatter and keeps unknown keys", () => {
		const text =
			"---\ntype: Metric\nowner: finance\n---\n\n# Definition\nRevenue.\n";
		const parsed = parseOkfDocument(text);
		expect(parsed.frontmatter).toEqual({ type: "Metric", owner: "finance" });
		expect(parseOkfDocument(serializeOkfDocument(parsed))).toEqual(parsed);
	});

	it("reads a document without frontmatter as all body", () => {
		expect(parseOkfDocument("# Just notes\n")).toEqual({
			frontmatter: {},
			body: "# Just notes\n",
		});
	});

	it("derives trust tiers and staleness as the spec says", () => {
		expect(trustTier({})).toBe("unverified");
		expect(
			trustTier({
				verified: { by: "process:nightly", at: "2026-01-01T00:00:00Z" },
			}),
		).toBe("machine-confirmed");
		expect(
			trustTier({ verified: [{ by: "process:x" }, { by: "human:me" }] }),
		).toBe("human-reviewed");
		expect(isStale({ stale_after: "2026-01-01T00:00:00Z" }, now)).toBe(true);
		expect(isStale({ stale_after: "2027-01-01T00:00:00Z" }, now)).toBe(false);
	});
});

describe("file cards", () => {
	it("describes a file with type, resource, provenance and trust fields", () => {
		const card = buildFileConcept(
			file,
			{
				description: "Acme Cloud hosting, September 2026.",
				excerpt: "Total €1,240.00",
				facts: ["Pages: 2"],
			},
			null,
			now,
		);
		expect(card.frontmatter).toMatchObject({
			type: "PDF Document",
			title: "acme.pdf",
			description: "Acme Cloud hosting, September 2026.",
			resource: fileResource(file.path),
			generated: { by: OKF_INDEXER_ACTOR, at: now.toISOString() },
			sources: [{ id: "file", last_modified: file.modifiedAt }],
			file_size: 182_000,
		});
		expect(card.body).toContain("- Pages: 2");
		expect(card.body).toContain("# Excerpt");
		expect(resourcePath(fileResource(file.path))).toBe(file.path);
	});

	it("is current until the file's size or time changes", () => {
		const card = buildFileConcept(file, {}, null, now);
		expect(isCardCurrent(card, file)).toBe(true);
		expect(isCardCurrent(card, { ...file, size: 1 })).toBe(false);
		expect(
			isCardCurrent(card, { ...file, modifiedAt: "2026-10-03T00:00:00.000Z" }),
		).toBe(false);
	});

	it("keeps what a person wrote, and sections they added, when the file changes", () => {
		const curated = buildFileConcept(file, { description: "old" }, null, now);
		curated.frontmatter.type = "invoice";
		curated.frontmatter.description = "Acme Cloud, Sep 2026, unpaid";
		curated.frontmatter.verified = { by: "human:me", at: now.toISOString() };
		curated.frontmatter.vendor = "/Contracts/acme.md";
		curated.body += "\n\n# Notes\nPaid by card.";
		const rebuilt = buildFileConcept(
			{ ...file, size: 190_000 },
			{ description: "new text" },
			curated,
			now,
		);
		expect(rebuilt.frontmatter).toMatchObject({
			type: "invoice",
			description: "Acme Cloud, Sep 2026, unpaid",
			vendor: "/Contracts/acme.md",
			file_size: 190_000,
		});
		expect(rebuilt.body).toContain("# Notes\nPaid by card.");
		expect(rebuilt.body.match(/# File/g)).toHaveLength(1);
	});

	it("summarises markdown, preferring the file's own OKF fields", () => {
		const own = summarizeText(
			"---\ntype: Playbook\ndescription: Steps for alerts.\n---\n# Alerts\nBody",
			true,
		);
		expect(own).toMatchObject({
			type: "Playbook",
			description: "Steps for alerts.",
			title: "Alerts",
		});
		const plain = summarizeText(
			"# Trip\n\nWe fly to Hanoi on the 3rd. Then a train.",
			true,
		);
		expect(plain).toMatchObject({
			title: "Trip",
			description: "We fly to Hanoi on the 3rd.",
		});
	});
});

describe("index and log files", () => {
	it("writes okf_version only at the bundle root", () => {
		const root = renderIndexFile({
			title: "Work",
			isBundleRoot: true,
			folders: [],
			files: [
				{
					href: "a b.md",
					title: "a b",
					label: "Note",
					description: "One line.",
				},
			],
		});
		expect(root.startsWith('---\nokf_version: "0.2"\n---')).toBe(true);
		expect(root).toContain("* [a b](a%20b.md) - Note: One line.");
		const child = renderIndexFile({
			title: "Sub",
			isBundleRoot: false,
			folders: [{ href: "x/", title: "x" }],
			files: [],
		});
		expect(child.startsWith("# Sub")).toBe(true);
		expect(child).toContain("# Folders");
	});

	it("groups log entries by day, newest first", () => {
		const first = appendLogEntries("", new Date("2026-10-10T08:00:00Z"), [
			{ kind: "Initialization", text: "Indexed 3 files." },
		]);
		const second = appendLogEntries(first, new Date("2026-10-11T08:00:00Z"), [
			{ kind: "Update", text: "Refreshed a." },
		]);
		const third = appendLogEntries(second, new Date("2026-10-11T09:00:00Z"), [
			{ kind: "Creation", text: "Added b." },
		]);
		expect(third).toBe(
			"# Index Update Log\n\n## 2026-10-11\n* **Creation**: Added b.\n* **Update**: Refreshed a.\n\n## 2026-10-10\n* **Initialization**: Indexed 3 files.\n",
		);
	});
});
