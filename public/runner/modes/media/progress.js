// Download progress for model loads.
//
// transformers.js reports every fetched chunk of every file. Forwarding each one
// floods the postMessage channel (and devtools), so progress is throttled to
// whole-percent steps per file.

const clampPercent = (value) => Math.max(0, Math.min(100, value));

/**
 * @param {(progress: { status: "progress", file: string, progress: number, loaded: number, total: number }) => void} notify
 * @returns {(info: any) => void} A transformers.js `progress_callback`.
 */
export function createDownloadProgress(notify) {
	const lastByFile = new Map();

	const send = (file, progress, loaded, total) => {
		const previous = lastByFile.get(file);
		if (previous !== undefined) {
			if (progress <= previous) return;
			if (progress < 100 && progress - previous < 1) return;
		}
		lastByFile.set(file, progress);
		try {
			notify({ status: "progress", file, progress, loaded, total });
		} catch {}
	};

	return (info) => {
		const file = info?.file;
		if (typeof file !== "string" || !file) return;
		const loaded = typeof info.loaded === "number" ? info.loaded : 0;
		const total = typeof info.total === "number" ? info.total : 0;

		if (info.status === "progress") {
			const percent =
				typeof info.progress === "number"
					? info.progress
					: total > 0
						? (loaded / total) * 100
						: 0;
			send(file, clampPercent(percent), loaded, total);
			return;
		}

		if (info.status === "done") {
			send(file, 100, total || loaded, total || loaded);
		}
	};
}
