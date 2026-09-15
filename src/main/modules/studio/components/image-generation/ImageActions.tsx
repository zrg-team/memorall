import { Check, Copy, Download } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import { useMediaUrl } from "../shared/StoredImage";

const ICON_BUTTON = "h-7 w-7 text-muted-foreground hover:text-foreground";

/**
 * A download link for a stored image.
 *
 * Stored media lives in the documents filesystem, not at a URL, so the link
 * borrows the shared object URL and stays inert until it resolves.
 */
export const DownloadImageLink: React.FC<{
	path: string;
	mimeType: string;
	fileName: string;
	label?: string;
	className?: string;
	showLabel?: boolean;
}> = ({ path, mimeType, fileName, label, className, showLabel = false }) => {
	const { t } = useTranslation("studio");
	const text = label ?? t("common.download", { defaultValue: "Download" });
	const { url } = useMediaUrl(path, mimeType);
	return (
		<Button
			asChild
			variant="ghost"
			size={showLabel ? "sm" : "icon"}
			className={cn(
				showLabel ? "h-7 gap-1 px-2 text-xs" : ICON_BUTTON,
				className,
			)}
		>
			<a
				href={url ?? undefined}
				download={fileName}
				aria-label={text}
				title={text}
				aria-disabled={!url}
				data-image-download={path}
				onClick={(event) => {
					event.stopPropagation();
					if (!url) event.preventDefault();
				}}
			>
				<Download size={14} />
				{showLabel ? <span>{text}</span> : null}
			</a>
		</Button>
	);
};

/** Copy text to the clipboard with a short "copied" confirmation. */
export const CopyTextButton: React.FC<{
	text: string;
	label?: string;
	className?: string;
	showLabel?: boolean;
}> = ({ text, label, className, showLabel = false }) => {
	const { t } = useTranslation("studio");
	const [copied, setCopied] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);
	const shownLabel = copied
		? t("common.copied", { defaultValue: "Copied" })
		: (label ?? t("common.copy", { defaultValue: "Copy" }));
	return (
		<Button
			type="button"
			variant="ghost"
			size={showLabel ? "sm" : "icon"}
			className={cn(
				showLabel ? "h-7 gap-1 px-2 text-xs" : ICON_BUTTON,
				className,
			)}
			aria-label={shownLabel}
			title={shownLabel}
			data-copy-text
			onClick={async (event) => {
				event.stopPropagation();
				try {
					await navigator.clipboard.writeText(text);
					setCopied(true);
					if (timer.current) clearTimeout(timer.current);
					timer.current = setTimeout(() => setCopied(false), 1500);
				} catch {
					// Clipboard access can be denied (unfocused document); nothing to undo.
				}
			}}
		>
			{copied ? <Check size={14} /> : <Copy size={14} />}
			{showLabel ? <span>{shownLabel}</span> : null}
		</Button>
	);
};

export const ICON_ACTION_CLASS = ICON_BUTTON;
