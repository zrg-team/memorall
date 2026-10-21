import type {
	TranscriptionView,
	TranscriptionViewActions,
	TranscriptionViewState,
} from "@/content/modules/tab-transcription-view";
import { EmbeddedRoot } from "@/embedded/components/EmbeddedRoot";
import { EmbeddedTranscription } from "@/embedded/components/transcription/EmbeddedTranscription";
import { transcriptionStyles } from "@/embedded/components/transcription/styles";
import { createShadowPage } from "@/embedded/utils/create-shadow-page";

export async function mountTabTranscription(
	actions: TranscriptionViewActions,
): Promise<TranscriptionView> {
	const { root, container, shadowContainer } = createShadowPage({
		id: "memorall-tab-transcription",
		customStyles: transcriptionStyles,
	});
	container.style.cssText =
		"position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
	document.documentElement.append(container);
	let reveal = 0;
	let disposed = false;
	return {
		update: (state: TranscriptionViewState, show = false) => {
			if (disposed) return;
			if (show) reveal++;
			root.render(
				<EmbeddedRoot themeTarget={shadowContainer}>
					<EmbeddedTranscription
						state={state}
						actions={actions}
						reveal={reveal}
					/>
				</EmbeddedRoot>,
			);
		},
		destroy: () => {
			if (disposed) return;
			disposed = true;
			root.unmount();
			container.remove();
		},
	};
}
