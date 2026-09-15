import type { ModelInfo } from "@/services/llm/interfaces/base-llm";
import type { CurrentModelInfo } from "@/services/llm/interfaces/llm-service.interface";
import type { MediaCategory } from "@/services/llm/interfaces/model-category";
import type { StudioItem } from "@/types/studio";

/**
 * What the studio shell hands every studio canvas.
 *
 * The shell owns model selection, loading, history and layout; a canvas owns
 * one workflow (write -> hear, record -> read, describe -> see) and renders
 * the current session's generations.
 */
export interface StudioCanvasProps {
	mode: MediaCategory;
	/** The selected model for this studio. Never null inside a canvas. */
	model: CurrentModelInfo;
	/**
	 * What the model reports about itself (voices, languages, image task).
	 * Undefined while loading or when the provider publishes nothing.
	 */
	modelInfo?: ModelInfo;
	/** Generations of the open session, oldest first. */
	items: StudioItem[];
	/**
	 * Load the model if it is local and not in memory yet, showing progress in
	 * the shell. Call before every generation; it is instant when loaded.
	 */
	ensureModelReady: () => Promise<CurrentModelInfo>;
	/** The panel is narrow (phone, or the chat column squeezed). */
	isNarrow: boolean;
}
