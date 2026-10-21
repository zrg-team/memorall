import { useEffect, useRef, useState } from "react";
import {
	requestTabTranscription,
	supportsTabTranscription,
} from "@/services/tab-transcription/client";
import type {
	TabTranscript,
	TabTranscriptionProgress,
	TabTranscriptionSession,
} from "@/services/tab-transcription/types";
import { storedTranscriptProgress } from "@/services/tab-transcription/progress";
import { EmbeddedTranscription } from "@/embedded/components/transcription/EmbeddedTranscription";
import { transcriptionStyles } from "@/embedded/components/transcription/styles";
import type { TranscriptionViewActions } from "@/content/modules/tab-transcription-view";
import { useWorkspaceModeStore } from "@/main/stores/workspace-mode";

/** The same quiet reader in Studio and on the captured page. Each recording is a thread. */
export function TabTranscriptionPanel({
	sessionId,
	onSessionsChanged,
}: {
	sessionId?: string | null;
	onSessionsChanged?: () => Promise<void>;
}) {
	const [active, setActive] = useState<TabTranscriptionSession | null>(null);
	const [live, setLive] = useState<TabTranscriptionProgress | null>(null);
	const [transcript, setTranscript] = useState<TabTranscript | null>(null);
	const [error, setError] = useState("");
	const selected = useRef(sessionId);
	selected.current = sessionId;
	const notify = useRef(onSessionsChanged);
	notify.current = onSessionsChanged;
	const fingerprint = useRef("");
	const refreshRef = useRef<() => Promise<void>>(async () => {});
	const supported = supportsTabTranscription();
	useEffect(() => {
		setTranscript(null);
		void refreshRef.current();
	}, [sessionId]);
	useEffect(() => {
		if (!supported) return;
		let disposed = false;
		let loading = false;
		let historyAt = 0;
		let newestId: string | undefined;
		let loadedId: string | undefined;
		let timer: ReturnType<typeof setTimeout>;
		const refresh = async (force = false) => {
			if (loading || selected.current === null) return;
			loading = true;
			try {
				const status = await requestTabTranscription({
					action: "status",
					...(selected.current ? { sessionId: selected.current } : {}),
				});
				if (disposed) return;
				setActive(status.session ?? null);
				setLive(status.progress ?? null);
				// Stream a small live snapshot frequently; don't reread a long
				// recording or rebuild the whole sidebar on every token update.
				const history =
					force ||
					Date.now() - historyAt >= 2000 ||
					(selected.current !== undefined && selected.current !== loadedId);
				if (history) {
					const list = await requestTabTranscription({ action: "list" });
					if (disposed) return;
					historyAt = Date.now();
					newestId = list.sessions?.[0]?.id;
					const nextFingerprint = JSON.stringify(
						list.sessions?.map((item) => [
							item.id,
							item.status,
							item.summaryStatus,
							item.title,
						]),
					);
					if (fingerprint.current !== nextFingerprint) {
						fingerprint.current = nextFingerprint;
						await notify.current?.();
					}
				}
				const id =
					selected.current === undefined
						? (status.session?.id ?? newestId)
						: selected.current;
				if (id && (history || id !== loadedId)) {
					const result = await requestTabTranscription({
						action: "get",
						sessionId: id,
					});
					if (
						disposed ||
						(selected.current !== undefined && selected.current !== id)
					)
						return;
					setTranscript(result.transcript ?? null);
					loadedId = id;
				}
				setError("");
			} catch (reason) {
				if (!disposed)
					setError(reason instanceof Error ? reason.message : String(reason));
			} finally {
				loading = false;
			}
		};
		refreshRef.current = () => refresh(true);
		const poll = async () => {
			await refresh();
			if (!disposed) timer = setTimeout(() => void poll(), 300);
		};
		void poll();
		return () => {
			disposed = true;
			clearTimeout(timer);
		};
	}, [supported]);
	if (!supported || sessionId === null) return null;
	const id = sessionId ?? transcript?.session.id;
	const stored = transcript?.session.id === id ? transcript : null;
	const current =
		live?.session.id === id
			? live
			: stored
				? storedTranscriptProgress(stored)
				: null;
	const byId = new Map(
		stored?.chunks.map((chunk) => [chunk.id, chunk] as const),
	);
	for (const chunk of current?.chunks ?? [])
		byId.set(chunk.id, {
			...byId.get(chunk.id),
			...chunk,
			audioPath: byId.get(chunk.id)?.audioPath ?? "",
		});
	const progress = current
		? {
				...current,
				session: {
					...current.session,
					title: stored?.session.title ?? current.session.title,
				},
				chunks: [...byId.values()].sort((a, b) => a.index - b.index),
			}
		: null;
	const actions: TranscriptionViewActions = {
		getTranslationModels: async () =>
			(await requestTabTranscription({ action: "options" }))
				.translationModels ?? [],
		configure: async (options) => {
			if (!id) throw new Error("No recording selected");
			await requestTabTranscription({
				action: "configure",
				sessionId: id,
				...options,
			});
			await refreshRef.current();
		},
		stop: async () => {
			await requestTabTranscription({
				action: "stop",
				tabId: active?.tabId,
				noteStyle: "none",
			});
			await refreshRef.current();
		},
		perform: async (action) => {
			if (!id) throw new Error("No recording selected");
			if (action === "summary" || action === "notes") {
				await requestTabTranscription({
					action: "summarize",
					sessionId: id,
					noteStyle: action,
				});
				await refreshRef.current();
				return;
			}
			const result = await requestTabTranscription({
				action: "finish-action",
				sessionId: id,
				operation: action === "save" ? "save" : "export",
			});
			if (action === "save") return result.path;
			if (!result.export) throw new Error("No transcript available");
			if (action === "chat")
				useWorkspaceModeStore.getState().sendTextToChat(result.export.content);
			else if (action === "copy")
				await navigator.clipboard.writeText(result.export.content);
			else {
				const url = URL.createObjectURL(
					new Blob([result.export.content], { type: result.export.mimeType }),
				);
				const anchor = document.createElement("a");
				anchor.href = url;
				anchor.download = result.export.fileName;
				anchor.click();
				setTimeout(() => URL.revokeObjectURL(url), 2000);
			}
		},
		openStudio: () => {},
	};
	return (
		<div
			className="memorall-chat-container mt-studio-wrapper"
			data-tab-transcription-panel
		>
			<style>{transcriptionStyles}</style>
			<EmbeddedTranscription
				key={id ?? "loading"}
				variant="page"
				state={{ progress, session: active?.id === id ? active : null, error }}
				actions={actions}
			/>
		</div>
	);
}
