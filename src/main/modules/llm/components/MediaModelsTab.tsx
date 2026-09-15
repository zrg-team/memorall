import type React from "react";
import { HubMediaModelList } from "@/main/modules/studio/components/shared/HubMediaModelList";
import type { MediaCategory } from "@/services/llm/interfaces/model-category";

interface MediaModelsTabProps {
	category: MediaCategory;
}

/**
 * On-device models of one kind on the Models page. "Use" records the model
 * for its category and opens that studio.
 */
export const MediaModelsTab: React.FC<MediaModelsTabProps> = ({ category }) => (
	<div data-media-models-tab="transformer-media">
		<HubMediaModelList category={category} openStudioOnUse />
	</div>
);
