import { OKF_INDEX_TYPE_ID, OKF_TOOLS } from "./constants";
import { OKF_PROMPT } from "./okf/okf-prompt";

/**
 * What each built-in index type is, without how it indexes: enough for the
 * agent feature (tools and prompt), the feature catalog and the settings.
 * Runtime-light, so the catalog can import it. A new index type adds its
 * descriptor here and registers its indexer in the runtime.
 */
export interface FolderIndexTypeDescriptor {
	id: string;
	label: string;
	description: string;
	tools: readonly string[];
	prompt: string;
}

export const OKF_INDEX_TYPE: FolderIndexTypeDescriptor = {
	id: OKF_INDEX_TYPE_ID,
	label: "OKF",
	description:
		"Open Knowledge Format: a card per file with its type and summary, plus index.md and log.md per folder.",
	tools: OKF_TOOLS,
	prompt: OKF_PROMPT,
};

export const FOLDER_INDEX_TYPES: readonly FolderIndexTypeDescriptor[] = [
	OKF_INDEX_TYPE,
];
