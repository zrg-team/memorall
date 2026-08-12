import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	Sparkles,
	ChevronDown,
	ChevronUp,
	Clock,
	Gauge,
	Box,
	Copy,
	Check,
	FolderOpen,
	Hash,
} from "lucide-react";
import dayjs from "dayjs";

import type { Message as DBMessage } from "@/services/database/types";
import { logError } from "@/utils/logger";
import { DocumentSaveFolderDialog } from "./DocumentSaveFolderDialog";

export interface MessageFooterMetadata extends Record<string, unknown> {
	model?: string;
	provider?: string;
	timeToAnswer?: number;
	tokensPerSecond?: number;
	estimatedTokens?: number;
}

interface MessageFooterProps {
	message: DBMessage;
	groupMessages: DBMessage[];
	selectedTopic?: string;
	metadata: MessageFooterMetadata;
}

export const MessageFooter: React.FC<MessageFooterProps> = React.memo(
	({ message, groupMessages, metadata }) => {
		const { t } = useTranslation("chat");
		const [copied, setCopied] = useState(false);
		const [saved, setSaved] = useState(false);
		const [saveDialogOpen, setSaveDialogOpen] = useState(false);
		const [showFullInfo, setShowFullInfo] = useState(false);

		const { model, provider, timeToAnswer, tokensPerSecond, estimatedTokens } =
			metadata;

		const formatTime = (seconds?: number) => {
			if (!seconds) return "-";
			if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`;
			return `${seconds.toFixed(2)}s`;
		};

		const formatTokensPerSecond = (tps?: number) => {
			if (!tps) return "-";
			return `${tps.toFixed(1)} t/s`;
		};

		const getProviderBadgeColor = () => {
			return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20";
		};

		const getModelBadgeColor = () => {
			return "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20";
		};

		const getProviderLabel = (providerName?: string) => {
			return providerName || "Unknown";
		};

		const handleCopy = useCallback(async () => {
			try {
				await navigator.clipboard.writeText(message.content);
				setCopied(true);
				setTimeout(() => setCopied(false), 2000);
			} catch (error) {
				logError("Failed to copy message:", error);
			}
		}, [message.content]);

		const documentContent = useMemo(() => {
			const conversationText = groupMessages
				.filter((msg) => msg.type !== "separator" && msg.content)
				.map((msg) => {
					const role = msg.role === "user" ? "User" : "Assistant";
					return `${role}: ${msg.content}`;
				})
				.join("\n\n");

			const sourceInfo = `Conversation from chat\nDate: ${dayjs().format("MMM D, YYYY h:mm A")}\n\n`;
			return sourceInfo + conversationText;
		}, [groupMessages]);

		const documentFileName = useMemo(
			() => `chat-conversation-${dayjs().format("YYYY-MM-DD-HHmmss")}.md`,
			[],
		);

		const handleSaveToRemembered = useCallback(() => {
			setSaveDialogOpen(true);
		}, []);

		return (
			<div className="mt-3 border-t border-border/40 pt-2">
				<div className="flex flex-wrap items-center justify-between gap-2 text-xs">
					<div className="flex items-center gap-1">
						<button
							type="button"
							onClick={handleCopy}
							className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							title={
								copied
									? t("messages.copied", "Copied!")
									: t("messages.copy", "Copy message")
							}
						>
							{copied ? (
								<Check className="h-3.5 w-3.5 text-green-500" />
							) : (
								<Copy className="h-3.5 w-3.5" />
							)}
							<span>
								{copied
									? t("messages.copied", "Copied")
									: t("messages.copy", "Copy")}
							</span>
						</button>

						<button
							type="button"
							onClick={handleSaveToRemembered}
							className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							title={
								saved
									? t("messages.saved", "Saved!")
									: t("messages.saveToDocuments", "Save to documents")
							}
						>
							{saved ? (
								<Check className="h-3.5 w-3.5 text-green-500" />
							) : (
								<FolderOpen className="h-3.5 w-3.5" />
							)}
							<span>
								{saved
									? t("messages.saved", "Saved")
									: t("messages.save", "Save")}
							</span>
						</button>
					</div>

					<div className="flex items-center">
						<button
							type="button"
							onClick={() => setShowFullInfo(!showFullInfo)}
							className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							aria-expanded={showFullInfo}
						>
							<span>{t("messages.responseDetails", "Response details")}</span>
							{showFullInfo ? (
								<ChevronUp className="h-3.5 w-3.5" />
							) : (
								<ChevronDown className="h-3.5 w-3.5" />
							)}
						</button>
					</div>
				</div>

				<div
					className={`overflow-hidden transition-all duration-200 ease-in-out ${
						showFullInfo ? "max-h-28 opacity-100 mt-2" : "max-h-0 opacity-0"
					}`}
				>
					<div className="pt-2 border-t border-border/40 flex flex-wrap items-center gap-2 text-xs">
						{provider && (
							<div
								className={`flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${getProviderBadgeColor()}`}
							>
								<Sparkles className="h-3 w-3" />
								<span>{getProviderLabel(provider)}</span>
							</div>
						)}

						{model && (
							<div
								className={`flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs font-medium ${getModelBadgeColor()}`}
							>
								<Box className="w-3 h-3" />
								<span>{model}</span>
							</div>
						)}

						{timeToAnswer !== undefined && (
							<div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted/50 border border-border/40 text-muted-foreground">
								<Clock className="w-3 h-3" />
								<span>{formatTime(timeToAnswer)}</span>
							</div>
						)}

						{tokensPerSecond !== undefined && (
							<div className="flex items-center gap-1.5 rounded-md border border-border/40 bg-muted/50 px-2 py-0.5 text-muted-foreground">
								<Gauge className="h-3 w-3" />
								<span>{formatTokensPerSecond(tokensPerSecond)}</span>
							</div>
						)}

						{estimatedTokens !== undefined && (
							<div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted/50 border border-border/40 text-muted-foreground">
								<Hash className="w-3 h-3" />
								<span>{estimatedTokens.toLocaleString()} tokens</span>
							</div>
						)}
					</div>
				</div>
				<DocumentSaveFolderDialog
					open={saveDialogOpen}
					content={documentContent}
					initialFileName={documentFileName}
					mimeType="text/markdown"
					onOpenChange={setSaveDialogOpen}
					onSaved={() => {
						setSaved(true);
						setTimeout(() => setSaved(false), 3000);
					}}
					onError={(error) => {
						logError("Failed to save chat transcript to documents:", error);
					}}
				/>
			</div>
		);
	},
);
