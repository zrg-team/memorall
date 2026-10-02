import React from "react";
import { saveBytesAsDownload } from "@/main/modules/files/utils/save-download";
import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
import type { MemonFileExport } from "@/services/memon/types";
import { logError } from "@/utils/logger";

/** A zip made longer ago than this is not downloaded by a panel just opened. */
const RECENT_EXPORT_MS = 2 * 60 * 1000;

/**
 * Downloads each folder zip the agent hands the user (memon_act zip) to their
 * machine, once. The machine runs where it cannot start a download, so the
 * open Computer panel does it; the zip stays in Files either way.
 */
export const useMemonExportDownloads = (
	exported: MemonFileExport | null | undefined,
): void => {
	const seenRef = React.useRef<number | null>(null);

	React.useEffect(() => {
		if (!exported) return;
		const firstLook = seenRef.current === null;
		if (!firstLook && exported.id <= (seenRef.current ?? 0)) return;
		seenRef.current = exported.id;
		if (firstLook && Date.now() - exported.at > RECENT_EXPORT_MS) return;
		void documentFileSystemService
			.readMediaFile(exported.path)
			.then((bytes) =>
				saveBytesAsDownload(bytes, exported.name, "application/zip"),
			)
			.catch((error) =>
				logError(`[MEMON] Could not download ${exported.path}:`, error),
			);
	}, [exported]);
};
