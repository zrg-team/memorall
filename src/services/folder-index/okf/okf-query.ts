import { normalizeFolderPath, isSameOrInside } from "../index-config";
import type { IndexStoreIO } from "../storage";
import type { FolderIndexGraph } from "../types";
import {
	FILE_RESOURCE_SCHEME,
	INDEXER_END,
	INDEXER_START,
	keptSections,
	resourcePath,
} from "./concept";
import { markdownLinkTargets } from "./content-summary";
import {
	frontmatterString,
	frontmatterTags,
	isStale,
	lifecycleStatus,
	parseOkfDocument,
	trustTier,
} from "./frontmatter";
import {
	libraryPathOfStore,
	okfCardPath,
	okfStorePath,
	RESERVED_FILES,
} from "./okf-index";

/**
 * Reading OKF indexes, for the agent's tools. Read only: cards are written by
 * the indexer and by the user, never by these.
 */

export interface OkfSearchInput {
	query?: string;
	type?: string;
	tags?: string[];
	/** Only cards of files in this folder or below it. */
	folder?: string;
	limit?: number;
}

export interface OkfSearchHit {
	path: string;
	type: string;
	title: string;
	description?: string;
	tags: string[];
	status: string;
	stale: boolean;
	score: number;
	/** Lines of the card body that matched. */
	matches: string[];
}

/** Most cards a search reads; a bigger index is searched by folder. */
export const MAX_SEARCHED_CARDS = 5_000;
/** Most cards a graph draws; a bigger index is drawn by folder. */
export const MAX_GRAPH_CARDS = 400;

/**
 * Link targets on a card: markdown links outside code blocks (the excerpt is
 * one, so links quoted from the file do not count) and frontmatter values
 * that are paths to concepts (OKF §6.2).
 */
const cardHrefs = (
	body: string,
	frontmatter: Record<string, unknown>,
): string[] => {
	const hrefs: string[] = [];
	let fence: string | null = null;
	for (const line of body.split("\n")) {
		const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
		if (marker) {
			if (!fence) fence = marker;
			else if (marker.startsWith(fence)) fence = null;
			continue;
		}
		if (fence) continue;
		hrefs.push(...markdownLinkTargets(line));
	}
	for (const value of Object.values(frontmatter)) {
		if (typeof value === "string" && /^(\/|\.\.?\/).+\.md$/.test(value))
			hrefs.push(value);
	}
	return hrefs;
};

/**
 * The library path of the file whose card a link names. Links point at cards
 * ("acme.pdf.md"); a link straight to a file's own name works too.
 */
const resolveCardHref = (
	href: string,
	fromFolder: string,
	root: string,
): string | null => {
	if (href.startsWith(FILE_RESOURCE_SCHEME)) return resourcePath(href);
	if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) return null;
	let path = href.split(/[#?]/)[0];
	try {
		path = decodeURI(path);
	} catch {
		// Keep it as written.
	}
	const base = path.startsWith("/") ? (root === "/" ? "" : root) : fromFolder;
	const parts = `${base}/${path}`
		.split("/")
		.filter((part) => part && part !== ".");
	const resolved: string[] = [];
	for (const part of parts) {
		if (part === "..") resolved.pop();
		else resolved.push(part);
	}
	const target = `/${resolved.join("/")}`;
	return target.endsWith(".md") ? target.slice(0, -3) : target;
};

const tokenize = (text: string): string[] =>
	text
		.toLocaleLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((term) => term.length > 1);

/** Library path of a card or file argument: "a.pdf" and "a.pdf.md" both name the file. */
export const filePathArgument = (path: string): string =>
	normalizeFolderPath(path);

/** A card body read into its parts, for showing a card. */
export interface OkfCardBody {
	/** Lines of the "# File" section, e.g. "Size: 1.5 KB". */
	facts: string[];
	excerpt?: string;
	/** Library paths of the files this card links to. */
	links: string[];
	/** What a person or agent added outside the indexer's part. */
	notes?: string;
}

/** Splits a card body into the indexer's sections and what others added. */
export const readCardBody = (
	body: string,
	filePath: string,
	root: string,
): OkfCardBody => {
	const start = body.indexOf(INDEXER_START);
	const end = body.indexOf(INDEXER_END);
	const generated =
		start !== -1 && end !== -1
			? body.slice(start + INDEXER_START.length, end)
			: body;
	const facts: string[] = [];
	const hrefs: string[] = [];
	const excerpt: string[] = [];
	let section = "";
	let fence: string | null = null;
	for (const line of generated.split("\n")) {
		const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
		if (marker && section === "excerpt") {
			if (!fence) fence = marker;
			else if (marker.startsWith(fence)) fence = null;
			continue;
		}
		if (fence) {
			excerpt.push(line);
			continue;
		}
		const heading = /^#\s+(.+?)\s*$/.exec(line);
		if (heading) {
			section = heading[1].toLowerCase();
			continue;
		}
		if (section === "file" && line.startsWith("- ")) facts.push(line.slice(2));
		else if (section === "links") hrefs.push(...markdownLinkTargets(line));
	}
	const folder = filePath.slice(0, filePath.lastIndexOf("/")) || "/";
	const links = [
		...new Set(
			hrefs.flatMap((href) => {
				const target = resolveCardHref(href, folder, root);
				return target ? [target] : [];
			}),
		),
	];
	const notes = keptSections(body).join("\n").trim();
	return {
		facts,
		...(excerpt.length ? { excerpt: excerpt.join("\n").trim() } : {}),
		links,
		...(notes ? { notes } : {}),
	};
};

export class OkfReader {
	constructor(private readonly store: IndexStoreIO) {}

	/** A folder's index.md, or null when the folder has no OKF index. */
	readIndex(folder: string): Promise<string | null> {
		return this.store.read(`${okfStorePath(folder)}/index.md`);
	}

	/** A file's card, by the file's library path (or the card's own name). */
	async readCard(path: string): Promise<{ path: string; text: string } | null> {
		const filePath = filePathArgument(path);
		const direct = await this.store.read(okfCardPath(filePath));
		if (direct !== null) return { path: filePath, text: direct };
		if (filePath.endsWith(".md")) {
			const asCard = await this.store.read(okfStorePath(filePath));
			if (asCard !== null) return { path: filePath.slice(0, -3), text: asCard };
		}
		return null;
	}

	private async cardPaths(
		folder: string,
	): Promise<{ paths: string[]; truncated: boolean }> {
		const paths: string[] = [];
		const queue = [okfStorePath(folder)];
		while (queue.length) {
			const current = queue.shift() as string;
			for (const entry of await this.store.list(current)) {
				const path = `${current}/${entry.name}`;
				if (entry.kind === "folder") queue.push(path);
				else if (
					entry.name.endsWith(".md") &&
					!RESERVED_FILES.has(entry.name)
				) {
					paths.push(path);
					if (paths.length >= MAX_SEARCHED_CARDS)
						return { paths, truncated: true };
				}
			}
		}
		return { paths, truncated: false };
	}

	/**
	 * Cards matching every filter, best first. Words score by where they
	 * appear: title and type count most, then description and tags, then the
	 * body.
	 */
	async search(
		input: OkfSearchInput,
		roots: string[],
	): Promise<{ hits: OkfSearchHit[]; searched: number; truncated: boolean }> {
		const scopes = input.folder
			? roots.some((root) => isSameOrInside(input.folder as string, root))
				? [normalizeFolderPath(input.folder)]
				: roots.filter((root) => isSameOrInside(root, input.folder as string))
			: roots;
		const terms = tokenize(input.query ?? "");
		const wantType = input.type?.trim().toLocaleLowerCase();
		const wantTags = (input.tags ?? [])
			.map((tag) => tag.trim().toLocaleLowerCase())
			.filter(Boolean);
		const hits: OkfSearchHit[] = [];
		let searched = 0;
		let truncated = false;

		for (const scope of scopes) {
			const found = await this.cardPaths(scope);
			truncated ||= found.truncated;
			for (const cardPath of found.paths) {
				const text = await this.store.read(cardPath);
				if (text === null) continue;
				searched += 1;
				const { frontmatter, body } = parseOkfDocument(text);
				const type = frontmatterString(frontmatter, "type") ?? "File";
				const tags = frontmatterTags(frontmatter);
				if (wantType && !type.toLocaleLowerCase().includes(wantType)) continue;
				const lowerTags = tags.map((tag) => tag.toLocaleLowerCase());
				if (wantTags.some((tag) => !lowerTags.includes(tag))) continue;

				const title =
					frontmatterString(frontmatter, "title") ??
					cardPath.split("/").pop()?.slice(0, -3) ??
					"";
				const description = frontmatterString(frontmatter, "description");
				let score = terms.length ? 0 : 1;
				const matches: string[] = [];
				if (terms.length) {
					const head = tokenize(`${title} ${type}`);
					const middle = tokenize(`${description ?? ""} ${tags.join(" ")}`);
					const lowerBody = body.toLocaleLowerCase();
					let matchedTerms = 0;
					for (const term of terms) {
						let termScore = 0;
						if (head.some((word) => word.startsWith(term))) termScore += 5;
						if (middle.some((word) => word.startsWith(term))) termScore += 3;
						if (lowerBody.includes(term)) termScore += 1;
						if (termScore > 0) matchedTerms += 1;
						score += termScore;
					}
					if (matchedTerms === 0) continue;
					// Cards that match every word rank above partial matches.
					score *= matchedTerms / terms.length;
					for (const line of body.split("\n")) {
						const lower = line.toLocaleLowerCase();
						if (line.trim() && terms.some((term) => lower.includes(term))) {
							matches.push(line.trim().slice(0, 200));
							if (matches.length >= 2) break;
						}
					}
				}
				const resource = frontmatterString(frontmatter, "resource");
				hits.push({
					path:
						(resource && resourcePath(resource)) ??
						libraryPathOfStore(cardPath.slice(0, -3)),
					type,
					title,
					description,
					tags,
					status: lifecycleStatus(frontmatter),
					stale: isStale(frontmatter),
					score,
					matches,
				});
			}
		}
		hits.sort(
			(left, right) =>
				right.score - left.score || left.path.localeCompare(right.path),
		);
		return { hits: hits.slice(0, input.limit ?? 10), searched, truncated };
	}

	/**
	 * A folder's bundle as a graph (OKF §6): its folders and cards, an edge
	 * from each folder to what it holds, and an edge for each link between
	 * cards. Links are read from card bodies outside code blocks and from
	 * path-valued frontmatter; bundle-relative links resolve from `root`.
	 */
	async graph(folder: string, root: string): Promise<FolderIndexGraph> {
		const top = normalizeFolderPath(folder);
		const bundleRoot = normalizeFolderPath(root);
		const nodes = new Map<string, FolderIndexGraph["nodes"][number]>();
		const edges: FolderIndexGraph["edges"] = [];
		const cardLinks: Array<{ from: string; hrefs: string[] }> = [];
		let truncated = false;
		let cards = 0;
		const nameOf = (path: string) =>
			path === "/" ? "Files" : (path.split("/").pop() ?? path);

		nodes.set(top, { id: top, kind: "folder", label: nameOf(top) });
		const queue = [top];
		while (queue.length) {
			const current = queue.shift() as string;
			for (const entry of await this.store.list(okfStorePath(current))) {
				const child =
					current === "/" ? `/${entry.name}` : `${current}/${entry.name}`;
				if (entry.kind === "folder") {
					nodes.set(child, { id: child, kind: "folder", label: entry.name });
					edges.push({ source: current, target: child, kind: "contains" });
					queue.push(child);
					continue;
				}
				if (!entry.name.endsWith(".md") || RESERVED_FILES.has(entry.name))
					continue;
				if (cards >= MAX_GRAPH_CARDS) {
					truncated = true;
					continue;
				}
				cards += 1;
				const text = await this.store.read(okfStorePath(child));
				if (text === null) continue;
				const filePath = child.slice(0, -3);
				const { frontmatter, body } = parseOkfDocument(text);
				nodes.set(filePath, {
					id: filePath,
					kind: "card",
					label: frontmatterString(frontmatter, "title") ?? nameOf(filePath),
					type: frontmatterString(frontmatter, "type"),
					description: frontmatterString(frontmatter, "description"),
				});
				edges.push({ source: current, target: filePath, kind: "contains" });
				cardLinks.push({ from: filePath, hrefs: cardHrefs(body, frontmatter) });
			}
		}

		const seen = new Set<string>();
		for (const { from, hrefs } of cardLinks) {
			const cardFolder = from.slice(0, from.lastIndexOf("/")) || "/";
			for (const href of hrefs) {
				const target = resolveCardHref(href, cardFolder, bundleRoot);
				if (!target || target === from || !nodes.has(target)) continue;
				const key = `${from}\u0000${target}`;
				if (seen.has(key)) continue;
				seen.add(key);
				edges.push({ source: from, target, kind: "link" });
			}
		}
		return { nodes: [...nodes.values()], edges, truncated };
	}

	/** One-line facts about a card's trust and lifecycle (OKF §5). */
	static trustLine(text: string): string {
		const { frontmatter } = parseOkfDocument(text);
		const parts = [
			`trust: ${trustTier(frontmatter)}`,
			`status: ${lifecycleStatus(frontmatter)}`,
		];
		if (isStale(frontmatter)) parts.push("stale: yes");
		return parts.join(" · ");
	}
}
