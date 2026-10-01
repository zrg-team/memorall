import { Loader2 } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import type { PDFDocumentProxy } from "@/main/modules/files/handlers/pdf-extraction";
import { logError } from "@/utils/logger";

/** Pages drawn before the user scrolls to them. */
const PAGE_MARGIN = "600px";

/**
 * One page, drawn when it scrolls near the view. pdf.js draws on a canvas, so
 * the page does not depend on the browser's PDF plugin, which can crash inside
 * a moving, resizing window.
 */
const PdfPage: React.FC<{
	doc: PDFDocumentProxy;
	pageNumber: number;
	width: number;
}> = ({ doc, pageNumber, width }) => {
	const holderRef = React.useRef<HTMLDivElement>(null);
	const canvasRef = React.useRef<HTMLCanvasElement>(null);
	const [visible, setVisible] = React.useState(false);
	const [height, setHeight] = React.useState(Math.round(width * 1.3));

	React.useEffect(() => {
		const holder = holderRef.current;
		if (!holder) return;
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry?.isIntersecting) setVisible(true);
			},
			{ rootMargin: PAGE_MARGIN },
		);
		observer.observe(holder);
		return () => observer.disconnect();
	}, []);

	React.useEffect(() => {
		if (!visible || width <= 0) return;
		let cancelled = false;
		let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
		void (async () => {
			try {
				const page = await doc.getPage(pageNumber);
				if (cancelled) return;
				const base = page.getViewport({ scale: 1 });
				const ratio = window.devicePixelRatio || 1;
				const viewport = page.getViewport({
					scale: (width / base.width) * ratio,
				});
				const canvas = canvasRef.current;
				const context = canvas?.getContext("2d");
				if (!canvas || !context) return;
				canvas.width = Math.floor(viewport.width);
				canvas.height = Math.floor(viewport.height);
				setHeight(Math.round(viewport.height / ratio));
				task = page.render({ canvas, canvasContext: context, viewport });
				await task.promise;
			} catch (error) {
				if (
					(error as { name?: string })?.name !== "RenderingCancelledException"
				) {
					logError(`[MEMON] Could not draw PDF page ${pageNumber}:`, error);
				}
			}
		})();
		return () => {
			cancelled = true;
			task?.cancel();
		};
	}, [doc, pageNumber, visible, width]);

	return (
		<div
			ref={holderRef}
			className="mx-auto bg-white shadow-sm"
			style={{ width, height }}
		>
			<canvas ref={canvasRef} className="h-full w-full" />
		</div>
	);
};

/** A PDF, every page drawn with pdf.js and fitted to the window's width. */
export const PdfPages: React.FC<{ data: Uint8Array; name: string }> = ({
	data,
	name,
}) => {
	const { t } = useTranslation("common");
	const scrollRef = React.useRef<HTMLDivElement>(null);
	const [doc, setDoc] = React.useState<PDFDocumentProxy | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [width, setWidth] = React.useState(0);

	React.useEffect(() => {
		let cancelled = false;
		let close: (() => Promise<void>) | null = null;
		setDoc(null);
		setError(null);
		void (async () => {
			try {
				const { openPDFDocument } = await import(
					"@/main/modules/files/handlers/pdf-extraction"
				);
				// pdf.js takes ownership of the buffer it is given.
				const opened = await openPDFDocument(data.slice());
				close = opened.close;
				if (cancelled) {
					void close();
					return;
				}
				setDoc(opened.doc);
			} catch (reason) {
				if (!cancelled) {
					setError(reason instanceof Error ? reason.message : String(reason));
				}
			}
		})();
		return () => {
			cancelled = true;
			void close?.();
		};
	}, [data]);

	React.useLayoutEffect(() => {
		const element = scrollRef.current;
		if (!element) return;
		const observer = new ResizeObserver(([entry]) => {
			const next = Math.floor((entry?.contentRect.width ?? 0) - 24);
			// Redraw only on a real size change, not a pixel of jitter.
			setWidth((current) => (Math.abs(current - next) > 8 ? next : current));
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	return (
		<div
			ref={scrollRef}
			className="min-h-0 flex-1 overflow-auto bg-muted/40 p-3"
			aria-label={name}
		>
			{error ? (
				<p className="text-center text-xs text-red-700 dark:text-red-300">
					{error}
				</p>
			) : !doc || width <= 0 ? (
				<div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
					<Loader2 size={14} className="animate-spin" />
					{t("memonComputer.viewer.opening")}
				</div>
			) : (
				<div className="space-y-3">
					{Array.from({ length: doc.numPages }, (_, index) => (
						<PdfPage
							key={index + 1}
							doc={doc}
							pageNumber={index + 1}
							width={width}
						/>
					))}
				</div>
			)}
		</div>
	);
};
