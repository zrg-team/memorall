import { useEffect, useMemo, useState } from "react";
import {
	documentFileSystemService,
	type FilesystemChangeEvent,
} from "@/services/filesystem/document-filesystem";
import {
	normalizeSandboxPath,
	toDocumentsSandboxPath,
} from "@/services/filesystem/sandbox-paths";
import {
	HYPERFRAMES_RENDERS_FOLDER,
	hyperframesCompositionInfo,
	hyperframesRevision,
	parseHyperframesReference,
} from "@/services/flows-integrations/tools/hyperframes/reference";
import {
	type NormalizedComposition,
	normalizeHyperframesHtml,
} from "./composition-html";

export type HyperframesCompositionState =
	| { status: "loading"; width?: number; height?: number }
	| {
			status: "ready";
			composition: NormalizedComposition;
			/** The composition as written, before its images were inlined. */
			html: string;
			/** The folder its relative assets resolve against. */
			projectPath?: string;
			width?: number;
			height?: number;
			duration?: number;
	  }
	| { status: "error"; error: string; width?: number; height?: number };

// Normalising reads every image the composition uses from Files: keep the
// last few, so scrolling a preview back into view or reopening a window does
// not read them again.
const CACHE_LIMIT = 6;
const prepared = new Map<string, Promise<NormalizedComposition>>();

const cacheKey = (html: string, projectPath?: string) =>
	`${projectPath ?? ""}\u0000${hyperframesRevision(html)}`;

export const prepareHyperframesComposition = (
	html: string,
	projectPath?: string,
): Promise<NormalizedComposition> => {
	const key = cacheKey(html, projectPath);
	const cached = prepared.get(key);
	if (cached) {
		prepared.delete(key);
		prepared.set(key, cached);
		return cached;
	}
	const next = normalizeHyperframesHtml(html, projectPath).catch((error) => {
		prepared.delete(key);
		throw error;
	});
	prepared.set(key, next);
	while (prepared.size > CACHE_LIMIT) {
		const oldest = prepared.keys().next().value;
		if (oldest === undefined) break;
		prepared.delete(oldest);
	}
	return next;
};

/** Drops a project's prepared compositions: its files changed. */
const forgetProject = (projectPath: string) => {
	const prefix = `${projectPath}\u0000`;
	for (const key of [...prepared.keys()]) {
		if (key.startsWith(prefix)) prepared.delete(key);
	}
};

export const readHyperframesComposition = async (
	projectPath: string,
): Promise<string> => {
	const bytes = await documentFileSystemService.readFile(
		toDocumentsSandboxPath(`${projectPath.replace(/\/+$/, "")}/index.html`),
	);
	return new TextDecoder().decode(bytes);
};

const changedPaths = (change: FilesystemChangeEvent): string[] => {
	const own = [change.path, change.oldPath, change.newPath].filter(
		(path): path is string => Boolean(path),
	);
	return [...own, ...(change.changes ?? []).flatMap(changedPaths)];
};

/**
 * Whether a change touches what the preview shows: the project's files, but
 * not the MP4s exported into its renders folder.
 */
export const changeTouchesProject = (
	change: FilesystemChangeEvent | null,
	projectPath: string,
): boolean => {
	// A change without details may be anything.
	if (!change) return true;
	const root = normalizeSandboxPath(projectPath).replace(/\/+$/, "");
	const renders = `${root}/${HYPERFRAMES_RENDERS_FOLDER}/`;
	const paths = changedPaths(change).map((path) => normalizeSandboxPath(path));
	if (paths.length === 0) return true;
	return paths.some(
		(path) =>
			(path === root || path.startsWith(`${root}/`)) &&
			!path.startsWith(renders),
	);
};

/**
 * What a HyperFrames preview plays: the project's index.html, read from Files
 * when the content is a project reference (`hyperframes_show`), or the HTML
 * itself for older messages and `render_artifact`. Follows the project while
 * `watch` is on, so an agent's edit shows without another preview.
 */
export const useHyperframesComposition = ({
	content,
	projectPath,
	enabled = true,
	watch = true,
}: {
	content: string;
	projectPath?: string;
	enabled?: boolean;
	watch?: boolean;
}): HyperframesCompositionState => {
	const reference = useMemo(
		() => parseHyperframesReference(content),
		[content],
	);
	const sourcePath = reference?.path ?? projectPath;
	const [version, setVersion] = useState(0);
	const [state, setState] = useState<HyperframesCompositionState>(() => ({
		status: "loading",
		width: reference?.width,
		height: reference?.height,
	}));

	useEffect(() => {
		if (!enabled || !watch || !sourcePath) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const unsubscribe = documentFileSystemService.onFilesystemChanged(
			(change) => {
				if (!changeTouchesProject(change, sourcePath)) return;
				clearTimeout(timer);
				timer = setTimeout(() => {
					forgetProject(sourcePath);
					setVersion((value) => value + 1);
				}, 300);
			},
		);
		return () => {
			clearTimeout(timer);
			unsubscribe();
		};
	}, [enabled, watch, sourcePath]);

	useEffect(() => {
		if (!enabled) return;
		let cancelled = false;
		void (async () => {
			try {
				const html = reference
					? await readHyperframesComposition(reference.path)
					: content;
				const info = hyperframesCompositionInfo(html);
				const composition = await prepareHyperframesComposition(
					html,
					sourcePath,
				);
				if (cancelled) return;
				setState((previous) =>
					previous.status === "ready" && previous.composition === composition
						? previous
						: {
								status: "ready",
								composition,
								html,
								projectPath: sourcePath,
								width: info.width ?? reference?.width,
								height: info.height ?? reference?.height,
								duration: info.duration ?? reference?.duration,
							},
				);
			} catch (error) {
				if (cancelled) return;
				setState({
					status: "error",
					error: error instanceof Error ? error.message : String(error),
					width: reference?.width,
					height: reference?.height,
				});
			}
		})();
		return () => {
			cancelled = true;
		};
		// `version` re-reads the project after it changed.
	}, [content, enabled, reference, sourcePath, version]);

	return state;
};
