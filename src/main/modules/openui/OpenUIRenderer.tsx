import React, {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import "@/main/i18n/config";
import { Renderer, type ActionEvent } from "@openuidev/react-lang";
import {
	readOpenUIState,
	writeOpenUIState,
} from "@/main/modules/openui/openui-form-state";
import { OpenUIWidgetStateProvider } from "@/main/modules/openui/openui-widget-state";
import { createComponentLibrary } from "./index";
import { MarkdownMessage } from "@/main/modules/chat/components/MarkdownMessage";
import { ThreeDotsLoader } from "@/main/components/atoms/ThreeDotsLoader";
import { useTranslation } from "react-i18next";
import { logError, logWarn } from "@/utils/logger";
import {
	isSafeOpenUIUrl,
	parseMemorallOpenUIAction,
	resolveOpenUITemplate,
} from "./actions";
import { useThrottledValue } from "./use-throttled-value";
import type { MessageActionRequest } from "@/main/modules/chat/components/artifacts/ArtifactActionsMenu";
import { detectTheme } from "./detect-theme";

class OpenUIErrorBoundary extends React.Component<
	{ content: string; children: React.ReactNode },
	{ hasError: boolean }
> {
	state = { hasError: false };

	static getDerivedStateFromError() {
		return { hasError: true };
	}

	componentDidCatch(error: unknown) {
		logError("[OpenUIRenderer] Render failed:", error);
	}

	componentDidUpdate(previousProps: { content: string }) {
		if (previousProps.content !== this.props.content && this.state.hasError) {
			this.setState({ hasError: false });
		}
	}

	render() {
		if (this.state.hasError) {
			return <MarkdownMessage>{this.props.content}</MarkdownMessage>;
		}
		return this.props.children;
	}
}

const OpenUIRenderFallback = ({
	content,
	title,
	description,
}: {
	content: string;
	title: string;
	description: string;
}) => (
	<div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
		<div className="font-medium text-destructive">{title}</div>
		<div className="mt-1 text-muted-foreground">{description}</div>
		<div className="mt-3 rounded border border-border/60 bg-background/70 p-3">
			<MarkdownMessage>{content}</MarkdownMessage>
		</div>
	</div>
);

const OpenUIStreamingPlaceholder = ({ label }: { label: string }) => (
	<div className="flex min-h-24 items-center justify-center rounded border border-dashed border-border/60 bg-background/50">
		<div className="flex items-center p-3 gap-2 text-xs text-muted-foreground">
			<ThreeDotsLoader size="sm" />
			<span>{label}</span>
		</div>
	</div>
);

const showOpenUINotice = (message: string) => {
	const existing = document.querySelector("[data-openui-notice]");
	existing?.remove();
	const el = document.createElement("div");
	el.dataset.openuiNotice = "true";
	el.textContent = message;
	el.className =
		"fixed bottom-5 left-1/2 z-[9999] -translate-x-1/2 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-lg";
	document.body.appendChild(el);
	window.setTimeout(() => el.remove(), 2200);
};

interface OpenUIRendererProps {
	content: string;
	streaming: boolean;
	/**
	 * Set when an ancestor already unmounts this block while it is off-screen
	 * (chat's `DeferredMount`). Suppresses the `content-visibility` placeholder
	 * below — the two virtualization layers cancel each other out: unmounting the
	 * subtree discards the browser's remembered `contain-intrinsic-size: auto`
	 * measurement, so each remount snaps back to the 320px intrinsic guess. Inside
	 * the stick-to-bottom conversation that height swing trips the library's
	 * negative-resize branch, which re-locks and yanks the reader to the bottom.
	 */
	deferred?: boolean;
	/**
	 * Identity for this block's form values, so they outlive the unmount that
	 * `deferred` implies. Omit and the block simply keeps today's behaviour of
	 * resetting when it scrolls out of range.
	 */
	stateKey?: string;
	onMessageAction?: (action: MessageActionRequest) => void | Promise<void>;
}

const OpenUIRenderFrame: React.FC<OpenUIRendererProps> = React.memo(
	({ content, streaming, stateKey, onMessageAction }) => {
		const { t } = useTranslation("chat");
		const theme = useMemo(() => detectTheme(content), [content]);
		const library = useMemo(() => createComponentLibrary(theme), [theme]);
		const [resetKey, setResetKey] = useState(0);

		// Read once per mount. A fresh object identity on every render would make
		// the renderer re-hydrate mid-typing.
		const initialState = useMemo(
			() => (stateKey ? readOpenUIState(stateKey) : undefined),
			// resetKey participates so `reset_form` starts from defaults rather than
			// immediately rehydrating what the user just cleared.
			[stateKey, resetKey],
		);

		// Fires per keystroke. A Map write notifies nobody, so a long message list
		// does not re-render while someone types into one of its messages.
		const handleStateUpdate = useCallback(
			(state: Record<string, unknown>) => {
				if (stateKey) writeOpenUIState(stateKey, state);
			},
			[stateKey],
		);
		const [renderFailed, setRenderFailed] = useState(false);
		const [streamingRenderFailed, setStreamingRenderFailed] = useState(false);
		const prevStreaming = useRef(streaming);

		// Dev/harness-only remount counter: proves the OpenUI tree no longer mounts
		// once per streamed token. No-op unless the perf harness sets window.__openuiPerf.
		useEffect(() => {
			const w = window as typeof window & {
				__openuiPerf?: boolean;
				__openuiMounts?: number;
			};
			if (w.__openuiPerf) w.__openuiMounts = (w.__openuiMounts ?? 0) + 1;
		}, []);

		useEffect(() => {
			setRenderFailed(false);
			setStreamingRenderFailed(false);
		}, [content]);

		useEffect(() => {
			if (prevStreaming.current && !streaming) {
				setStreamingRenderFailed(false);
			}
			prevStreaming.current = streaming;
		}, [streaming]);

		const handleOpenUIAction = useCallback(
			(event: ActionEvent) => {
				const detail = parseMemorallOpenUIAction(event);
				if (!detail) {
					logWarn("[OpenUIRenderer] Unhandled action:", event);
					return;
				}

				const action = detail.action;

				if (action.type === "open_link") {
					const url = resolveOpenUITemplate(
						action.url,
						detail.formState,
						detail.formName,
					).trim();
					if (isSafeOpenUIUrl(url)) {
						window.open(url, "_blank", "noopener,noreferrer");
					} else {
						logWarn("[OpenUIRenderer] Blocked unsafe URL:", url);
					}
					return;
				}

				if (action.type === "copy_to_clipboard") {
					const text = resolveOpenUITemplate(
						action.text,
						detail.formState,
						detail.formName,
					);
					void navigator.clipboard?.writeText(text).then(
						() => showOpenUINotice(t("openui.copied")),
						(error) =>
							logWarn("[OpenUIRenderer] Clipboard copy failed:", error),
					);
					return;
				}

				if (action.type === "download_text") {
					const filename =
						resolveOpenUITemplate(
							action.filename,
							detail.formState,
							detail.formName,
						).trim() || "download.txt";
					const blob = new Blob(
						[
							resolveOpenUITemplate(
								action.content,
								detail.formState,
								detail.formName,
							),
						],
						{ type: "text/plain;charset=utf-8" },
					);
					const url = URL.createObjectURL(blob);
					const link = document.createElement("a");
					link.href = url;
					link.download = filename;
					link.click();
					URL.revokeObjectURL(url);
					return;
				}

				if (action.type === "reset_form") {
					setResetKey((value) => value + 1);
					return;
				}

				if (action.type === "show_toast") {
					showOpenUINotice(
						resolveOpenUITemplate(
							action.message,
							detail.formState,
							detail.formName,
						),
					);
					return;
				}

				const routesToParent =
					detail.action.type === "send_message" ||
					detail.action.type === "add_message_to_input" ||
					detail.action.type === "open_document" ||
					detail.action.type === "open_route";

				if (onMessageAction && routesToParent) {
					onMessageAction({
						type: "openui_action",
						component: "OpenUIRenderer",
						payload: { detail },
					});
				}
			},
			[onMessageAction],
		);

		const handleRendererError = useCallback(
			(errors: unknown[]) => {
				if (errors.length > 0) {
					logWarn("[OpenUIRenderer] Parse/runtime errors:", errors);
					if (streaming) {
						setStreamingRenderFailed(true);
					} else {
						setRenderFailed(true);
					}
				}
			},
			[streaming],
		);

		if (renderFailed && !streaming) {
			return (
				<OpenUIRenderFallback
					content={content}
					title={t("openui.renderFailed.title")}
					description={t("openui.renderFailed.description")}
				/>
			);
		}

		if (streamingRenderFailed && streaming) {
			return <OpenUIStreamingPlaceholder label={t("openui.rendering")} />;
		}

		return (
			<OpenUIErrorBoundary content={content}>
				<OpenUIWidgetStateProvider blockKey={stateKey}>
					<Renderer
						key={resetKey}
						response={content}
						library={library}
						isStreaming={streaming}
						initialState={initialState}
						onStateUpdate={handleStateUpdate}
						onAction={handleOpenUIAction}
						onError={handleRendererError}
					/>
				</OpenUIWidgetStateProvider>
			</OpenUIErrorBoundary>
		);
	},
);

OpenUIRenderFrame.displayName = "OpenUIRenderFrame";

export const OpenUIRenderer: React.FC<OpenUIRendererProps> = ({
	content,
	streaming,
	deferred = false,
	onMessageAction,
}) => {
	const baseInterval =
		content.length < 32_000
			? 64
			: content.length < 96_000
				? 96
				: content.length < 256_000
					? 160
					: 240;
	const [renderPenalty, setRenderPenalty] = useState(0);
	const cheapCommitCountRef = useRef(0);
	const renderStartedAtRef = useRef(0);
	renderStartedAtRef.current =
		typeof performance !== "undefined" ? performance.now() : Date.now();
	const renderContent = useThrottledValue(
		content,
		streaming,
		Math.min(300, baseInterval + renderPenalty),
	);

	useLayoutEffect(() => {
		if (!streaming) {
			cheapCommitCountRef.current = 0;
			setRenderPenalty(0);
			return;
		}
		const now =
			typeof performance !== "undefined" ? performance.now() : Date.now();
		const duration = Math.max(0, now - renderStartedAtRef.current);
		if (duration > 32) {
			cheapCommitCountRef.current = 0;
			setRenderPenalty((current) => Math.min(300 - baseInterval, current + 48));
			return;
		}
		if (duration < 16) {
			cheapCommitCountRef.current += 1;
			if (cheapCommitCountRef.current >= 3) {
				cheapCommitCountRef.current = 0;
				setRenderPenalty((current) => Math.max(0, current - 32));
			}
		} else {
			cheapCommitCountRef.current = 0;
		}
	}, [baseInterval, renderContent, streaming]);

	return (
		<div
			style={
				streaming || deferred
					? undefined
					: {
							contentVisibility: "auto",
							containIntrinsicSize: "auto 320px",
						}
			}
		>
			<OpenUIRenderFrame
				content={renderContent}
				streaming={streaming}
				onMessageAction={onMessageAction}
			/>
		</div>
	);
};
