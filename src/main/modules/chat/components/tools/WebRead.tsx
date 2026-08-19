import React from "react";
import { useTranslation } from "react-i18next";
import { Globe, ExternalLink } from "lucide-react";
import type { ActionRenderer } from "@/main/modules/chat/components/types";
import type { MessageActionItem } from "@/main/modules/chat/components/types";
import { defaultActionRenderer } from "./DefaultActionRenderer";
import {
	getStructuredToolPayload,
	getToolNumber,
	getWebBlockDetails,
	ToolItemRawIO,
} from "./ToolCommon";
import { WebChallengeNotice } from "./WebChallengeNotice";
import { platform } from "@/platform/current";

interface WebReadPayload {
	url?: string;
	requestedUrl?: string;
	title?: string;
	content?: string;
	contentMode?: "text" | "html" | "clean_html";
	selector?: string;
	matchCount?: number;
	fallback?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const extractWebReadPayload = (
	item: MessageActionItem,
): WebReadPayload | null => {
	const fromMetadata = item.metadata;
	if (isRecord(fromMetadata)) {
		return {
			requestedUrl:
				typeof fromMetadata.requestedUrl === "string"
					? fromMetadata.requestedUrl
					: undefined,
			url: typeof fromMetadata.url === "string" ? fromMetadata.url : undefined,
			title:
				typeof fromMetadata.title === "string" ? fromMetadata.title : undefined,
			content:
				typeof fromMetadata.content === "string"
					? fromMetadata.content
					: undefined,
			contentMode:
				fromMetadata.contentMode === "text" ||
				fromMetadata.contentMode === "html" ||
				fromMetadata.contentMode === "clean_html"
					? fromMetadata.contentMode
					: undefined,
			selector:
				typeof fromMetadata.selector === "string"
					? fromMetadata.selector
					: undefined,
			matchCount:
				typeof fromMetadata.matchCount === "number"
					? fromMetadata.matchCount
					: undefined,
			fallback:
				typeof fromMetadata.fallback === "string"
					? fromMetadata.fallback
					: undefined,
		};
	}

	try {
		const parsed = JSON.parse(item.description);
		if (!isRecord(parsed)) {
			return null;
		}
		return {
			requestedUrl:
				typeof parsed.requestedUrl === "string"
					? parsed.requestedUrl
					: undefined,
			url: typeof parsed.url === "string" ? parsed.url : undefined,
			title: typeof parsed.title === "string" ? parsed.title : undefined,
			content: typeof parsed.content === "string" ? parsed.content : undefined,
			contentMode:
				parsed.contentMode === "text" ||
				parsed.contentMode === "html" ||
				parsed.contentMode === "clean_html"
					? parsed.contentMode
					: undefined,
			selector:
				typeof parsed.selector === "string" ? parsed.selector : undefined,
			matchCount:
				typeof parsed.matchCount === "number" ? parsed.matchCount : undefined,
			fallback:
				typeof parsed.fallback === "string" ? parsed.fallback : undefined,
		};
	} catch {
		return null;
	}
};

const isHtmlMode = (payload: WebReadPayload): boolean =>
	payload.contentMode === "html" || payload.contentMode === "clean_html";

export const webReadRenderer: ActionRenderer = (item, isOpen) => {
	if (!isOpen) return null;
	const payload = extractWebReadPayload(item);
	const { t } = useTranslation("chat");
	if (!payload) {
		return defaultActionRenderer(item, isOpen);
	}

	const displayUrl = payload.url || payload.requestedUrl || "";
	// Read the handoff fields from the shared payload rather than re-narrowing
	// them into WebReadPayload, which duplicates every field twice over.
	const structured = getStructuredToolPayload(item);
	const blocked = structured ? getWebBlockDetails(structured) : null;
	const sessionId =
		structured && typeof structured.sessionId === "string"
			? structured.sessionId
			: undefined;
	const tabId = structured ? getToolNumber(structured, "tabId") : undefined;
	const content = payload.content?.trim() || "";
	const metadataBits = [
		payload.contentMode ? `mode: ${payload.contentMode}` : null,
		payload.selector ? `selector: ${payload.selector}` : null,
		typeof payload.matchCount === "number"
			? `matches: ${payload.matchCount}`
			: null,
		payload.fallback ? `fallback: ${payload.fallback}` : null,
	].filter(Boolean);

	return (
		<div className="w-full rounded-lg border border-border/60 overflow-hidden bg-background">
			<div className="flex items-center gap-2 px-3 py-2 border-b border-border/60 bg-muted/30 text-xs">
				<Globe className="w-4 h-4 text-muted-foreground shrink-0" />
				<div className="flex-1 font-mono truncate">
					{payload.title ? `${payload.title} • ` : ""}
					{displayUrl}
				</div>
				<button
					type="button"
					title="Open in new tab"
					className="text-muted-foreground hover:text-foreground shrink-0"
					onClick={() => {
						if (!displayUrl) return;
						void platform.externalLinks.open(displayUrl);
					}}
				>
					<ExternalLink className="w-3.5 h-3.5" />
				</button>
			</div>
			{blocked ? (
				<div className="px-3 pb-1">
					<WebChallengeNotice
						blocked={blocked}
						sessionId={sessionId}
						tabId={tabId}
						url={displayUrl}
					/>
				</div>
			) : null}
			{content && isHtmlMode(payload) ? (
				<iframe
					title={t("actions.webRead.iframeTitle", {
						defaultValue: "web_read HTML preview",
					})}
					srcDoc={content}
					className="w-full h-[360px] bg-white"
					sandbox="allow-forms allow-modals allow-pointer-lock allow-popups allow-presentation allow-same-origin allow-scripts"
				/>
			) : (
				<pre className="max-h-[360px] overflow-auto p-3 text-xs whitespace-pre-wrap break-words bg-muted/20">
					{content ||
						t("actions.webRead.emptyText", {
							defaultValue: "No readable content found.",
						})}
				</pre>
			)}
			{metadataBits.length === 0 ? null : (
				<div className="px-3 py-2 text-xs text-muted-foreground border-t border-border/60">
					<span className="font-mono">{metadataBits.join(" | ")}</span>
				</div>
			)}
			<div className="border-t border-border/60 p-3">
				<ToolItemRawIO item={item} output={payload} />
			</div>
		</div>
	);
};
