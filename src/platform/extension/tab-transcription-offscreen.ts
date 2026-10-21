import { serviceManager } from "@/services";
import { sharedStorageService } from "@/services/shared-storage";
import { meterLlmService } from "@/services/model-usage/metered-llm";
import {
	TabTranscriptionSessionRunner,
	type SessionDependencies,
} from "@/services/tab-transcription/session";
import { tabTranscriptStore } from "@/services/tab-transcription/store";
import { summarizeTabTranscript } from "@/services/tab-transcription/summary";
import {
	liveTranslationModels,
	translateLiveText,
} from "@/services/tab-transcription/translation";
import {
	validTranscriptLanguage,
	transcriptionLanguageCode,
} from "@/services/tab-transcription/languages";
import type { CurrentModelInfo } from "@/services/llm/interfaces/llm-service.interface";
import {
	isNoteStyle,
	isSessionActive,
	TAB_TRANSCRIPTION_OFFSCREEN,
	TAB_TRANSCRIPTION_PREFERENCES,
	type TranscriptionLanguageOptions,
	type NoteStyle,
	type TabTranscriptionResponse,
	type TabTranscriptionSession,
} from "@/services/tab-transcription/types";
import { logError } from "@/utils/logger";
import { TabAudioRecorder } from "./tab-audio-recorder";
import type { Transcription } from "@/types/openai-media";

export function registerTabTranscriptionOffscreen(
	ready: () => Promise<void>,
): void {
	// Offscreen documents expose chrome.runtime, but no chrome.storage API.
	const preferences = sharedStorageService.asKeyValueStore();
	let preparation: Promise<void> | undefined;
	let active:
		| {
				runner: TabTranscriptionSessionRunner;
				recorder: TabAudioRecorder;
				stopping?: Promise<void>;
		  }
		| undefined;
	let starting = false;
	let summarizing = false;
	let summaryRunner: TabTranscriptionSessionRunner | undefined;
	// Keep the final state visible to that tab after capture has released its resources.
	const recent = new Map<number, TabTranscriptionSessionRunner>();
	const snapshots = new Map<string, TabTranscriptionSessionRunner>();
	const remember = (runner: TabTranscriptionSessionRunner) => {
		snapshots.delete(runner.session.id);
		snapshots.set(runner.session.id, runner);
		if (snapshots.size > 20) snapshots.delete(snapshots.keys().next().value!);
		const previous = recent.get(runner.session.tabId);
		if (!previous || previous.session.startedAt <= runner.session.startedAt) {
			recent.delete(runner.session.tabId);
			recent.set(runner.session.tabId, runner);
		}
		if (recent.size > 20) recent.delete(recent.keys().next().value!);
	};
	const prepare = () =>
		(preparation ??= ready()
			.then(() => tabTranscriptStore.recoverInterrupted())
			.catch((error) => {
				preparation = undefined;
				throw error;
			}));
	const dependencies = (
		session: TabTranscriptionSession,
	): SessionDependencies => {
		let preparation: Promise<void> | undefined;
		const prepareModel = (report: (percent: number) => void) =>
			(preparation ??= serviceManager.llmService
				.serveFor(
					session.model.serviceName,
					session.model.modelId,
					(progress) => report(Math.min(100, Math.max(0, progress.percent))),
					{ category: "speech-to-text", select: false },
				)
				.then(() => undefined));
		return {
			store: tabTranscriptStore,
			translate: translateLiveText,
			prepare: prepareModel,
			transcribe: async (model, audioPath, onDelta, onModelProgress) => {
				onModelProgress?.(0);
				try {
					await prepareModel((percent) => onModelProgress?.(percent));
				} finally {
					onModelProgress?.(undefined);
				}
				const llm = meterLlmService(serviceManager.llmService, () => ({
					source: "tab-transcription",
					sessionId: session.id,
					title: session.title,
					tool: "transcribe-tab",
				}));
				let result: Transcription | undefined;
				let text = "";
				for await (const event of llm.audioTranscriptionsStreamFor(
					model.serviceName,
					{
						model: model.modelId,
						file: { kind: "file", path: audioPath, mimeType: "audio/wav" },
						timestamp_granularities: ["segment"],
						language:
							model.provider === "transformer-media"
								? session.language
								: transcriptionLanguageCode(session.sourceLanguage),
						...(model.provider === "openrouter"
							? {
									response_format: "json" as const,
									timestamp_granularities: undefined,
								}
							: {}),
					},
				)) {
					if (event.type === "transcript.text.delta") {
						text += event.delta;
						onDelta?.(text);
					} else result = event.result;
				}
				if (!result) throw new Error("Transcription produced no result");
				return result;
			},
			summarize: summarizeTabTranscript,
		};
	};
	const languageOptions = async (
		options: TranscriptionLanguageOptions,
	): Promise<TranscriptionLanguageOptions> => {
		if (
			options.language !== undefined &&
			options.language !== null &&
			(!validTranscriptLanguage(options.language) ||
				options.language === "zh-TW")
		)
			throw new Error("Choose a supported source language.");
		if (options.translation) {
			if (!validTranscriptLanguage(options.translation.targetLanguage))
				throw new Error("Choose a supported translation language.");
			const model: CurrentModelInfo | null =
				options.translation.model ??
				(await serviceManager.llmService.getCurrentModel());
			if (
				!model ||
				typeof model.modelId !== "string" ||
				typeof model.serviceName !== "string" ||
				!(await serviceManager.llmService.get(model.serviceName))
			)
				throw new Error(
					"Choose a chat or OpenRouter model for translation in Studio first.",
				);
			return {
				...options,
				translation: {
					targetLanguage: options.translation.targetLanguage,
					model,
					showOriginal: options.translation.showOriginal !== false,
				},
			};
		}
		return options;
	};
	const stop = (style: NoteStyle) => {
		const current = active;
		if (!current || current.stopping) return;
		current.runner.session.status = "finishing";
		current.stopping = (async () => {
			try {
				try {
					await current.recorder.stop();
				} catch (error) {
					current.runner.session.error ??=
						error instanceof Error ? error.message : String(error);
				}
				await current.runner.finish(style);
			} catch (error) {
				current.runner.session.status = "failed";
				current.runner.session.error =
					error instanceof Error ? error.message : String(error);
				await tabTranscriptStore
					.saveSession(current.runner.session)
					.catch((reason) =>
						logError("Could not save transcription failure", reason),
					);
			} finally {
				if (active === current) active = undefined;
			}
		})();
	};

	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		if (message?.type !== TAB_TRANSCRIPTION_OFFSCREEN) return false;
		// Only this extension's own pages/worker may control the recorder. Content scripts use the background relay.
		if (
			sender.id !== chrome.runtime.id ||
			!sender.url?.startsWith(chrome.runtime.getURL(""))
		)
			return false;
		void (async (): Promise<TabTranscriptionResponse> => {
			await prepare();
			if (message.action === "options")
				return {
					success: true,
					translationModels: await liveTranslationModels(),
				};
			if (message.action === "status" || message.action === "prepare") {
				const session = active?.runner.session;
				const matches =
					session &&
					(message.tabId === undefined || message.tabId === session.tabId);
				const runner = message.sessionId
					? snapshots.get(message.sessionId)
					: matches
						? active?.runner
						: typeof message.tabId === "number"
							? recent.get(message.tabId)
							: summaryRunner;
				return {
					success: true,
					session:
						session &&
						(message.tabId === undefined || message.tabId === session.tabId)
							? session
							: null,
					progress:
						message.action === "status"
							? (runner?.getProgress() ?? null)
							: undefined,
				};
			}
			if (message.action === "list")
				return { success: true, sessions: await tabTranscriptStore.list() };
			if (message.action === "get")
				return {
					success: true,
					transcript: await tabTranscriptStore.get(message.sessionId),
				};
			if (message.action === "finish-action") {
				const id =
					message.sessionId ??
					(typeof message.tabId === "number"
						? recent.get(message.tabId)?.session.id
						: undefined);
				if (!id)
					throw new Error(
						"This tab has no saved recording. Open its thread in Studio.",
					);
				const transcript = await tabTranscriptStore.get(id);
				if (isSessionActive(transcript.session))
					throw new Error(
						"The final audio is still being transcribed. Please wait a moment.",
					);
				if (message.operation === "export" || message.operation === "save") {
					const { exportTabTranscript } = await import(
						"@/services/tab-transcription/export"
					);
					const file = exportTabTranscript(transcript);
					if (message.operation === "export")
						return { success: true, export: file };
					const { documentFileSystemService } = await import(
						"@/services/filesystem/document-filesystem"
					);
					const path = `/transcripts/${file.fileName}`;
					await documentFileSystemService.writeFile(path, file.content);
					return { success: true, path };
				}
				if (message.operation !== "summary" && message.operation !== "notes")
					throw new Error("Unknown transcript action");
				message = {
					...message,
					action: "summarize",
					sessionId: id,
					noteStyle: message.operation,
				};
			}
			if (message.action === "start") {
				if (active || starting || summarizing)
					throw new Error("Finish the current transcription or notes first.");
				starting = true;
				try {
					const model =
						await serviceManager.llmService.getCurrentModelFor(
							"speech-to-text",
						);
					if (
						!model ||
						!serviceManager.llmService.supportsCategoryFor(
							model.serviceName,
							"speech-to-text",
						)
					)
						throw new Error(
							"Choose a transcription model in Studio → Transcribe first. Local and OpenRouter speech-to-text models are supported.",
						);
					const savedOptions =
						await preferences.get<TranscriptionLanguageOptions>(
							TAB_TRANSCRIPTION_PREFERENCES,
						);
					const session: TabTranscriptionSession = {
						id: tabTranscriptStore.newId(),
						title: message.title || "Tab transcription",
						tabId: message.tabId,
						url: message.url,
						startedAt: Date.now(),
						status: "recording",
						model,
						noteStyle: "none",
					};
					const runner = new TabTranscriptionSessionRunner(
						session,
						dependencies(session),
					);
					const recorder = new TabAudioRecorder();
					await tabTranscriptStore.saveSession(session);
					if (savedOptions) {
						try {
							await runner.configure(await languageOptions(savedOptions));
						} catch (error) {
							if (
								savedOptions.language === null ||
								validTranscriptLanguage(savedOptions.language)
							)
								await runner.configure({ language: savedOptions.language });
							session.translationError =
								error instanceof Error ? error.message : String(error);
							await tabTranscriptStore.saveSession(session);
						}
					}
					active = { runner, recorder };
					remember(runner);
					recorder.onChunk = (samples, sampleRate) =>
						runner.append(samples, sampleRate);
					recorder.onEnded = () => stop(runner.session.noteStyle);
					recorder.onError = (error) => {
						runner.session.error = error.message;
						stop("none");
					};
					runner.onFailure = () => stop("none");
					try {
						await recorder.start(message.streamId, {
							maxWindowSeconds: model.provider === "transformer-media" ? 5 : 3,
						});
						runner.prepareModel();
					} catch (error) {
						runner.session.error =
							error instanceof Error ? error.message : String(error);
						runner.session.status = "failed";
						runner.session.endedAt = Date.now();
						await tabTranscriptStore.saveSession(runner.session);
						active = undefined;
						throw error;
					}
					return { success: true, session: runner.session };
				} finally {
					starting = false;
				}
			}
			if (message.action === "configure") {
				const activeRunner = active?.runner;
				let runner = message.sessionId
					? activeRunner?.session.id === message.sessionId
						? activeRunner
						: snapshots.get(message.sessionId)
					: typeof message.tabId === "number"
						? activeRunner?.session.tabId === message.tabId
							? activeRunner
							: recent.get(message.tabId)
						: active?.runner;
				if (!runner && message.sessionId) {
					const transcript = await tabTranscriptStore.get(message.sessionId);
					runner = new TabTranscriptionSessionRunner(
						transcript.session,
						dependencies(transcript.session),
						transcript.chunks,
					);
					remember(runner);
				}
				if (!runner)
					throw new Error("Open a transcript or start recording first.");
				if (message.noteStyle !== undefined) {
					if (!isNoteStyle(message.noteStyle))
						throw new Error("Invalid notes option");
					runner.session.noteStyle = message.noteStyle;
				}
				const options = await languageOptions({
					...(message.language !== undefined
						? { language: message.language }
						: {}),
					...(message.translation !== undefined
						? { translation: message.translation }
						: {}),
				});
				await runner.configure(options);
				await preferences.set(TAB_TRANSCRIPTION_PREFERENCES, {
					language: runner.session.sourceLanguage ?? null,
					translation: runner.session.translation ?? null,
				});
				if (!active) summaryRunner = runner;
				return {
					success: true,
					session: runner.session,
					progress: runner.getProgress(),
				};
			}
			if (message.action === "stop") {
				if (message.noteStyle !== undefined && !isNoteStyle(message.noteStyle))
					throw new Error("Invalid notes option");
				if (
					active &&
					message.tabId !== undefined &&
					message.tabId !== active.runner.session.tabId
				)
					throw new Error("This tab is not recording");
				const style =
					message.noteStyle ?? active?.runner.session.noteStyle ?? "summary";
				stop(style);
				return { success: true, session: active?.runner.session ?? null };
			}
			if (message.action === "summarize") {
				if (active || starting || summarizing)
					throw new Error("Finish the current transcription or notes first.");
				if (message.noteStyle !== "summary" && message.noteStyle !== "notes")
					throw new Error("Invalid notes option");
				summarizing = true;
				let transcript;
				try {
					transcript = await tabTranscriptStore.get(message.sessionId);
					if (isSessionActive(transcript.session))
						throw new Error("Stop the recording first.");
				} catch (error) {
					summarizing = false;
					throw error;
				}
				const runner = new TabTranscriptionSessionRunner(
					transcript.session,
					dependencies(transcript.session),
					transcript.chunks,
				);
				summaryRunner = runner;
				remember(runner);
				// A model can take minutes. The caller polls the saved state instead of holding a runtime reply open.
				void runner
					.summarize(message.noteStyle)
					.catch((error) => logError("Could not save tab notes", error))
					.finally(() => {
						summarizing = false;
						summaryRunner = undefined;
					});
				return { success: true, session: runner.session };
			}
			throw new Error("Unknown transcription command");
		})()
			.then(sendResponse)
			.catch((error) =>
				sendResponse({
					success: false,
					error: error instanceof Error ? error.message : String(error),
				}),
			);
		return true;
	});
}
