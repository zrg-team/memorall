import { logError, logInfo } from "@/utils/logger";
import { sharedStorageService } from "@/services/shared-storage";
import { ChromeRuntimeBridge } from "./chrome-runtime";
import type { OffscreenProgress } from "./types";
import type {
	IServiceInitializationBridge,
	ServiceInitializationProgress,
} from "./service-initialization";

interface InitialProgressMessage {
	type: "INITIAL_PROGRESS";
	currentProgress: OffscreenProgress;
}

function isInitialProgressMessage(msg: unknown): msg is InitialProgressMessage {
	if (typeof msg !== "object" || msg === null) return false;
	const message = msg as Record<string, unknown>;
	return (
		message.type === "INITIAL_PROGRESS" &&
		typeof message.currentProgress === "object"
	);
}

function asAsyncIterable(
	stream: ReadableStream<ServiceInitializationProgress>,
	cleanup?: () => void,
): AsyncIterable<ServiceInitializationProgress> {
	return {
		async *[Symbol.asyncIterator]() {
			const reader = stream.getReader();
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					yield value;
				}
			} finally {
				reader.releaseLock();
				cleanup?.();
			}
		},
	};
}

class ChromeServiceInitializationBridge
	implements IServiceInitializationBridge
{
	async initialize(): Promise<AsyncIterable<ServiceInitializationProgress>> {
		let controller!: ReadableStreamDefaultController<ServiceInitializationProgress>;
		const stream = new ReadableStream<ServiceInitializationProgress>({
			start: (value) => {
				controller = value;
			},
		});
		let completed = false;
		const complete = () => {
			if (completed) return;
			completed = true;
			chrome.runtime.onMessage.removeListener(messageListener);
			try {
				controller.close();
			} catch {}
		};
		const messageListener = (rawMessage: unknown): void => {
			if (!isInitialProgressMessage(rawMessage)) return;
			const progress = rawMessage.currentProgress;
			const failed = progress.status === "Failed" || Boolean(progress.error);
			controller.enqueue({
				stage: failed
					? progress.error || "Offscreen service initialization failed"
					: progress.status,
				progress: progress.progress,
				status: failed ? "error" : progress.done ? "completed" : "initializing",
			});
			if (progress.done) complete();
		};

		try {
			const stored =
				await sharedStorageService.get<OffscreenProgress>("offscreenProgress");
			if (stored?.done) {
				const failed = stored.status === "Failed" || Boolean(stored.error);
				controller.enqueue({
					stage: failed
						? stored.error || "Offscreen service initialization failed"
						: stored.status || "Ready",
					progress: stored.progress || 100,
					status: failed ? "error" : "completed",
				});
				controller.close();
				return asAsyncIterable(stream);
			}
			chrome.runtime.onMessage.addListener(messageListener);
			if (stored)
				controller.enqueue({
					stage: stored.status,
					progress: stored.progress,
					status: "initializing",
				});
		} catch (error) {
			logError("Failed to initialize extension services", error);
			controller.enqueue({
				stage: "Initialization failed",
				progress: 0,
				status: "error",
			});
			controller.close();
		}

		const interval = setInterval(() => {
			void sharedStorageService
				.get<OffscreenProgress>("offscreenProgress")
				.then((progress) => {
					logInfo("Extension runtime initialization status", progress);
					if (progress?.status === "Ready" || (progress?.progress ?? 0) >= 100)
						complete();
				});
		}, 10_000);
		return asAsyncIterable(stream, () => clearInterval(interval));
	}
}

export function createJobNotificationBridge(): ChromeRuntimeBridge {
	return new ChromeRuntimeBridge();
}

export function createServiceInitializationBridge(): IServiceInitializationBridge {
	return new ChromeServiceInitializationBridge();
}
