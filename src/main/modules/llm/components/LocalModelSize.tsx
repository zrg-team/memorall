import type React from "react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { LLMProvider } from "@/services/llm/interfaces/llm-model-config";
import {
	type HubDownloadEstimate,
	fetchHubDownloadSizes,
} from "@/services/llm/registry/media-model-store";
import { getModel } from "@/services/llm/registry/model-registry";
import { formatModelSize } from "../utils/model-size";

interface LocalModelSizeProps {
	provider: LLMProvider;
	modelId: string;
	/**
	 * Look an uncatalogued Hugging Face repo up for an estimate. The runner picks
	 * a precision from what the repo ships, so that estimate is a range.
	 */
	estimateFromHub?: boolean;
	className?: string;
}

/**
 * How much a local chat model downloads, shown wherever one can be picked:
 * the catalog's measured size when it has one, else a Hub estimate.
 */
export const LocalModelSize: React.FC<LocalModelSizeProps> = ({
	provider,
	modelId,
	estimateFromHub = false,
	className,
}) => {
	const catalogGB = getModel(modelId, provider)?.sizeGB;
	const [estimate, setEstimate] = useState<HubDownloadEstimate | null>(null);

	useEffect(() => {
		if (catalogGB || !estimateFromHub || !modelId.includes("/")) return;
		let cancelled = false;
		void fetchHubDownloadSizes(modelId).then((result) => {
			if (!cancelled) setEstimate(result);
		});
		return () => {
			cancelled = true;
		};
	}, [catalogGB, estimateFromHub, modelId]);

	let label: string | null = null;
	if (catalogGB) {
		label = formatModelSize(catalogGB * 1024 ** 3);
	} else if (estimate?.smallest) {
		const smallest = formatModelSize(estimate.smallest);
		const largest = formatModelSize(estimate.largest);
		label =
			largest && largest !== smallest ? `${smallest} – ${largest}` : smallest;
	}
	if (!label) return null;

	return (
		<span
			className={cn(
				"shrink-0 tabular-nums text-xs text-muted-foreground",
				className,
			)}
			title="Download size"
			data-model-size
		>
			{label}
		</span>
	);
};
