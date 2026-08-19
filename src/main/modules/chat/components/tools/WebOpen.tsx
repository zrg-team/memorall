import React from "react";
import { ExternalLink, Globe } from "lucide-react";
import type { ActionRenderer } from "@/main/modules/chat/components/types";
import type { MessageActionItem } from "@/main/modules/chat/components/types";
import { defaultActionRenderer } from "./DefaultActionRenderer";
import { WebChallengeNotice } from "./WebChallengeNotice";
import {
	getBoolean,
	getString,
	getStructuredToolPayload,
	openToolUrl,
	ToolDetail,
	ToolDetailsGrid,
	ToolItemRawIO,
	ToolSection,
	ToolStateBadge,
	getWebBlockDetails,
	getToolNumber,
} from "./ToolCommon";

const extractWebOpenPayload = (
	item: MessageActionItem,
): Record<string, unknown> | null => {
	const payload = getStructuredToolPayload(item);
	if (!payload) {
		return null;
	}

	return getString(payload, "actionType") === "web_open" ? payload : null;
};

export const webOpenRenderer: ActionRenderer = (item, isOpen) => {
	if (!isOpen) return null;

	const payload = extractWebOpenPayload(item);
	if (!payload) {
		return defaultActionRenderer(item, isOpen);
	}

	const currentUrl = getString(payload, "url");
	const requestedUrl = getString(payload, "requestedUrl");
	const title = getString(payload, "title");
	const sessionId = getString(payload, "sessionId");
	const browserMode = getString(payload, "browserMode");
	const renderReady = getBoolean(payload, "renderReady");
	const domAccessible = getBoolean(payload, "domAccessible");
	const success = getBoolean(payload, "success");
	const error = getString(payload, "error");
	const blocked = getWebBlockDetails(payload);
	const tabId = getToolNumber(payload, "tabId");

	return (
		<div className="space-y-3">
			<ToolSection>
				<div className="flex items-start gap-3">
					<div className="mt-0.5 rounded-md border border-border/60 bg-muted/20 p-2">
						<Globe className="h-4 w-4 text-muted-foreground" />
					</div>
					<div className="min-w-0 flex-1 space-y-2">
						<div className="flex flex-wrap items-center gap-2">
							<ToolStateBadge ok={success} />
							{browserMode ? <ToolStateBadge label={browserMode} /> : null}
							{renderReady !== undefined ? (
								<ToolStateBadge
									ok={renderReady}
									label={renderReady ? "render ready" : "render pending"}
								/>
							) : null}
							{domAccessible !== undefined ? (
								<ToolStateBadge
									ok={domAccessible}
									label={domAccessible ? "DOM ready" : "DOM blocked"}
								/>
							) : null}
						</div>
						<div className="text-sm font-medium text-foreground break-words">
							{title || currentUrl || requestedUrl || "Web session"}
						</div>
						{currentUrl ? (
							<div className="flex items-center gap-2 text-xs text-muted-foreground">
								<span className="min-w-0 flex-1 truncate font-mono">
									{currentUrl}
								</span>
								<button
									type="button"
									className="shrink-0 text-muted-foreground hover:text-foreground"
									onClick={() => openToolUrl(currentUrl)}
									title="Open URL"
								>
									<ExternalLink className="h-3.5 w-3.5" />
								</button>
							</div>
						) : null}
					</div>
				</div>

				{blocked ? (
					<WebChallengeNotice
						blocked={blocked}
						sessionId={sessionId}
						tabId={tabId}
						url={currentUrl || requestedUrl}
					/>
				) : null}

				{error ? (
					<div className="mt-3 rounded-md border border-red-600/20 bg-red-600/5 px-3 py-2 text-xs text-red-700">
						{error}
					</div>
				) : null}

				<div className="mt-3">
					<ToolDetailsGrid>
						{sessionId ? (
							<ToolDetail label="Session" value={sessionId} mono />
						) : null}
						{browserMode ? (
							<ToolDetail label="Mode" value={browserMode} mono />
						) : null}
						{requestedUrl ? (
							<ToolDetail label="Requested URL" value={requestedUrl} mono />
						) : null}
						{currentUrl && currentUrl !== requestedUrl ? (
							<ToolDetail label="Current URL" value={currentUrl} mono />
						) : null}
						{title ? <ToolDetail label="Title" value={title} /> : null}
					</ToolDetailsGrid>
				</div>
			</ToolSection>
			<ToolItemRawIO item={item} output={payload} />
		</div>
	);
};
