import { FileQuestion } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { LazyExcelViewer } from "@/main/modules/files/components/LazyExcelViewer";
import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
import { toDocumentsSandboxPath } from "@/services/filesystem/sandbox-paths";
import { memonMimeType } from "@/services/memon/file-kinds";
import type { MemonViewerState } from "@/services/memon/types";
import { PdfPages } from "./PdfPages";
import { TextPreview } from "./TextPreview";

const Centered: React.FC<{ children: React.ReactNode }> = ({ children }) => (
	<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground">
		{children}
	</div>
);

/**
 * The file the Viewer shows, previewed the way the Files page does. The agent
 * reads `viewer.text` instead; this is what the user sees.
 */
export const ViewerWindow: React.FC<{ viewer: MemonViewerState }> = ({
	viewer,
}) => {
	const { t } = useTranslation("common");
	const [url, setUrl] = React.useState<string | null>(null);
	const [excelData, setExcelData] = React.useState<Uint8Array | null>(null);
	const [pdfData, setPdfData] = React.useState<Uint8Array | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [mediaError, setMediaError] = React.useState(false);
	const { path, kind } = viewer;

	React.useEffect(() => {
		setUrl(null);
		setExcelData(null);
		setPdfData(null);
		setError(null);
		setMediaError(false);
		// Word documents show the text the agent reads, rendered.
		if (!path || !kind || kind === "binary" || kind === "document") return;
		let cancelled = false;
		let objectUrl: string | null = null;
		void (async () => {
			try {
				const content = await documentFileSystemService.readFile(
					toDocumentsSandboxPath(path),
				);
				if (cancelled) return;
				if (kind === "excel") {
					setExcelData(content);
					return;
				}
				if (kind === "pdf") {
					setPdfData(content);
					return;
				}
				objectUrl = URL.createObjectURL(
					new Blob([content.slice()], { type: memonMimeType(path) }),
				);
				setUrl(objectUrl);
			} catch (reason) {
				if (!cancelled) {
					setError(reason instanceof Error ? reason.message : String(reason));
				}
			}
		})();
		return () => {
			cancelled = true;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	}, [path, kind]);

	if (!path || !kind) {
		return <Centered>{t("memonComputer.viewer.empty")}</Centered>;
	}
	if (error || viewer.error) {
		return (
			<Centered>
				<span className="text-red-700 dark:text-red-300">
					{viewer.error ?? error}
				</span>
			</Centered>
		);
	}
	if (kind === "binary") {
		return (
			<Centered>
				<FileQuestion size={20} />
				<span>{t("memonComputer.viewer.noPreview")}</span>
			</Centered>
		);
	}
	if (kind === "document") {
		return viewer.loading ? (
			<Centered>{t("memonComputer.viewer.opening")}</Centered>
		) : (
			<TextPreview
				kind="markdown"
				text={viewer.text}
				title={path.split("/").pop() ?? path}
			/>
		);
	}
	if (kind === "excel") {
		return excelData ? (
			<div className="flex min-h-0 flex-1 p-2">
				<div className="h-full w-full overflow-hidden rounded-lg border">
					<LazyExcelViewer
						fileData={excelData}
						fileName={path.split("/").pop() ?? path}
						className="h-full"
					/>
				</div>
			</div>
		) : (
			<Centered>{t("memonComputer.viewer.opening")}</Centered>
		);
	}
	if (kind === "pdf") {
		return pdfData ? (
			<PdfPages data={pdfData} name={path.split("/").pop() ?? path} />
		) : (
			<Centered>{t("memonComputer.viewer.opening")}</Centered>
		);
	}
	if (!url) return <Centered>{t("memonComputer.viewer.opening")}</Centered>;

	switch (kind) {
		case "image":
			return (
				<div className="flex min-h-0 flex-1 items-center justify-center bg-muted/20 p-2">
					<img
						src={url}
						alt={path.split("/").pop() ?? path}
						className="max-h-full max-w-full object-contain"
					/>
				</div>
			);
		case "audio":
			return (
				<Centered>
					{/* biome-ignore lint/a11y/useMediaCaption: user audio has no captions to offer */}
					<audio
						key={url}
						src={url}
						controls
						preload="metadata"
						className="w-full max-w-md"
						onError={() => setMediaError(true)}
					/>
					{mediaError ? (
						<span>{t("memonComputer.viewer.cannotPlay")}</span>
					) : null}
				</Centered>
			);
		case "video":
			return (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-black p-2">
					{/* biome-ignore lint/a11y/useMediaCaption: user video has no captions to offer */}
					<video
						key={url}
						src={url}
						controls
						playsInline
						preload="metadata"
						className="h-full w-full object-contain"
						onError={() => setMediaError(true)}
					/>
					{mediaError ? (
						<span className="text-xs text-zinc-300">
							{t("memonComputer.viewer.cannotPlay")}
						</span>
					) : null}
				</div>
			);
	}
};
