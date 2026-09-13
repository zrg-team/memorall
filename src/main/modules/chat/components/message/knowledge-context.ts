/**
 * Reads a knowledge context back into what it describes.
 *
 * The memory flows write retrieved knowledge for the model as tagged lines —
 * `<definitions>` with one `"name" (type): summary.` per entity and `<facts>`
 * with one `"source" RELATION "target", fact.` per relationship. Shown as-is,
 * that is a wall of quotes, parentheses and `: .` for every entity without a
 * summary. Parsed, it can be shown as the entities and relationships it is.
 *
 * Anything that does not follow the format returns `null`, so the caller can
 * fall back to the text rather than show a partial reading of it.
 */

export interface KnowledgeEntity {
	name: string;
	type: string;
	summary: string;
}

export interface KnowledgeRelationship {
	source: string;
	relation: string;
	target: string;
	fact: string;
}

export interface KnowledgeContext {
	entities: KnowledgeEntity[];
	relationships: KnowledgeRelationship[];
	/** Text outside the tagged sections, kept rather than dropped. */
	notes: string;
}

const ENTITY_LINE = /^"(.*?)" \(([^()"]*)\): ?(.*)$/;
const RELATIONSHIP_LINE = /^"(.*?)" (\S.*?) "(.*?)", ?(.*)$/;
const SECTION = /<(definitions|facts)>([\s\S]*?)<\/\1>/g;

/** The writer ends every entry with a period, whether or not it already had one. */
const withoutAddedPeriod = (text: string): string =>
	text.trim().replace(/\.$/, "").trim();

/**
 * Lines of one section, each starting an entry or continuing the previous one
 * — a summary or fact can itself span lines. `null` when the first line does
 * not start an entry.
 */
const parseEntries = <T>(
	body: string,
	start: (line: string) => T | null,
	append: (entry: T, line: string) => void,
): T[] | null => {
	const entries: T[] = [];
	for (const line of body.split(/\r?\n/)) {
		if (!line.trim()) continue;
		const entry = start(line.trim());
		if (entry) {
			entries.push(entry);
			continue;
		}
		const previous = entries[entries.length - 1];
		if (!previous) return null;
		append(previous, line.trim());
	}
	return entries;
};

export const parseKnowledgeContext = (
	text: string,
): KnowledgeContext | null => {
	const entities: KnowledgeEntity[] = [];
	const relationships: KnowledgeRelationship[] = [];
	let matchedSection = false;

	for (const [, section, body] of text.matchAll(SECTION)) {
		matchedSection = true;
		if (section === "definitions") {
			const parsed = parseEntries<KnowledgeEntity>(
				body,
				(line) => {
					const match = ENTITY_LINE.exec(line);
					return match
						? { name: match[1], type: match[2], summary: match[3] }
						: null;
				},
				(entry, line) => {
					entry.summary = `${entry.summary}\n${line}`;
				},
			);
			if (!parsed) return null;
			entities.push(...parsed);
			continue;
		}
		const parsed = parseEntries<KnowledgeRelationship>(
			body,
			(line) => {
				const match = RELATIONSHIP_LINE.exec(line);
				return match
					? {
							source: match[1],
							relation: match[2],
							target: match[3],
							fact: match[4],
						}
					: null;
			},
			(entry, line) => {
				entry.fact = `${entry.fact}\n${line}`;
			},
		);
		if (!parsed) return null;
		relationships.push(...parsed);
	}

	if (!matchedSection) return null;

	return {
		entities: entities.map((entity) => ({
			name: entity.name.trim(),
			type: entity.type.trim(),
			summary: withoutAddedPeriod(entity.summary),
		})),
		relationships: relationships.map((relationship) => ({
			source: relationship.source.trim(),
			relation: relationship.relation.trim(),
			target: relationship.target.trim(),
			fact: withoutAddedPeriod(relationship.fact),
		})),
		notes: text.replace(SECTION, "").trim(),
	};
};

/** `HAS_WEAK_POINT` reads as "has weak point"; an already readable label is kept. */
export const readableRelation = (relation: string): string =>
	/^[A-Z0-9_]+$/.test(relation)
		? relation.toLowerCase().replace(/_+/g, " ")
		: relation.replace(/_+/g, " ");
