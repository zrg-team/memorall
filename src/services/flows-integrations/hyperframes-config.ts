import { setHyperframesProjectsRoot } from "flow-core/tools/hyperframes/util";
import { setCompositionDocumentRoots } from "flow-core/tools/hyperframes/composition-preprocessor";

/**
 * Configure flows-core hyperframes utilities with Memorall's path conventions.
 * Must be called before any hyperframes tools or steps are used.
 */
export function configureHyperframesForMemorall(): void {
	setHyperframesProjectsRoot("/workspaces");
	setCompositionDocumentRoots(["/documents"]);
}

configureHyperframesForMemorall();
