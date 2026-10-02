import type React from "react";
import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { platform } from "@/platform/current";
import { usePreparedArtifactHtml } from "./local-asset-html";

const FRAME_PAGE = "sandbox/pages/html-artifact.html";
/**
 * Its place among manifest.base.json's sandbox pages. Extension builds rename
 * those to sandbox/page-N.html, and only the listed copy gets the sandbox
 * policy; the same file at its own path is an ordinary page that blocks the
 * artifact's scripts.
 */
export const FRAME_PAGE_INDEX = 1;

const framePageUrl = (): string =>
	platform.assets.sandboxPageUrl(FRAME_PAGE, FRAME_PAGE_INDEX);

/**
 * An HTML artifact, shown the way it was written: its scripts and handlers
 * run, and the images it takes from Files show.
 *
 * It used to be an `srcDoc` iframe, which takes the extension page's policy,
 * so no script in any artifact ran (galleries, charts, tabs, animated bars).
 * The page is shown by html-artifact.html instead, a sandbox page with its
 * own origin: the artifact can run, and cannot reach the extension.
 */
export const HtmlArtifactFrame: React.FC<{
	html: string;
	projectPath?: string;
	title: string;
	className?: string;
	style?: React.CSSProperties;
}> = ({ html, projectPath, title, className, style }) => {
	const prepared = usePreparedArtifactHtml(html, projectPath);
	const frameRef = useRef<HTMLIFrameElement>(null);

	// Before the frame loads: it asks for the page as soon as it is ready.
	useLayoutEffect(() => {
		if (!prepared.ready) return;
		const onMessage = (event: MessageEvent) => {
			const frame = frameRef.current?.contentWindow;
			if (!frame || event.source !== frame) return;
			if (event.data?.type !== "memorall-html-artifact:ready") return;
			frame.postMessage(
				{
					type: "memorall-html-artifact:render",
					html: prepared.html,
					assets: prepared.assets,
				},
				"*",
			);
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [prepared]);

	if (!prepared.ready) {
		return (
			<div
				className={cn(className, "animate-pulse bg-muted/40")}
				style={style}
			/>
		);
	}
	return (
		<iframe
			// A new frame per page: the frame shows one page, once.
			key={prepared.version}
			ref={frameRef}
			src={framePageUrl()}
			sandbox="allow-scripts allow-popups allow-forms allow-modals"
			className={className}
			style={{ border: "none", ...style }}
			title={title}
		/>
	);
};
