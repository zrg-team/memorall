import { dtypeSpecLabel } from "./dtype.js";

export function createProgressCallback(notifyProgress, getDtype) {
	return (progress) => {
		if (progress.status === "progress" && progress.file?.endsWith(".onnx_data")) {
			const loaded = progress.loaded || 0;
			const total = progress.total || 1;
			const percent = Math.min(100, Math.round((loaded / total) * 100));
			const currentDtype = getDtype?.();
			const dtypeInfo = currentDtype ? ` (${dtypeSpecLabel(currentDtype)})` : "";
			if (notifyProgress) {
				notifyProgress({
					loaded,
					total,
					percent,
					text: `Downloading model${dtypeInfo}... ${percent}%`,
				});
			}
		}
	};
}
