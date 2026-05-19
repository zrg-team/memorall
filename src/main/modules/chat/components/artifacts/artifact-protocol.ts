export const MEMORALL_ARTIFACT_TAG = "memorall_artifact";
export const MEMORALL_ARTIFACT_OPEN = `<${MEMORALL_ARTIFACT_TAG}`;
export const MEMORALL_ARTIFACT_CLOSE = `</${MEMORALL_ARTIFACT_TAG}>`;
export const STANDARD_ARTIFACT_TAG = "artifact";
export const STANDARD_ARTIFACT_OPEN = `<${STANDARD_ARTIFACT_TAG}`;
export const STANDARD_ARTIFACT_CLOSE = `</${STANDARD_ARTIFACT_TAG}>`;

export const ARTIFACT_TYPES = ["html", "url", "markdown", "text", "hyperframes"] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export type MessageContentSegment =
	| { kind: "text"; text: string }
	| {
			kind: "artifact";
			type: ArtifactType;
			content: string;
			identifier?: string;
			title?: string;
			blockIndex: number;
			start: number;
			openEnd: number;
			contentStart: number;
			contentEnd: number;
			end: number;
	  };

export interface RuntimeArtifact {
	id: string;
	type: ArtifactType;
	content: string;
	identifier?: string;
	title?: string;
	source: "content" | "tool";
	messageId: string;
	messageContent: string;
	messageIndex: number;
	blockIndex: number;
	start: number;
	openEnd: number;
	contentStart: number;
	contentEnd: number;
	end: number;
	createdAt?: Date | string | null;
}

interface ArtifactMessageLike {
	id: string;
	role: string;
	content: string;
	parts?: unknown;
	metadata?: unknown;
	createdAt?: Date | string | null;
}

const DEFAULT_ARTIFACT_TYPE: ArtifactType = "html";

const isArtifactType = (value: string | undefined): value is ArtifactType =>
	ARTIFACT_TYPES.includes(value as ArtifactType);

const normalizeArtifactType = (value: string | undefined): ArtifactType => {
	switch (value) {
		case "text/html":
		case "html":
			return "html";
		case "text/markdown":
		case "text/x-markdown":
		case "markdown":
		case "md":
			return "markdown";
		case "text/plain":
		case "plain":
		case "txt":
		case "text":
			return "text";
		case "text/uri-list":
		case "url":
			return "url";
		case "application/hyperframes":
		case "hyperframes":
			return "hyperframes";
		default:
			return isArtifactType(value) ? value : DEFAULT_ARTIFACT_TYPE;
	}
};

const decodeAttributeValue = (value: string): string =>
	value
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");

const parseArtifactAttributes = (source: string): Record<string, string> => {
	const attrs: Record<string, string> = {};
	const attrPattern = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
	let match: RegExpExecArray | null;

	while ((match = attrPattern.exec(source)) !== null) {
		attrs[match[1]] = decodeAttributeValue(match[2] ?? match[3] ?? "");
	}

	return attrs;
};

/**
 * Parses Memorall's assistant-message artifact protocol.
 *
 * Artifacts deliberately live in assistant message content, not tool results.
 * During streaming, incomplete trailing artifact tags are hidden until the
 * closing tag arrives so users never see raw protocol markup flicker.
 */
export const parseArtifactSegments = (
	content: string,
): MessageContentSegment[] => {
	const segments: MessageContentSegment[] = [];
	let cursor = 0;
	let blockIndex = 0;

	while (cursor < content.length) {
		const standardOpenIdx = content.indexOf(STANDARD_ARTIFACT_OPEN, cursor);
		const legacyOpenIdx = content.indexOf(MEMORALL_ARTIFACT_OPEN, cursor);
		const openIdx =
			standardOpenIdx === -1
				? legacyOpenIdx
				: legacyOpenIdx === -1
					? standardOpenIdx
					: Math.min(standardOpenIdx, legacyOpenIdx);

		if (openIdx === -1) {
			segments.push({ kind: "text", text: content.slice(cursor) });
			break;
		}

		if (openIdx > cursor) {
			segments.push({ kind: "text", text: content.slice(cursor, openIdx) });
		}

		const openEnd = content.indexOf(">", openIdx);
		if (openEnd === -1) {
			break;
		}

		const isLegacy = content.startsWith(MEMORALL_ARTIFACT_OPEN, openIdx);
		const openTag = isLegacy ? MEMORALL_ARTIFACT_OPEN : STANDARD_ARTIFACT_OPEN;
		const closeTag = isLegacy
			? MEMORALL_ARTIFACT_CLOSE
			: STANDARD_ARTIFACT_CLOSE;
		const closeIdx = content.indexOf(closeTag, openEnd + 1);
		if (closeIdx === -1) {
			break;
		}

		const attrs = parseArtifactAttributes(
			content.slice(openIdx + openTag.length, openEnd),
		);
		segments.push({
			kind: "artifact",
			type: normalizeArtifactType(attrs.type),
			content: content.slice(openEnd + 1, closeIdx),
			identifier: attrs.identifier,
			title: attrs.title,
			blockIndex,
			start: openIdx,
			openEnd,
			contentStart: openEnd + 1,
			contentEnd: closeIdx,
			end: closeIdx + closeTag.length,
		});
		blockIndex += 1;

		cursor = closeIdx + closeTag.length;
	}

	return segments;
};

export const getArtifactSegments = (content: string) =>
	parseArtifactSegments(content).filter(
		(segment) => segment.kind === "artifact",
	);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const parseJsonRecord = (value: unknown): Record<string, unknown> | null => {
	if (isRecord(value)) return value;
	if (typeof value !== "string") return null;

	try {
		const parsed = JSON.parse(value);
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
};

const getToolCallArguments = (
	toolCall: Record<string, unknown>,
): Record<string, unknown> | null => {
	const fn = toolCall.function;
	if (!isRecord(fn)) return null;
	return parseJsonRecord(fn.arguments);
};

const getString = (
	value: Record<string, unknown>,
	key: string,
): string | undefined =>
	typeof value[key] === "string" ? value[key] : undefined;

const isRenderArtifactToolCall = (
	toolCall: Record<string, unknown>,
): boolean => {
	const fn = toolCall.function;
	return isRecord(fn) && fn.name === "render_memorall_artifact";
};

const toToolArtifact = ({
	args,
	id,
	message,
	messageIndex,
	blockIndex,
}: {
	args: Record<string, unknown>;
	id: string;
	message: ArtifactMessageLike;
	messageIndex: number;
	blockIndex: number;
}): RuntimeArtifact | null => {
	const content = getString(args, "content");
	if (!content) return null;

	return {
		id,
		type: normalizeArtifactType(getString(args, "type")),
		content,
		identifier: getString(args, "identifier"),
		title: getString(args, "title"),
		source: "tool",
		messageId: message.id,
		messageContent: message.content,
		messageIndex,
		blockIndex,
		start: -1,
		openEnd: -1,
		contentStart: -1,
		contentEnd: -1,
		end: -1,
		createdAt: message.createdAt,
	};
};

const getToolArtifactsFromParts = (
	message: ArtifactMessageLike,
	messageIndex: number,
	blockIndexStart: number,
): RuntimeArtifact[] => {
	if (!Array.isArray(message.parts)) return [];

	const artifacts: RuntimeArtifact[] = [];
	let blockIndex = blockIndexStart;
	for (const part of message.parts) {
		if (!isRecord(part)) continue;

		if (part.role === "assistant" && Array.isArray(part.tool_calls)) {
			for (const toolCall of part.tool_calls) {
				if (!isRecord(toolCall) || !isRenderArtifactToolCall(toolCall)) {
					continue;
				}

				const args = getToolCallArguments(toolCall);
				if (!args) continue;

				const artifact = toToolArtifact({
					args,
					id: `${message.id}:tool:${String(toolCall.id ?? blockIndex)}`,
					message,
					messageIndex,
					blockIndex,
				});
				if (artifact) {
					artifacts.push(artifact);
					blockIndex += 1;
				}
			}
		}

		if (part.role === "assistant" && typeof part.content === "string") {
			for (const segment of getArtifactSegments(part.content)) {
				artifacts.push({
					id: `${message.id}:part:${blockIndex}`,
					type: segment.type,
					content: segment.content,
					identifier: segment.identifier,
					title: segment.title,
					source: "tool",
					messageId: message.id,
					messageContent: message.content,
					messageIndex,
					blockIndex,
					start: -1,
					openEnd: -1,
					contentStart: -1,
					contentEnd: -1,
					end: -1,
					createdAt: message.createdAt,
				});
				blockIndex += 1;
			}
		}
	}

	return artifacts;
};

const getToolArtifactsFromActions = (
	message: ArtifactMessageLike,
	messageIndex: number,
	blockIndexStart: number,
): RuntimeArtifact[] => {
	if (!isRecord(message.metadata) || !Array.isArray(message.metadata.actions)) {
		return [];
	}

	const artifacts: RuntimeArtifact[] = [];
	let blockIndex = blockIndexStart;
	for (const action of message.metadata.actions) {
		if (!isRecord(action) || action.name !== "render_memorall_artifact") {
			continue;
		}

		const metadata = action.metadata;
		if (!isRecord(metadata)) continue;

		const toolCall = metadata.tool_call;
		const args = isRecord(toolCall)
			? getToolCallArguments(toolCall)
			: parseJsonRecord(metadata.input) || parseJsonRecord(metadata.args);
		if (!args) continue;

		const artifact = toToolArtifact({
			args,
			id: `${message.id}:action:${String(action.id ?? blockIndex)}`,
			message,
			messageIndex,
			blockIndex,
		});
		if (artifact) {
			artifacts.push(artifact);
			blockIndex += 1;
		}
	}

	return artifacts;
};

export const collectRuntimeArtifacts = (
	messages: ArtifactMessageLike[],
): RuntimeArtifact[] =>
	messages.flatMap((message, messageIndex) => {
		if (message.role !== "assistant") {
			return [];
		}

		const contentArtifacts = getArtifactSegments(message.content).map(
			(segment) => ({
				id: `${message.id}:${segment.blockIndex}`,
				type: segment.type,
				content: segment.content,
				identifier: segment.identifier,
				title: segment.title,
				source: "content" as const,
				messageId: message.id,
				messageContent: message.content,
				messageIndex,
				blockIndex: segment.blockIndex,
				start: segment.start,
				openEnd: segment.openEnd,
				contentStart: segment.contentStart,
				contentEnd: segment.contentEnd,
				end: segment.end,
				createdAt: message.createdAt,
			}),
		);

		const nextBlockIndex = contentArtifacts.length;
		const partArtifacts = getToolArtifactsFromParts(
			message,
			messageIndex,
			nextBlockIndex,
		);
		const actionArtifacts = getToolArtifactsFromActions(
			message,
			messageIndex,
			nextBlockIndex + partArtifacts.length,
		);
		const toolArtifacts = [...partArtifacts, ...actionArtifacts];

		const seen = new Set<string>();
		return [...contentArtifacts, ...toolArtifacts].filter((artifact) => {
			const key = `${artifact.type}:${artifact.identifier ?? ""}:${artifact.title ?? ""}:${artifact.content}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	});

export const replaceArtifactContent = (
	messageContent: string,
	blockIndex: number,
	nextContent: string,
): string => {
	const artifact = getArtifactSegments(messageContent).find(
		(segment) => segment.blockIndex === blockIndex,
	);

	if (!artifact) {
		return messageContent;
	}

	return `${messageContent.slice(0, artifact.contentStart)}${nextContent}${messageContent.slice(artifact.contentEnd)}`;
};
