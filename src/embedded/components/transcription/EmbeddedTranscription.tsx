import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
	ArrowDown,
	ArrowUpRight,
	AudioLines,
	CircleAlert,
	Check,
	ChevronDown,
	ChevronUp,
	Copy,
	Download,
	FileText,
	FolderOpen,
	Loader2,
	MessageSquare,
	Minus,
	Sparkles,
	Square,
	X,
	Languages,
} from "lucide-react";
import { Button } from "@/main/components/ui/button";
import { EmbeddedMarkdown } from "@/embedded/components/EmbeddedMarkdown";
import { useEmbeddedTranslation } from "@/embedded/hooks/use-embedded-language";
import type {
	TranscriptionViewActions,
	TranscriptionViewState,
} from "@/content/modules/tab-transcription-view";
import type { TranscriptChunkPreview } from "@/services/tab-transcription/types";
import { formatTranscriptionTime } from "@/services/tab-transcription/progress";
import { cleanTranscriptText } from "@/services/tab-transcription/text";
import { transcriptParagraphs } from "@/services/tab-transcription/paragraphs";
import { transcriptLanguage } from "@/services/tab-transcription/languages";
import { TranscriptionLanguageSettings } from "./TranscriptionLanguageSettings";
import { ParagraphTranslation } from "./ParagraphTranslation";

export function EmbeddedTranscription({
	state,
	actions,
	reveal = 0,
	variant = "floating",
}: {
	state: TranscriptionViewState;
	actions: TranscriptionViewActions;
	reveal?: number;
	variant?: "floating" | "page";
}) {
	const t = useEmbeddedTranslation("transcription");
	const progress = state.progress;
	const snapshot = progress?.session ?? state.session;
	// The active owner can advance before the stored transcript is refreshed.
	const session =
		snapshot && state.session?.id === snapshot.id
			? { ...snapshot, status: state.session.status }
			: snapshot;
	const recording = session?.status === "recording";
	const liveSession = recording || session?.status === "finishing";
	const [minimized, setMinimized] = useState(false);
	const [dismissed, setDismissed] = useState(false);
	const [finishing, setFinishing] = useState(false);
	const stopPending = useRef(false);
	const [stopError, setStopError] = useState("");
	const [menu, setMenu] = useState(false);
	const [languageSettings, setLanguageSettings] = useState(false);
	const [busy, setBusy] = useState(false);
	const [actionError, setActionError] = useState("");
	const [message, setMessage] = useState("");
	const [now, setNow] = useState(Date.now());
	const [chunks, setChunks] = useState<TranscriptChunkPreview[]>([]);
	const cache = useRef(new Map<string, TranscriptChunkPreview>());
	const cacheSession = useRef("");
	const reader = useRef<HTMLDivElement>(null);
	const content = useRef<HTMLDivElement>(null);
	const languageButton = useRef<HTMLButtonElement>(null);
	const languageReadingPosition = useRef(0);
	const scrollInteraction = useRef(false);
	const follow = useRef(liveSession);
	const [following, setFollowing] = useState(liveSession);
	const lastRead = useRef(-1);
	const menuButton = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const changeFollow = (next: boolean) => {
		follow.current = next;
		setFollowing(next);
	};
	const scrollToLive = () => {
		changeFollow(true);
		lastRead.current = chunks.at(-1)?.index ?? -1;
		if (reader.current) reader.current.scrollTop = reader.current.scrollHeight;
	};
	const closeLanguageSettings = () => {
		setLanguageSettings(false);
		languageButton.current?.focus();
	};
	useEffect(() => {
		setMinimized(false);
		setDismissed(false);
	}, [reveal]);
	useEffect(() => {
		setFinishing(false);
		stopPending.current = false;
		setStopError("");
		setMenu(false);
		setLanguageSettings(false);
		setActionError("");
		setMessage("");
		changeFollow(liveSession);
		scrollInteraction.current = false;
		if (reader.current) reader.current.scrollTop = 0;
	}, [session?.id]);
	useEffect(() => {
		if (!recording) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [recording]);
	useEffect(() => {
		if (!progress) return;
		let changed = false;
		if (cacheSession.current !== progress.session.id) {
			cache.current.clear();
			cacheSession.current = progress.session.id;
			lastRead.current = -1;
			changed = true;
		}
		for (const chunk of progress.chunks) {
			const clean = { ...chunk, text: cleanTranscriptText(chunk.text) };
			const previous = cache.current.get(chunk.id);
			if (
				!previous ||
				previous.text !== clean.text ||
				previous.status !== clean.status ||
				previous.error !== clean.error ||
				JSON.stringify(previous.translations) !==
					JSON.stringify(clean.translations)
			) {
				cache.current.set(chunk.id, clean);
				changed = true;
			}
		}
		// Never discard a paragraph while the user is reading it.
		if (follow.current && variant === "floating")
			while (cache.current.size > 600) {
				cache.current.delete(cache.current.keys().next().value!);
				changed = true;
			}
		if (changed)
			setChunks([...cache.current.values()].sort((a, b) => a.index - b.index));
	}, [progress, variant]);
	const textVersion = chunks
		.map(
			(chunk) =>
				`${chunk.id}:${chunk.status}:${chunk.text}:${JSON.stringify(chunk.translations)}`,
		)
		.join("|");
	useLayoutEffect(() => {
		if (follow.current && !minimized && !languageSettings) {
			if (reader.current)
				reader.current.scrollTop = reader.current.scrollHeight;
			lastRead.current = chunks.at(-1)?.index ?? -1;
		}
	}, [textVersion, minimized, languageSettings]);
	useLayoutEffect(() => {
		if (!languageSettings && !follow.current && reader.current)
			reader.current.scrollTop = languageReadingPosition.current;
	}, [languageSettings]);
	useLayoutEffect(() => {
		if (
			typeof ResizeObserver === "undefined" ||
			!reader.current ||
			!content.current
		)
			return;
		const observer = new ResizeObserver(() => {
			if (follow.current && !minimized && !languageSettings && reader.current)
				reader.current.scrollTop = reader.current.scrollHeight;
		});
		observer.observe(reader.current);
		observer.observe(content.current);
		return () => observer.disconnect();
	}, [session?.id, minimized, languageSettings]);
	useEffect(() => {
		if (!menu) return;
		const scope = menuRef.current?.getRootNode() ?? document;
		const close = (event: Event) => {
			const path = event.composedPath();
			if (
				scope instanceof ShadowRoot &&
				event.currentTarget === document &&
				path.includes(scope.host)
			)
				return;
			if (
				!path.includes(menuRef.current!) &&
				!path.includes(menuButton.current!)
			)
				setMenu(false);
		};
		menuRef.current
			?.querySelector<HTMLButtonElement>("button:not(:disabled)")
			?.focus();
		document.addEventListener("pointerdown", close, { capture: true });
		if (scope !== document)
			scope.addEventListener("pointerdown", close, { capture: true });
		return () => {
			document.removeEventListener("pointerdown", close, { capture: true });
			if (scope !== document)
				scope.removeEventListener("pointerdown", close, { capture: true });
		};
	}, [menu]);
	const handleScroll = () => {
		const element = reader.current;
		if (!element || minimized || languageSettings) return;
		const atBottom =
			element.scrollHeight - element.scrollTop - element.clientHeight < 48;
		// Layout, font loading and our own writes also dispatch scroll events.
		// Only a user's scroll should interrupt the live reader.
		if (!atBottom && follow.current && !scrollInteraction.current) return;
		if (!follow.current && !scrollInteraction.current) return;
		changeFollow(atBottom);
		scrollInteraction.current = false;
		if (atBottom) lastRead.current = chunks.at(-1)?.index ?? -1;
	};
	const finish = async () => {
		if (stopPending.current) return;
		stopPending.current = true;
		setFinishing(true);
		setMenu(false);
		setStopError("");
		setActionError("");
		try {
			await actions.stop("none");
		} catch (reason) {
			setFinishing(false);
			setStopError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			stopPending.current = false;
		}
	};
	const perform = async (
		action: Parameters<TranscriptionViewActions["perform"]>[0],
	) => {
		setBusy(true);
		setActionError("");
		setMessage("");
		try {
			const result = await actions.perform(action);
			setMessage(
				result
					? t("fileSaved", { path: result })
					: action === "summary" || action === "notes"
						? ""
						: t("actionDone"),
			);
			setMenu(false);
		} catch (reason) {
			setActionError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setBusy(false);
		}
	};
	const openThread = async () => {
		setBusy(true);
		setActionError("");
		try {
			await actions.openStudio(session?.id);
			setMenu(false);
		} catch (reason) {
			setActionError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setBusy(false);
		}
	};
	const close = () => {
		setMenu(false);
		setDismissed(true);
		actions.close?.();
	};
	const phase = progress?.phase;
	const settled =
		!!session &&
		session.status !== "recording" &&
		session.status !== "finishing";
	const generating = session?.summaryStatus === "running";
	const elapsed = formatTranscriptionTime(
		session ? Math.max(0, (session.endedAt ?? now) - session.startedAt) : 0,
	);
	const status =
		phase === "loading-model"
			? t("preparing", { percent: Math.round(progress?.modelLoadPercent ?? 0) })
			: generating
				? t("summarizing")
				: session?.status === "finishing" &&
						!progress?.pendingChunks &&
						(progress?.translatingChunks ?? 0) > 0
					? t("translating")
					: (finishing && !settled) ||
							phase === "saving" ||
							phase === "transcribing"
						? t("saving")
						: recording
							? t("live")
							: phase === "failed" || phase === "interrupted"
								? t("interrupted")
								: t("saved");
	const issue =
		stopError ||
		actionError ||
		state.error ||
		session?.error ||
		session?.summaryError ||
		session?.translationError;
	const issueLabel = stopError
		? t("stopFailed")
		: actionError
			? t("actionFailed")
			: state.error
				? t("connection")
				: session?.summaryError
					? t("notesFailed")
					: session?.translationError
						? t("translationFailed")
						: t("actionFailed");
	const paragraphs = useMemo(() => transcriptParagraphs(chunks), [chunks]);
	const unread = chunks.filter(
		(chunk) => chunk.index > lastRead.current,
	).length;
	const hasText =
		chunks.some((chunk) => chunk.status === "done" && chunk.text) ||
		(progress?.completedChunks ?? 0) >
			chunks.filter((chunk) => chunk.status === "done").length;
	const menuItems = [
		{ action: "summary", icon: Sparkles, label: "createSummary" },
		{ action: "notes", icon: FileText, label: "createNotes" },
		{ action: "save", icon: FolderOpen, label: "saveFile" },
		{ action: "download", icon: Download, label: "download" },
		{ action: "chat", icon: MessageSquare, label: "sendChat" },
		{ action: "copy", icon: Copy, label: "copy" },
	] as const;
	if (dismissed) return null;
	return (
		<div
			className={
				variant === "floating" ? "memorall-embedded-root" : "mt-page-root"
			}
		>
			<section
				className={
					variant === "floating"
						? "mt-surface memorall-chat-shell memorall-chat-shell--popup memorall-transcription"
						: "mt-surface memorall-transcription-page"
				}
				aria-label={t(liveSession ? "title" : "readingTitle")}
				data-settings={languageSettings}
				hidden={minimized}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						if (menu) {
							setMenu(false);
							menuButton.current?.focus();
						} else if (languageSettings) closeLanguageSettings();
						else if (variant === "floating") close();
						event.stopPropagation();
					}
				}}
			>
				<header className="mt-header">
					{variant === "floating" ? (
						<div className="mt-mark">
							<AudioLines size={19} aria-hidden="true" />
						</div>
					) : null}
					<div className="mt-heading">
						<h2 title={session?.title}>
							{variant === "page"
								? session?.title || t("readingTitle")
								: t(liveSession ? "title" : "readingTitle")}
						</h2>
						<p className="mt-source">
							{variant === "floating"
								? session?.title || "Memorall"
								: t("original")}
						</p>
					</div>
					{variant === "floating" ? (
						<div className="mt-window-controls">
							<Button
								variant="ghost"
								size="icon"
								className="mt-icon"
								aria-label={t("minimize")}
								title={t("minimize")}
								onClick={() => setMinimized(true)}
							>
								<Minus />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								className="mt-icon"
								aria-label={t("close")}
								title={t("close")}
								onClick={close}
							>
								<X />
							</Button>
						</div>
					) : null}
				</header>
				<div className="mt-meta" role="status">
					<span className="mt-dot" data-active={recording} />
					<span>{status}</span>
					<span className="mt-meta-divider">·</span>
					<time>{elapsed}</time>
					{phase === "loading-model" ? (
						<progress
							aria-label={status}
							max={100}
							value={progress?.modelLoadPercent}
						/>
					) : null}
				</div>
				{languageSettings ? (
					<TranscriptionLanguageSettings
						session={session}
						actions={actions}
						onClose={closeLanguageSettings}
					/>
				) : null}
				{issue ? (
					<details className="mt-issue">
						<summary>
							<CircleAlert
								size={15}
								className="mt-issue-icon"
								aria-hidden="true"
							/>
							<span>{issueLabel}</span>
							<ChevronDown
								size={14}
								className="mt-issue-toggle"
								aria-hidden="true"
							/>
						</summary>
						<p>{issue}</p>
					</details>
				) : null}
				<div className="mt-reader-wrap">
					<div
						className="mt-reader"
						data-following={following}
						ref={reader}
						tabIndex={0}
						aria-label={t("reading")}
						onScroll={handleScroll}
						onWheel={() => {
							scrollInteraction.current = true;
						}}
						onTouchMove={() => {
							scrollInteraction.current = true;
						}}
						onPointerDown={() => {
							scrollInteraction.current = true;
						}}
						onKeyDown={(event) => {
							if (
								[
									"ArrowUp",
									"ArrowDown",
									"PageUp",
									"PageDown",
									"Home",
									"End",
									" ",
								].includes(event.key)
							)
								scrollInteraction.current = true;
						}}
						onPointerUp={() => {
							scrollInteraction.current = false;
							if (window.getSelection()?.toString()) changeFollow(false);
						}}
					>
						<div ref={content} className="mt-reader-content">
							{session?.summary ? (
								<div className="mt-notes">
									<h3>
										<Sparkles size={15} />
										{t(
											session.noteStyle === "notes"
												? "meetingNotes"
												: "summary",
										)}
									</h3>
									<EmbeddedMarkdown content={session.summary} />
								</div>
							) : null}
							{generating ? (
								<p className="mt-pending">
									<Loader2 className="animate-spin" size={13} />
									{t("summarizing")}
								</p>
							) : null}
							{!paragraphs.length ? (
								<div className="mt-empty">
									<div className="mt-empty-mark">
										<AudioLines size={24} />
									</div>
									<h3>{t("waiting")}</h3>
									<p>{t("waitingHint")}</p>
								</div>
							) : (
								paragraphs.map((paragraph) => (
									<article className="mt-paragraph" key={paragraph.id}>
										<time>{formatTranscriptionTime(paragraph.startMs)}</time>
										{!session?.translation ||
										session.translation.showOriginal !== false ? (
											<p
												className={`mt-text${session?.translation ? " mt-original-text" : ""}`}
												dir="auto"
											>
												{paragraph.parts.map(({ chunk, separator }) => (
													<span key={chunk.id}>
														{separator}
														<span
															data-chunk-id={chunk.id}
															className={
																chunk.status === "pending"
																	? "mt-partial"
																	: undefined
															}
														>
															{chunk.text || t("failed")}
															{chunk.status === "pending" ? (
																<span className="mt-caret" aria-hidden="true" />
															) : null}
														</span>
													</span>
												))}
											</p>
										) : null}
										{session?.translation ? (
											<ParagraphTranslation
												paragraph={paragraph}
												language={session.translation.targetLanguage}
											/>
										) : null}
									</article>
								))
							)}
							{progress?.currentChunkId &&
							!chunks.find((chunk) => chunk.id === progress.currentChunkId)
								?.text ? (
								<p className="mt-pending mt-listening">
									<Loader2 className="animate-spin" size={12} />
									{t("working")}
								</p>
							) : null}
						</div>
					</div>
					{liveSession && !following ? (
						<Button size="sm" className="mt-jump" onClick={scrollToLive}>
							<ArrowDown size={13} />
							{t("backToLive")}
							{unread > 0 ? ` · ${t("newSegments", { count: unread })}` : ""}
						</Button>
					) : null}
				</div>
				<footer className="mt-footer mt-clean-footer">
					<div className="mt-footer-label">
						<button
							type="button"
							className="mt-language-button"
							ref={languageButton}
							disabled={!actions.configure}
							aria-label={t("languageSettings")}
							aria-expanded={languageSettings}
							onClick={() => {
								setMenu(false);
								if (!languageSettings)
									languageReadingPosition.current =
										reader.current?.scrollTop ?? 0;
								setLanguageSettings(!languageSettings);
							}}
						>
							<Languages size={13} />
							<span>
								{session?.translation
									? transcriptLanguage(session.translation.targetLanguage)?.name
									: t("original")}
							</span>
							<ChevronDown size={11} />
						</button>
						{message ? (
							<span className="mt-pending" role="status">
								<Check size={12} />
								{message}
							</span>
						) : (progress?.translatingChunks ?? 0) > 0 ? (
							<span className="mt-pending">
								{t("translationQueued", {
									count: progress?.translatingChunks ?? 0,
								})}
							</span>
						) : liveSession && !following ? (
							<span className="mt-pending">{t("pauseReading")}</span>
						) : null}
					</div>
					<div className="mt-footer-actions">
						<div className="mt-next-wrap">
							{menu ? (
								<div
									className="mt-next-menu"
									ref={menuRef}
									role="menu"
									aria-label={t("next")}
									onKeyDown={(event) => {
										if (event.key !== "ArrowDown" && event.key !== "ArrowUp")
											return;
										event.preventDefault();
										const items = [
											...event.currentTarget.querySelectorAll<HTMLButtonElement>(
												"button:not(:disabled)",
											),
										];
										const current = items.indexOf(
											event.target as HTMLButtonElement,
										);
										items[
											(current +
												(event.key === "ArrowDown" ? 1 : -1) +
												items.length) %
												items.length
										]?.focus();
									}}
								>
									<p>{t("next")}</p>
									{menuItems.map(({ action, icon: Icon, label }) => (
										<Button
											key={action}
											variant="ghost"
											size="sm"
											role="menuitem"
											className="mt-next-item"
											disabled={
												busy ||
												!settled ||
												generating ||
												((action === "summary" || action === "notes") &&
													!hasText)
											}
											onClick={() => void perform(action)}
										>
											<Icon size={15} />
											{t(label)}
											{action === "summary" ? (
												<span className="mt-recommended">
													{t("recommended")}
												</span>
											) : null}
										</Button>
									))}
									{variant === "floating" ? (
										<>
											<div className="mt-menu-divider" />
											<Button
												variant="ghost"
												size="sm"
												role="menuitem"
												className="mt-next-item"
												disabled={busy}
												onClick={() => void openThread()}
											>
												<ArrowUpRight size={15} />
												{t("openThread")}
											</Button>
										</>
									) : null}
								</div>
							) : null}
							{recording ? (
								<Button
									size="sm"
									className="mt-finish"
									aria-label={t(finishing ? "stopping" : "stop")}
									title={t("stop")}
									disabled={finishing}
									onClick={() => void finish()}
								>
									{finishing ? (
										<Loader2
											className="animate-spin"
											size={13}
											aria-hidden="true"
										/>
									) : (
										<Square size={13} aria-hidden="true" />
									)}
									{t(finishing ? "stopping" : "stop")}
								</Button>
							) : (
								<Button
									size="sm"
									variant={variant === "floating" ? "ghost" : "outline"}
									ref={menuButton}
									className="mt-finish"
									aria-haspopup={settled ? "menu" : undefined}
									aria-expanded={menu}
									onClick={() => {
										setMenu(!menu);
									}}
									disabled={busy || !settled}
								>
									{busy || !settled ? (
										<Loader2 className="animate-spin" size={14} />
									) : (
										<ChevronUp size={14} />
									)}
									{t(!settled ? "stopping" : "nextButton")}
								</Button>
							)}
						</div>
						{variant === "floating" ? (
							<Button
								size="sm"
								variant={settled ? "default" : "ghost"}
								className="mt-finish"
								onClick={close}
							>
								{t("closeButton")}
							</Button>
						) : null}
					</div>
				</footer>
			</section>
			{minimized ? (
				<div className="mt-mini">
					<AudioLines size={16} />
					<button
						type="button"
						className="mt-tab"
						aria-label={t("restore")}
						onClick={() => setMinimized(false)}
					>
						{t(recording ? "live" : "saved")} · <time>{elapsed}</time>
					</button>
					<Button
						variant="ghost"
						size="icon"
						className="mt-icon"
						aria-label={t(
							recording ? (finishing ? "stopping" : "stop") : "restore",
						)}
						title={t(recording ? "stop" : "restore")}
						disabled={finishing && recording}
						onClick={() => {
							setMinimized(false);
							if (recording) void finish();
						}}
					>
						{recording ? (
							finishing ? (
								<Loader2 className="animate-spin" />
							) : (
								<Square />
							)
						) : (
							<ChevronUp />
						)}
					</Button>
					<Button
						variant="ghost"
						size="icon"
						className="mt-icon"
						aria-label={t("close")}
						title={t("close")}
						onClick={close}
					>
						<X />
					</Button>
				</div>
			) : null}
		</div>
	);
}
