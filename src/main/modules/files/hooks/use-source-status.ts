/**
 * Source Status Hook
 * Tracks knowledge generation status using the sources table
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { serviceManager } from "@/services";
import { eq, inArray, desc } from "drizzle-orm";
import { logError } from "@/utils/logger";
import { getEffectiveSourceStatus } from "@/services/database/types";
import type { Source } from "@/services/database/entities/sources";
import type { DatabaseContext } from "@/services/database/interfaces/database-service.interface";

export interface SourceStatus {
	isGenerating: boolean;
	status: "pending" | "processing" | "completed" | "failed" | null;
	sourceId?: string;
}

const NO_SOURCE: SourceStatus = { isGenerating: false, status: null };

/**
 * The columns a status is worked out from. A source row also carries its raw
 * text and graph, which can be large, and none of that is needed here.
 */
type SourceStatusRow = Pick<
	Source,
	"id" | "targetId" | "status" | "statusValidFrom" | "updatedAt" | "createdAt"
>;

const statusColumns = (schema: DatabaseContext["schema"]) => ({
	id: schema.sources.id,
	targetId: schema.sources.targetId,
	status: schema.sources.status,
	statusValidFrom: schema.sources.statusValidFrom,
	updatedAt: schema.sources.updatedAt,
	createdAt: schema.sources.createdAt,
});

/** One file's status from its sources, newest first. */
const statusOf = (sources: SourceStatusRow[] | undefined): SourceStatus => {
	if (!sources?.length) return NO_SOURCE;
	// The status helper reads only the columns selected above.
	const effective = (source: SourceStatusRow) =>
		getEffectiveSourceStatus(source as Source, 60); // 60 minutes timeout
	// Check if ANY source is actively processing (accounting for 1-hour timeout)
	const activeSource = sources.find((source) => {
		const effectiveStatus = effective(source);
		return effectiveStatus === "pending" || effectiveStatus === "processing";
	});
	if (activeSource) {
		return {
			isGenerating: true,
			status: effective(activeSource) as "pending" | "processing",
			sourceId: activeSource.id,
		};
	}
	// No active processing - show the most recent source status
	const mostRecent = sources[0];
	return {
		isGenerating: false,
		status: effective(mostRecent) as SourceStatus["status"],
		sourceId: mostRecent.id,
	};
};

const sameStatus = (a: SourceStatus | undefined, b: SourceStatus): boolean =>
	a !== undefined &&
	a.isGenerating === b.isGenerating &&
	a.status === b.status &&
	a.sourceId === b.sourceId;

/** A hidden page has nobody to show a status to; the next visible tick catches up. */
const isPageHidden = () =>
	typeof document !== "undefined" && document.visibilityState === "hidden";

export function useSourceStatus(filePath: string): SourceStatus {
	const [sourceStatus, setSourceStatus] = useState<SourceStatus>(NO_SOURCE);
	const request = useRef(0);

	const checkSourceStatus = useCallback(async () => {
		const current = ++request.current;
		let next: SourceStatus;
		try {
			const results = await serviceManager.databaseService.use(
				async ({ db, schema }) =>
					// ALL sources for this file (can have multiple with different graphs/topics)
					db
						.select(statusColumns(schema))
						.from(schema.sources)
						.where(eq(schema.sources.targetId, filePath))
						.orderBy(desc(schema.sources.createdAt)),
			);
			next = statusOf(results);
		} catch (error) {
			logError("Failed to check source status:", error);
			next = NO_SOURCE;
		}
		// A file opened since asked again; its answer wins.
		if (current !== request.current) return;
		setSourceStatus((previous) =>
			sameStatus(previous, next) ? previous : next,
		);
	}, [filePath]);

	// Check status on mount and when filePath changes
	useEffect(() => {
		if (filePath) {
			checkSourceStatus();
		}
	}, [filePath, checkSourceStatus]);

	// Poll for status updates when generating
	useEffect(() => {
		if (sourceStatus.isGenerating) {
			const interval = setInterval(() => {
				if (!isPageHidden()) void checkSourceStatus();
			}, 2000); // Check every 2 seconds
			return () => clearInterval(interval);
		}
	}, [sourceStatus.isGenerating, checkSourceStatus]);

	return sourceStatus;
}

/**
 * Hook to track multiple file source statuses
 */
export function useMultipleSourceStatus(
	filePaths: string[],
): Map<string, SourceStatus> {
	const [statusMap, setStatusMap] = useState<Map<string, SourceStatus>>(
		() => new Map(),
	);
	const request = useRef(0);
	// Keyed on the paths themselves: the list is rebuilt on every keystroke
	// and selection, and each new array used to mean another query.
	const pathsKey = filePaths.join("\n");

	const checkAllStatuses = useCallback(async () => {
		const paths = pathsKey ? pathsKey.split("\n") : [];
		const current = ++request.current;
		if (paths.length === 0) return;

		try {
			const results = await serviceManager.databaseService.use(
				async ({ db, schema }) => {
					// ALL sources for all files (can have multiple with different graphs/topics)
					const sources = await db
						.select(statusColumns(schema))
						.from(schema.sources)
						.where(inArray(schema.sources.targetId, paths))
						.orderBy(desc(schema.sources.createdAt));

					// Group by targetId (keep ALL sources per file)
					const sourceMap = new Map<string, SourceStatusRow[]>();
					for (const source of sources) {
						const existing = sourceMap.get(source.targetId) ?? [];
						existing.push(source);
						sourceMap.set(source.targetId, existing);
					}
					return sourceMap;
				},
			);
			// Answers to an older list of files are dropped.
			if (current !== request.current) return;

			setStatusMap((previous) => {
				const next = new Map<string, SourceStatus>();
				let changed = previous.size !== paths.length;
				for (const filePath of paths) {
					const status = statusOf(results.get(filePath));
					const before = previous.get(filePath);
					if (before && sameStatus(before, status)) next.set(filePath, before);
					else {
						next.set(filePath, status);
						changed = true;
					}
				}
				return changed ? next : previous;
			});
		} catch (error) {
			logError("Failed to check multiple source statuses:", error);
		}
	}, [pathsKey]);

	// Check statuses on mount and when filePaths change
	useEffect(() => {
		checkAllStatuses();
	}, [checkAllStatuses]);

	// Poll for status updates when any file is generating
	const hasGenerating = Array.from(statusMap.values()).some(
		(status) => status.isGenerating,
	);
	useEffect(() => {
		if (hasGenerating) {
			const interval = setInterval(() => {
				if (!isPageHidden()) void checkAllStatuses();
			}, 10000);
			return () => clearInterval(interval);
		}
	}, [hasGenerating, checkAllStatuses]);

	return statusMap;
}
