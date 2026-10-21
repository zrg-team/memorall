import {
	TAB_TRANSCRIPTION,
	type TabTranscriptionCommand,
	type TabTranscriptionResponse,
} from "@/services/tab-transcription/types";
import type {
	MountTranscriptionView,
	TranscriptionView,
	TranscriptionViewState,
} from "./tab-transcription-view";

type Request = (
	command: TabTranscriptionCommand,
) => Promise<TabTranscriptionResponse>;

/** Lightweight relay. React, theming and fonts stay in the existing on-demand UI bundle. */
export function createTabTranscriptionControls(
	request: Request,
	openStudio: (sessionId?: string) => void | Promise<void>,
	mountView: MountTranscriptionView,
) {
	let view: TranscriptionView | undefined;
	let mounting: Promise<TranscriptionView> | undefined;
	let timer: ReturnType<typeof setTimeout>;
	let disposed = false;
	let dismissed = false;
	let mountEpoch = 0;
	let version = 0;
	let latest: TranscriptionViewState = { progress: null, session: null };
	const command = async (command: TabTranscriptionCommand) => {
		const result = await request(command);
		if (!result.success)
			throw new Error(result.error || "Could not update the recording.");
	};
	const close = () => {
		dismissed = true;
		version++;
		mountEpoch++;
		clearTimeout(timer);
		view?.destroy();
		view = undefined;
		mounting = undefined;
	};
	const ensureView = () => {
		if (mounting) return mounting;
		const epoch = mountEpoch;
		const pending = mountView({
			close,
			getTranslationModels: async () => {
				const result = await request({ action: "options" });
				if (!result.success)
					throw new Error(result.error || "Could not load translation models.");
				return result.translationModels ?? [];
			},
			configure: async (options) => {
				await command({ action: "configure", ...options });
				if (!dismissed && !disposed) {
					clearTimeout(timer);
					void poll(false, ++version);
				}
			},
			stop: (noteStyle) => command({ action: "stop", noteStyle }),
			perform: async (action) => {
				const operation =
					action === "download" || action === "copy" ? "export" : action;
				const result = await request({ action: "finish-action", operation });
				if (!result.success)
					throw new Error(result.error || "Could not complete the action.");
				if (action === "download" || action === "copy") {
					if (!result.export) throw new Error("No transcript available");
					if (action === "copy")
						await navigator.clipboard.writeText(result.export.content);
					else {
						const url = URL.createObjectURL(
							new Blob([result.export.content], {
								type: result.export.mimeType,
							}),
						);
						const anchor = document.createElement("a");
						anchor.href = url;
						anchor.download = result.export.fileName;
						anchor.click();
						setTimeout(() => URL.revokeObjectURL(url), 2000);
					}
				}
				if (
					!dismissed &&
					!disposed &&
					(action === "summary" || action === "notes")
				) {
					clearTimeout(timer);
					void poll(false, ++version);
				}
				return result.path;
			},
			openStudio,
		})
			.then((created) => {
				if (disposed || dismissed || epoch !== mountEpoch) {
					created.destroy();
					throw new Error("Transcription controls disposed");
				}
				view = created;
				return created;
			})
			.catch((error) => {
				if (mounting === pending) mounting = undefined;
				throw error;
			});
		mounting = pending;
		return pending;
	};
	const poll = async (reveal = false, revision = version) => {
		if (disposed || dismissed) return;
		let keepPolling = false;
		try {
			const result = await request({ action: "status" });
			if (disposed || dismissed || revision !== version) return;
			if (!result.success)
				throw new Error(
					result.error || "Could not read transcription progress.",
				);
			latest = {
				progress: result.progress ?? null,
				session: result.session ?? null,
			};
			if (!view && !result.session && !reveal) return;
			const surface = view ?? (await ensureView());
			if (disposed || dismissed || revision !== version) return;
			surface.update(latest, reveal);
			keepPolling =
				!!result.session || result.progress?.phase === "summarizing";
		} catch (error) {
			if (disposed || dismissed || revision !== version) return;
			latest = {
				...latest,
				error: error instanceof Error ? error.message : String(error),
			};
			try {
				(view ?? (await ensureView())).update(latest, reveal);
			} catch {
				/* A later show can retry loading the embedded bundle. */
			}
			keepPolling = true;
		}
		if (keepPolling && !disposed && !dismissed && revision === version)
			timer = setTimeout(() => void poll(false, revision), 300);
	};
	return {
		show: () => {
			if (disposed) return;
			dismissed = false;
			clearTimeout(timer);
			void poll(true, ++version);
		},
		restore: () => {
			void poll();
		},
		dispose: () => {
			disposed = true;
			version++;
			clearTimeout(timer);
			view?.destroy();
			view = undefined;
		},
	};
}
export { TAB_TRANSCRIPTION };
