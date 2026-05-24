import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Renderer, type ActionEvent } from "@openuidev/react-lang";
import { createComponentLibrary } from "./index";
import { MarkdownMessage } from "@/main/modules/chat/components/MarkdownMessage";
import { ThreeDotsLoader } from "@/main/components/atoms/ThreeDotsLoader";
import { useTranslation } from "react-i18next";
import { logError, logWarn } from "@/utils/logger";
import type { OpenUITheme } from "@/services/flows/steps/features/visualize-response";
import {
	dispatchMemorallOpenUIAction,
	isSafeOpenUIUrl,
	parseMemorallOpenUIAction,
	resolveOpenUITemplate,
} from "./actions";

// Theme is the 4th positional arg in: CardBlock("title", "desc", [...], "theme")
const THEME_PATTERN = /\bCardBlock\s*\([\s\S]*?\]\s*,\s*"([^"]+)"\s*\)/;
const KNOWN_THEMES = new Set<OpenUITheme>(["shadcn", "wireframe", "glass"]);

function detectTheme(content: string): OpenUITheme {
	const match = THEME_PATTERN.exec(content);
	if (match) {
		const t = match[1] as OpenUITheme;
		if (KNOWN_THEMES.has(t)) return t;
	}
	return "shadcn";
}

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

export function OpenUIRenderer({
	content,
	streaming,
}: {
	content: string;
	streaming: boolean;
}) {
	const { t } = useTranslation("chat");
	const theme = useMemo(() => detectTheme(content), [content]);
	const library = useMemo(() => createComponentLibrary(theme), [theme]);
	const [resetKey, setResetKey] = useState(0);
	const [renderFailed, setRenderFailed] = useState(false);
	const [streamingRenderFailed, setStreamingRenderFailed] = useState(false);
	const prevStreaming = useRef(streaming);

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

	const handleOpenUIAction = useCallback((event: ActionEvent) => {
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
				(error) => logWarn("[OpenUIRenderer] Clipboard copy failed:", error),
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

		dispatchMemorallOpenUIAction(detail);
	}, []);

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
			<Renderer
				key={resetKey}
				response={content}
				library={library}
				isStreaming={streaming}
				onAction={handleOpenUIAction}
				onError={handleRendererError}
			/>
		</OpenUIErrorBoundary>
	);
}
