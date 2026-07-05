/**
 * Source Status Hook
 * Tracks knowledge generation status using the sources table
 */

import { useState, useEffect, useCallback } from "react";
import { serviceManager } from "@/services";
import { eq, inArray, desc, or } from "drizzle-orm";
import { logError } from "@/utils/logger";
import { getEffectiveSourceStatus } from "@/services/database/types";

export interface SourceStatus {
	isGenerating: boolean;
	status: "pending" | "processing" | "completed" | "failed" | null;
	sourceId?: string;
}

export function useSourceStatus(filePath: string): SourceStatus {
	const [sourceStatus, setSourceStatus] = useState<SourceStatus>({
		isGenerating: false,
		status: null,
	});

	const checkSourceStatus = useCallback(async () => {
		try {
			const results = await serviceManager.databaseService.use(
				async ({ db, schema }) => {
					// Get ALL sources for this file (can have multiple with different graphs/topics)
					const sources = await db
						.select()
						.from(schema.sources)
						.where(eq(schema.sources.targetId, filePath))
						.orderBy(desc(schema.sources.createdAt));

					return sources;
				},
			);

			if (results && results.length > 0) {
				// Check if ANY source is actively processing (accounting for 1-hour timeout)
				const activeSource = results.find((source) => {
					const effectiveStatus = getEffectiveSourceStatus(source, 60); // 60 minutes timeout
					return (
						effectiveStatus === "pending" || effectiveStatus === "processing"
					);
				});

				if (activeSource) {
					const effectiveStatus = getEffectiveSourceStatus(activeSource, 60);
					setSourceStatus({
						isGenerating: true,
						status: effectiveStatus as "pending" | "processing",
						sourceId: activeSource.id,
					});
				} else {
					// No active processing - show the most recent source status
					const mostRecent = results[0];
					const effectiveStatus = getEffectiveSourceStatus(mostRecent, 60);
					setSourceStatus({
						isGenerating: false,
						status: effectiveStatus as
							| "pending"
							| "processing"
							| "completed"
							| "failed",
						sourceId: mostRecent.id,
					});
				}
			} else {
				setSourceStatus({
					isGenerating: false,
					status: null,
				});
			}
		} catch (error) {
			logError("Failed to check source status:", error);
			setSourceStatus({
				isGenerating: false,
				status: null,
			});
		}
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
			const interval = setInterval(checkSourceStatus, 2000); // Check every 2 seconds
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
		new Map(),
	);

	const checkAllStatuses = useCallback(async () => {
		if (filePaths.length === 0) return;

		try {
			const results = await serviceManager.databaseService.use(
				async ({ db, schema }) => {
					// Get ALL sources for all files (can have multiple with different graphs/topics)
					const sources = await db
						.select()
						.from(schema.sources)
						.where(inArray(schema.sources.targetId, filePaths))
						.orderBy(desc(schema.sources.createdAt));

					// Group by targetId (keep ALL sources per file)
					const sourceMap = new Map<string, typeof sources>();
					sources.forEach((source) => {
						const existing = sourceMap.get(source.targetId) || [];
						existing.push(source);
						sourceMap.set(source.targetId, existing);
					});

					return sourceMap;
				},
			);

			const newStatusMap = new Map<string, SourceStatus>();

			filePaths.forEach((filePath) => {
				const sources = results.get(filePath);
				if (sources && sources.length > 0) {
					// Check if ANY source is actively processing (accounting for 1-hour timeout)
					const activeSource = sources.find((source) => {
						const effectiveStatus = getEffectiveSourceStatus(source, 60); // 60 minutes timeout
						return (
							effectiveStatus === "pending" || effectiveStatus === "processing"
						);
					});

					if (activeSource) {
						const effectiveStatus = getEffectiveSourceStatus(activeSource, 60);
						newStatusMap.set(filePath, {
							isGenerating: true,
							status: effectiveStatus as "pending" | "processing",
							sourceId: activeSource.id,
						});
					} else {
						// No active processing - show the most recent source status
						const mostRecent = sources[0];
						const effectiveStatus = getEffectiveSourceStatus(mostRecent, 60);
						newStatusMap.set(filePath, {
							isGenerating: false,
							status: effectiveStatus as
								| "pending"
								| "processing"
								| "completed"
								| "failed",
							sourceId: mostRecent.id,
						});
					}
				} else {
					newStatusMap.set(filePath, {
						isGenerating: false,
						status: null,
					});
				}
			});

			setStatusMap(newStatusMap);
		} catch (error) {
			logError("Failed to check multiple source statuses:", error);
		}
	}, [filePaths]);

	// Check statuses on mount and when filePaths change
	useEffect(() => {
		checkAllStatuses();
	}, [checkAllStatuses]);

	// Poll for status updates when any file is generating
	useEffect(() => {
		const hasGenerating = Array.from(statusMap.values()).some(
			(status) => status.isGenerating,
		);
		if (hasGenerating) {
			const interval = setInterval(checkAllStatuses, 10000);
			return () => clearInterval(interval);
		}
	}, [statusMap, checkAllStatuses]);

	return statusMap;
}
