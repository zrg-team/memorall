import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Clapperboard, Loader2 } from "lucide-react";
import { parseHyperframesReference } from "@/services/flows-integrations/tools/hyperframes/reference";
import type { ArtifactProps } from "./ArtifactActionsMenu";
import { safeFilenameBase } from "./hyperframes/composition-html";
import {
	type HyperframesExport,
	HyperframesPlayer,
} from "./hyperframes/HyperframesPlayer";
import { saveHyperframesRender } from "./hyperframes/hyperframes-renders";
import { useHyperframesComposition } from "./hyperframes/use-hyperframes-composition";

/**
 * Whether the preview is near the screen (mount it) and on it (let it play).
 * Previews start unmounted, so a conversation with many videos only loads
 * the ones the user scrolls to.
 */
const useOnScreen = (ref: React.RefObject<HTMLElement | null>) => {
	const [state, setState] = useState(() => ({
		seen: typeof IntersectionObserver === "undefined",
		visible: typeof IntersectionObserver === "undefined",
	}));
	useEffect(() => {
		const element = ref.current;
		if (!element || typeof IntersectionObserver === "undefined") return;
		const near = new IntersectionObserver(
			([entry]) => {
				if (entry?.isIntersecting) {
					setState((current) =>
						current.seen ? current : { ...current, seen: true },
					);
				}
			},
			{ rootMargin: "400px 0px 400px 0px" },
		);
		const on = new IntersectionObserver(
			([entry]) => {
				const visible = Boolean(
					entry?.isIntersecting && entry.intersectionRatio >= 0.2,
				);
				setState((current) =>
					current.visible === visible ? current : { ...current, visible },
				);
			},
			{ threshold: [0, 0.2, 0.6] },
		);
		near.observe(element);
		on.observe(element);
		return () => {
			near.disconnect();
			on.disconnect();
		};
	}, [ref]);
	return state;
};

export const HyperframesArtifact: React.FC<ArtifactProps> = ({
	content,
	identifier,
	title,
	projectPath,
	onMessageAction,
}) => {
	const { t } = useTranslation("chat");
	const frameRef = useRef<HTMLDivElement>(null);
	const { seen, visible } = useOnScreen(frameRef);
	const reference = useMemo(
		() => parseHyperframesReference(content),
		[content],
	);
	const source = useHyperframesComposition({
		content,
		projectPath,
		enabled: seen,
	});
	const savePath =
		source.status === "ready" ? source.projectPath : reference?.path;
	const filenameBase = safeFilenameBase(title || identifier);
	const ratio =
		source.width && source.height ? source.width / source.height : 16 / 9;

	const keepExport = useCallback(
		async ({ blob }: HyperframesExport) =>
			savePath ? saveHyperframesRender(savePath, blob) : undefined,
		[savePath],
	);

	const reportIssues = useCallback(
		(errors: string[]) => {
			void onMessageAction?.({
				type: "artifact.preview.error.report",
				component: "hyperframes",
				title,
				identifier,
				payload: { errors },
			});
		},
		[identifier, onMessageAction, title],
	);

	const heading = (
		<span className="inline-flex min-w-0 items-center gap-2 text-xs font-medium text-white/80">
			<Clapperboard className="h-3.5 w-3.5 shrink-0" />
			<span className="truncate">
				{title || t("hyperframesPreview.compositionAriaLabel")}
			</span>
		</span>
	);

	return (
		<div ref={frameRef} className="my-2">
			{source.status === "ready" ? (
				<HyperframesPlayer
					composition={source.composition}
					title={title}
					filenameBase={filenameBase}
					aspectRatio={ratio}
					active={visible}
					onExported={keepExport}
					onReportIssues={onMessageAction ? reportIssues : undefined}
					toolbarStart={heading}
				/>
			) : (
				<div className="overflow-hidden rounded-md bg-black">
					<div className="flex min-h-12 items-center border-b border-white/10 px-3 py-2">
						{heading}
					</div>
					<div
						className="mx-auto flex w-full items-center justify-center p-4 text-center text-xs text-white/60"
						style={{
							aspectRatio: String(ratio),
							maxHeight: "60vh",
							maxWidth: `calc(60vh * ${ratio})`,
						}}
					>
						{source.status === "error" ? (
							<span className="text-red-200">
								{t("hyperframesPreview.loadFailed", { error: source.error })}
							</span>
						) : (
							<Loader2 className="h-5 w-5 animate-spin" />
						)}
					</div>
				</div>
			)}
		</div>
	);
};
