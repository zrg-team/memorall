import {
	ArrowLeft,
	Clapperboard,
	Download,
	FileVideo,
	Loader2,
	Play,
	RefreshCw,
} from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
	HyperframesPlayer,
	type HyperframesExport,
	type HyperframesExportRequest,
} from "@/main/modules/chat/components/artifacts/hyperframes/HyperframesPlayer";
import { safeFilenameBase } from "@/main/modules/chat/components/artifacts/hyperframes/composition-html";
import { saveHyperframesRender } from "@/main/modules/chat/components/artifacts/hyperframes/hyperframes-renders";
import { useHyperframesComposition } from "@/main/modules/chat/components/artifacts/hyperframes/use-hyperframes-composition";
import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
import { toDocumentsSandboxPath } from "@/services/filesystem/sandbox-paths";
import {
	HYPERFRAMES_REFERENCE_KIND,
	serializeHyperframesReference,
} from "@/services/flows-integrations/tools/hyperframes/reference";
import { memonDisplayPath } from "@/services/memon/constants";
import { memonMimeType } from "@/services/memon/file-kinds";
import type {
	MemonVideoProject,
	MemonVideoState,
} from "@/services/memon/types";
import { MEMON_APP_TINTS } from "../MemonWindowFrame";
import type { MemonSend } from "../types";

const loadClient = () =>
	import("@/services/memon/memon-client").then((module) => module.memonClient);

const baseName = (path: string) =>
	path.split("/").filter(Boolean).pop() ?? path;

const seconds = (value: number) =>
	`${Number.isInteger(value) ? value : value.toFixed(1)}s`;

const facts = (project: Partial<MemonVideoProject>): string =>
	[
		project.width && project.height ? `${project.width}×${project.height}` : "",
		project.duration ? seconds(project.duration) : "",
	]
		.filter(Boolean)
		.join(" · ");

const downloadFile = async (path: string) => {
	const bytes = await documentFileSystemService.readFile(
		toDocumentsSandboxPath(path),
	);
	const url = URL.createObjectURL(
		new Blob([bytes.slice()], { type: memonMimeType(path) }),
	);
	const link = document.createElement("a");
	link.href = url;
	link.download = baseName(path);
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 30_000);
};

/** A video file from Files, as an object URL for a <video>. */
const useFileUrl = (path: string | null) => {
	const [state, setState] = React.useState<{
		url: string | null;
		error: string | null;
	}>({ url: null, error: null });
	React.useEffect(() => {
		setState({ url: null, error: null });
		if (!path) return;
		let cancelled = false;
		let url: string | null = null;
		void documentFileSystemService
			.readFile(toDocumentsSandboxPath(path))
			.then((bytes) => {
				if (cancelled) return;
				url = URL.createObjectURL(
					new Blob([bytes.slice()], { type: memonMimeType(path) }),
				);
				setState({ url, error: null });
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setState({
						url: null,
						error: error instanceof Error ? error.message : String(error),
					});
				}
			});
		return () => {
			cancelled = true;
			if (url) URL.revokeObjectURL(url);
		};
	}, [path]);
	return state;
};

const VideoFile: React.FC<{ path: string }> = ({ path }) => {
	const { t } = useTranslation("common");
	const { url, error } = useFileUrl(path);
	if (error) {
		return (
			<div className="flex flex-1 items-center justify-center p-4 text-xs text-red-300">
				{error}
			</div>
		);
	}
	if (!url) {
		return (
			<div className="flex flex-1 items-center justify-center text-white/60">
				<Loader2 className="h-5 w-5 animate-spin" />
			</div>
		);
	}
	return (
		// biome-ignore lint/a11y/useMediaCaption: exported videos have no captions to offer
		<video
			key={url}
			src={url}
			controls
			autoPlay
			playsInline
			className="h-full min-h-0 w-full flex-1 object-contain"
			aria-label={t("memonComputer.video.playing", { name: baseName(path) })}
		/>
	);
};

const ProjectList: React.FC<{
	machineKey: string;
	home: string;
	send: MemonSend;
}> = ({ machineKey, home, send }) => {
	const { t } = useTranslation("common");
	const [projects, setProjects] = React.useState<MemonVideoProject[] | null>(
		null,
	);
	const [opening, setOpening] = React.useState<string | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [version, setVersion] = React.useState(0);

	React.useEffect(() => {
		let live = true;
		void loadClient()
			.then((client) => client.request("video.projects", { key: machineKey }))
			.then((found) => {
				if (live) setProjects(found ?? []);
			})
			.catch(() => {
				if (live) setProjects([]);
			});
		return () => {
			live = false;
		};
	}, [machineKey, version]);

	// New projects and renders show up while the list is open.
	React.useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const unsubscribe = documentFileSystemService.onFilesystemChanged(() => {
			clearTimeout(timer);
			timer = setTimeout(() => setVersion((value) => value + 1), 600);
		});
		return () => {
			clearTimeout(timer);
			unsubscribe();
		};
	}, []);

	const open = async (path: string) => {
		setOpening(path);
		setError(null);
		try {
			await send("video.open", { key: machineKey, path }, { rethrow: true });
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setOpening(null);
		}
	};

	return (
		<div
			data-testid="memon-video-projects"
			className="flex h-full min-h-0 flex-col bg-background text-foreground"
		>
			<div className="flex shrink-0 items-start gap-3 px-4 pb-3 pt-4">
				<span
					className={cn(
						"flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
						MEMON_APP_TINTS.video,
					)}
				>
					<Clapperboard size={18} />
				</span>
				<div className="min-w-0 flex-1">
					<h2 className="text-sm font-semibold">
						{t("memonComputer.video.title")}
					</h2>
					<p className="text-xs leading-snug text-muted-foreground">
						{t("memonComputer.video.subtitle")}
					</p>
				</div>
				<button
					type="button"
					onClick={() => setVersion((value) => value + 1)}
					aria-label={t("memonComputer.video.refresh")}
					title={t("memonComputer.video.refresh")}
					className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
				>
					<RefreshCw size={14} />
				</button>
			</div>
			{error ? (
				<p
					role="alert"
					className="mx-4 mb-2 rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-700 dark:text-red-300"
				>
					{error}
				</p>
			) : null}
			<div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
				{projects === null ? (
					<div className="grid gap-3 @md:grid-cols-2" aria-hidden="true">
						<div className="h-24 animate-pulse rounded-lg bg-muted" />
						<div className="h-24 animate-pulse rounded-lg bg-muted/60" />
					</div>
				) : projects.length === 0 ? (
					<div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-xs text-muted-foreground">
						<Clapperboard size={22} />
						<p>{t("memonComputer.video.empty")}</p>
					</div>
				) : (
					<ul className="grid gap-3 @md:grid-cols-2 @3xl:grid-cols-3">
						{projects.map((project) => (
							<li key={project.path}>
								<button
									type="button"
									data-testid="memon-video-project"
									onClick={() => void open(project.path)}
									disabled={opening !== null}
									className="group flex w-full flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left hover:border-foreground/30 hover:bg-accent/40 disabled:cursor-progress disabled:opacity-70"
								>
									<span className="flex items-center gap-2">
										<span
											className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-black text-white"
											style={
												project.width && project.height
													? {
															aspectRatio: `${project.width} / ${project.height}`,
															height: "2rem",
															width: "auto",
														}
													: undefined
											}
										>
											{opening === project.path ? (
												<Loader2 size={13} className="animate-spin" />
											) : (
												<Play size={13} />
											)}
										</span>
										<span className="min-w-0 flex-1">
											<span className="block truncate text-[13px] font-medium">
												{project.name}
											</span>
											<span className="block truncate text-[11px] text-muted-foreground">
												{memonDisplayPath(project.path, home)}
											</span>
										</span>
									</span>
									<span className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
										<span>{facts(project)}</span>
										<span>
											{t("memonComputer.video.renderCount", {
												count: project.renders.length,
											})}
										</span>
									</span>
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
};

const OpenProject: React.FC<{
	machineKey: string;
	state: MemonVideoState & { path: string };
	home: string;
	send: MemonSend;
}> = ({ machineKey, state, home, send }) => {
	const { t } = useTranslation("common");
	const path = state.path;
	const [watching, setWatching] = React.useState<string | null>(null);
	const content = React.useMemo(
		() =>
			serializeHyperframesReference({
				kind: HYPERFRAMES_REFERENCE_KIND,
				path,
				revision: "",
			}),
		[path],
	);
	const source = useHyperframesComposition({ content, projectPath: path });
	const name = state.name ?? baseName(path);
	const ratio =
		(source.status === "ready" && source.width && source.height
			? source.width / source.height
			: state.width && state.height
				? state.width / state.height
				: undefined) ?? 16 / 9;

	const exportRequest = React.useMemo<HyperframesExportRequest | undefined>(
		() =>
			state.exportRequest
				? {
						id: state.exportRequest.id,
						settings: {
							...(state.exportRequest.fps
								? { fps: state.exportRequest.fps }
								: {}),
							...(state.exportRequest.quality
								? { quality: state.exportRequest.quality }
								: {}),
							...(state.exportRequest.size
								? { size: state.exportRequest.size }
								: {}),
						},
					}
				: undefined,
		[state.exportRequest],
	);

	const keepExport = React.useCallback(
		async ({ blob, requestId }: HyperframesExport) => {
			const saved = await saveHyperframesRender(path, blob);
			void send("video.exported", { key: machineKey, path: saved, requestId });
			return saved;
		},
		[machineKey, path, send],
	);

	const requestStarted = React.useCallback(
		(requestId: number) => {
			void loadClient().then((client) =>
				client.request("video.exportStarted", { key: machineKey, requestId }),
			);
		},
		[machineKey],
	);

	const requestFailed = React.useCallback(
		(requestId: number, error: string) => {
			void loadClient().then((client) =>
				client.request("video.exportFailed", {
					key: machineKey,
					requestId,
					error,
				}),
			);
		},
		[machineKey],
	);

	const back = (
		<button
			type="button"
			onClick={() => void send("video.close", { key: machineKey })}
			className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-white/15 bg-white/10 px-2 text-xs font-medium text-white hover:bg-white/15"
			title={t("memonComputer.video.allProjects")}
		>
			<ArrowLeft size={13} />
			<span className="hidden @md:inline">
				{t("memonComputer.video.allProjects")}
			</span>
		</button>
	);
	const heading = (
		<span className="flex min-w-0 items-center gap-2">
			{back}
			<span className="min-w-0">
				<span className="block truncate text-xs font-medium text-white">
					{name}
				</span>
				<span className="block truncate text-[10px] text-white/55">
					{[memonDisplayPath(path, home), facts(state)]
						.filter(Boolean)
						.join(" · ")}
				</span>
			</span>
		</span>
	);

	return (
		<div
			data-testid="memon-video-project-open"
			className="flex h-full min-h-0 flex-col bg-black"
		>
			<div className="flex min-h-0 flex-1 flex-col">
				{watching ? (
					<>
						<div className="flex min-h-12 shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2">
							<button
								type="button"
								onClick={() => setWatching(null)}
								className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/15 bg-white/10 px-2 text-xs font-medium text-white hover:bg-white/15"
							>
								<ArrowLeft size={13} />
								<span>{t("memonComputer.video.backToComposition")}</span>
							</button>
							<span className="truncate text-xs text-white/70">
								{baseName(watching)}
							</span>
						</div>
						<VideoFile path={watching} />
					</>
				) : source.status === "ready" ? (
					<HyperframesPlayer
						composition={source.composition}
						title={name}
						filenameBase={safeFilenameBase(name)}
						aspectRatio={ratio}
						layout="fill"
						autoplay
						onExported={keepExport}
						exportRequest={exportRequest}
						onExportRequestStarted={requestStarted}
						onExportRequestFailed={requestFailed}
						toolbarStart={heading}
					/>
				) : (
					<>
						<div className="flex min-h-12 shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2">
							{heading}
						</div>
						<div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-white/60">
							{source.status === "error" ? (
								<span className="text-red-300">{source.error}</span>
							) : (
								<Loader2 className="h-5 w-5 animate-spin" />
							)}
						</div>
					</>
				)}
			</div>
			{state.renders.length > 0 ? (
				<div className="shrink-0 border-t border-white/10 bg-black px-3 py-2">
					<div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-white/50">
						{t("memonComputer.video.renders")}
					</div>
					<ul className="flex gap-2 overflow-x-auto pb-1">
						{state.renders.map((render) => (
							<li
								key={render}
								className={cn(
									"flex shrink-0 items-center gap-1 rounded-md border bg-white/5 pl-2 text-xs text-white/85",
									watching === render ? "border-white/40" : "border-white/10",
								)}
							>
								<FileVideo size={13} className="shrink-0 text-white/60" />
								<button
									type="button"
									onClick={() => setWatching(render)}
									className="max-w-[14rem] truncate py-1.5 hover:text-white"
									title={memonDisplayPath(render, home)}
								>
									{baseName(render)}
								</button>
								<button
									type="button"
									onClick={() => void downloadFile(render)}
									className="rounded-r-md px-2 py-1.5 text-white/60 hover:bg-white/10 hover:text-white"
									title={t("memonComputer.video.download")}
									aria-label={t("memonComputer.video.download")}
								>
									<Download size={13} />
								</button>
							</li>
						))}
					</ul>
				</div>
			) : null}
		</div>
	);
};

const OpenVideo: React.FC<{
	machineKey: string;
	path: string;
	home: string;
	send: MemonSend;
}> = ({ machineKey, path, home, send }) => {
	const { t } = useTranslation("common");
	return (
		<div className="flex h-full min-h-0 flex-col bg-black">
			<div className="flex min-h-12 shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2">
				<button
					type="button"
					onClick={() => void send("video.close", { key: machineKey })}
					className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/15 bg-white/10 px-2 text-xs font-medium text-white hover:bg-white/15"
				>
					<ArrowLeft size={13} />
					<span>{t("memonComputer.video.allProjects")}</span>
				</button>
				<span className="min-w-0 flex-1 truncate text-xs text-white/70">
					{memonDisplayPath(path, home)}
				</span>
				<button
					type="button"
					onClick={() => void downloadFile(path)}
					className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/15 bg-white/10 px-2 text-xs font-medium text-white hover:bg-white/15"
				>
					<Download size={13} />
					<span>{t("memonComputer.video.download")}</span>
				</button>
			</div>
			<VideoFile path={path} />
		</div>
	);
};

/**
 * The Video app: HyperFrames projects to pick from, then the one picked
 * playing in the HyperFrames player, with MP4 export into its renders folder
 * (for the user's click or the agent's request) and its renders to play.
 * Video files play as they are.
 */
const VideoWindowView: React.FC<{
	machineKey: string;
	state: MemonVideoState | undefined;
	home: string;
	send: MemonSend;
}> = ({ machineKey, state, home, send }) => (
	<div className="@container flex min-h-0 flex-1 flex-col overflow-hidden">
		{state?.status === "open" && state.path ? (
			state.kind === "video" ? (
				<OpenVideo
					machineKey={machineKey}
					path={state.path}
					home={home}
					send={send}
				/>
			) : (
				<OpenProject
					machineKey={machineKey}
					state={{ ...state, path: state.path }}
					home={home}
					send={send}
				/>
			)
		) : (
			<ProjectList machineKey={machineKey} home={home} send={send} />
		)}
	</div>
);

/** Renders only when its slice of the machine changes: the store keeps unchanged slices by reference. */
export const VideoWindow = React.memo(VideoWindowView);
