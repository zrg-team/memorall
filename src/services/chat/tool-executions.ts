import type { ToolExecutionRecord, ToolExecutionStatus } from "@/types/chat";
import { sanitizeForJson } from "@/utils/sanitize-json";

const SECRET_KEY_PATTERN =
	/(?:api[-_]?key|authorization|cookie|credential|password|secret|token)/i;
const PREVIEW_LIMIT = 4_000;

const redactSecrets = (
	value: unknown,
	seen = new WeakSet<object>(),
): unknown => {
	if (Array.isArray(value)) {
		if (seen.has(value)) return "[Circular]";
		seen.add(value);
		return value.map((item) => redactSecrets(item, seen));
	}
	if (!value || typeof value !== "object") return value;
	if (seen.has(value as object)) return "[Circular]";
	seen.add(value as object);
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).map(([key, item]) => [
			key,
			SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactSecrets(item, seen),
		]),
	);
};

export const createToolExecutionPreview = (
	value: unknown,
): { preview?: string; truncated: boolean } => {
	if (value === undefined) return { truncated: false };
	const sanitized = sanitizeForJson(redactSecrets(value));
	let preview: string;
	if (typeof sanitized === "string") {
		preview = sanitized;
	} else {
		try {
			preview = JSON.stringify(sanitized, null, 2);
		} catch {
			preview = "[Unserializable value]";
		}
	}
	if (preview.length <= PREVIEW_LIMIT) return { preview, truncated: false };
	return {
		preview: `${preview.slice(0, PREVIEW_LIMIT).trimEnd()}\n… [truncated]`,
		truncated: true,
	};
};

export const upsertToolExecution = (
	records: ToolExecutionRecord[],
	record: ToolExecutionRecord,
): ToolExecutionRecord[] => {
	const index = records.findIndex((item) => item.id === record.id);
	if (index === -1) return [...records, record];
	const next = [...records];
	next[index] = { ...records[index], ...record };
	return next;
};

export const finishRunningToolExecutions = (
	records: ToolExecutionRecord[],
	status: Exclude<ToolExecutionStatus, "running">,
	endedAt = new Date().toISOString(),
): ToolExecutionRecord[] =>
	records.map((record) => {
		if (record.status !== "running") return record;
		const durationMs = Math.max(
			0,
			new Date(endedAt).getTime() - new Date(record.startedAt).getTime(),
		);
		return { ...record, status, endedAt, durationMs };
	});
