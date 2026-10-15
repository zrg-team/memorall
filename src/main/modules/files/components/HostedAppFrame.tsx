/**
 * A hosted app (Spreadsheet, Documents, Presentation, Whiteboard, PDF) in a
 * frame, opened with one of the user's files. The app asks for files through
 * its Puter SDK; this answers from the library (see services/memon/apps/hosted).
 *
 * The file is the truth: when something else changes it (the agent, another
 * window), the app opens it again. Its own saves are known by their bytes and
 * do not reopen it.
 *
 * The app's AI (`puter.ai.chat`) is answered by the chat model chosen in
 * Memorall. An app with no AI of its own asks for Memorall's assistant, which
 * opens beside it.
 */
import { Loader2 } from "lucide-react";
import React, {
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/main/components/molecules/ThemeContext";
import { cn } from "@/lib/utils";
import { platform } from "@/platform/current";
import { serviceManager } from "@/services";
import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
import { toDocumentsSandboxPath } from "@/services/filesystem/sandbox-paths";
import { toFlowFileSystem } from "@/services/flow-service-adapters";
import { meterLlmService } from "@/services/model-usage/metered-llm";
import {
	createHostedAppAi,
	hostedAppUsageScope,
	hostedChatModel,
} from "@/services/memon/apps/hosted/ai";
import {
	createHostedAppBridge,
	HostedBridgeError,
	type HostedBridgeFiles,
} from "@/services/memon/apps/hosted/bridge";
import {
	HOSTED_APPS,
	type HostedAppId,
	hostedAppPagePath,
} from "@/services/memon/apps/hosted/catalog";
import { hostedBridgeFiles } from "@/services/memon/apps/hosted/flow-files";
import {
	hostMessage,
	type HostedHostMessage,
	isHostedFrameMessage,
} from "@/services/memon/apps/hosted/protocol";
import { logError } from "@/utils/logger";
import { changeTouches } from "../utils/change-touches";
import { HostedAssistantPanel } from "./HostedAssistantPanel";
import { HostedFilePicker, type HostedPickRequest } from "./HostedFilePicker";

export interface HostedAppFrameHandle {
	/** Lets the app save what it still holds, then resolves (or after a short wait). */
	requestClose(): Promise<void>;
}

interface HostedAppFrameProps {
	app: HostedAppId;
	/** The file it opens; null opens the app's own home. */
	path: string | null;
	/** Where the app keeps files it makes on its own ("Spreadsheets/…"). */
	home: string;
	className?: string;
	/** The app saved a file: the user's edit. */
	onWrite?: (path: string) => void;
	/** The app named its window (usually the open file). */
	onTitle?: (title: string) => void;
	/** The agent whose computer the app is on: its AI is charged to it. */
	agentId?: string | null;
}

/** How long a closing app may take to save before it goes anyway. */
const CLOSE_WAIT_MS = 3_000;
/** Changes land in bursts (a save, then its notice in other contexts). */
const CHANGE_SETTLE_MS = 250;

const digest = async (bytes: Uint8Array): Promise<string> => {
	const hash = await crypto.subtle.digest("SHA-256", bytes.slice());
	return Array.from(new Uint8Array(hash), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
};

/**
 * The library, with the app's saves quiet: the Files page does not redraw
 * its list under the editor, while other windows and the agent still hear of
 * them, as the text editor's saves do.
 */
const libraryFiles = (): HostedBridgeFiles => {
	const files = hostedBridgeFiles(toFlowFileSystem(documentFileSystemService));
	return {
		...files,
		async write(path, bytes) {
			await documentFileSystemService.writeFile(
				toDocumentsSandboxPath(path),
				bytes,
				"quiet",
			);
		},
	};
};

const HostedAppFrameView = React.forwardRef<
	HostedAppFrameHandle,
	HostedAppFrameProps
>(function HostedAppFrame(
	{ app, path, home, className, onWrite, onTitle, agentId = null },
	ref,
) {
	const { t } = useTranslation("documents");
	const { actualTheme } = useTheme();
	const frame = useRef<HTMLIFrameElement>(null);
	const [ready, setReady] = useState(false);
	const [reloads, setReloads] = useState(0);
	const [notice, setNotice] = useState<string | null>(null);
	const [assistantOpen, setAssistantOpen] = useState(false);
	// "Open from Memorall…": the request the picker answers.
	const [pick, setPick] = useState<{
		request: HostedPickRequest;
		resolve: (paths: string[] | null) => void;
	} | null>(null);
	const theme: "light" | "dark" = actualTheme === "dark" ? "dark" : "light";
	const themeRef = useRef(theme);
	themeRef.current = theme;
	const callbacks = useRef({ onWrite, onTitle });
	callbacks.current = { onWrite, onTitle };
	/** The file's bytes as last read or written by the app, by hash. */
	const known = useRef<string | null>(null);
	const pendingWrite = useRef<Promise<void>>(Promise.resolve());
	const exitWaiters = useRef(new Set<() => void>());
	const files = useMemo(libraryFiles, []);
	// Read at each request, so the bridge (and the app) need not start again
	// when the agent or file it is charged to changes.
	const charge = useRef({ app, path, agentId });
	charge.current = { app, path, agentId };
	const ai = useMemo(
		() =>
			createHostedAppAi(
				hostedChatModel(
					meterLlmService(serviceManager.llmService, () =>
						hostedAppUsageScope(charge.current),
					),
				),
			),
		[],
	);
	const src = platform.assets.url(hostedAppPagePath(app));
	const origin = window.location.origin;

	const post = useCallback(
		(message: HostedHostMessage, transfer: Transferable[] = []) => {
			frame.current?.contentWindow?.postMessage(message, origin, transfer);
		},
		[origin],
	);

	// One bridge per opening; a reload opens the file again.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `reloads` starts a new opening.
	useEffect(() => {
		setReady(false);
		const bridge = createHostedAppBridge({
			app,
			home,
			launchPath: path,
			files,
			onWrite: (written, bytes) => {
				if (written === path) {
					pendingWrite.current = digest(bytes).then((hash) => {
						known.current = hash;
					});
				}
				callbacks.current.onWrite?.(written);
			},
			pickFiles: (request) =>
				new Promise((resolve) => setPick({ request, resolve })),
			ai,
		});
		/** Requests still being answered, to stop when the app stops reading. */
		const running = new Map<number, AbortController>();
		const onMessage = (event: MessageEvent) => {
			if (!frame.current || event.source !== frame.current.contentWindow)
				return;
			if (event.origin !== origin || !isHostedFrameMessage(event.data)) return;
			const message = event.data;
			if (message.kind === "hello") {
				void (async () => {
					let launch = null;
					if (path) {
						const item = await bridge.launchItem().catch(() => null);
						if (item) launch = [item];
						const bytes = await files.read(path).catch(() => null);
						if (bytes) known.current = await digest(bytes);
					}
					post(
						hostMessage({
							kind: "init",
							init: {
								launch,
								home,
								user: { username: "you", uuid: "memorall-local" },
								theme: themeRef.current,
							},
						}),
					);
					setReady(true);
				})();
				return;
			}
			if (message.kind === "request") {
				const answering = new AbortController();
				running.set(message.id, answering);
				void bridge
					.handle(message.method, message.params, {
						signal: answering.signal,
						onPart: (part) =>
							post(hostMessage({ kind: "part", id: message.id, part })),
					})
					.then(({ result, transfer }) =>
						post(
							hostMessage({ kind: "response", id: message.id, result }),
							transfer,
						),
					)
					.catch((error: unknown) =>
						post(
							hostMessage({
								kind: "response",
								id: message.id,
								error: {
									message:
										error instanceof Error ? error.message : String(error),
									code:
										error instanceof HostedBridgeError ? error.code : "unknown",
								},
							}),
						),
					)
					.finally(() => running.delete(message.id));
				return;
			}
			if (message.event === "cancel") running.get(message.payload)?.abort();
			else if (message.event === "assistant") setAssistantOpen((open) => !open);
			else if (message.event === "title")
				callbacks.current.onTitle?.(message.payload);
			else if (message.event === "exit") {
				for (const resolve of exitWaiters.current) resolve();
				exitWaiters.current.clear();
			}
		};
		window.addEventListener("message", onMessage);
		return () => {
			window.removeEventListener("message", onMessage);
			for (const answering of running.values()) answering.abort();
		};
	}, [app, path, home, files, ai, origin, post, reloads]);

	// Something else changed the file: open it again (the app reads it anew).
	useEffect(() => {
		if (!path) return;
		const sandboxPath = toDocumentsSandboxPath(path);
		let timer: ReturnType<typeof setTimeout> | undefined;
		const check = async () => {
			await pendingWrite.current;
			const bytes = await files.read(path).catch(() => null);
			if (!bytes) return;
			const hash = await digest(bytes);
			if (hash === known.current) return;
			known.current = hash;
			setNotice(
				t("hostedApp.updated", { defaultValue: "Updated: the file changed." }),
			);
			setReloads((count) => count + 1);
		};
		const unsubscribe = documentFileSystemService.onFilesystemChanged(
			(change) => {
				if (!changeTouches(change, sandboxPath)) return;
				if (timer) clearTimeout(timer);
				timer = setTimeout(() => {
					void check().catch((error) =>
						logError("[HOSTED_APP] Could not check the file:", error),
					);
				}, CHANGE_SETTLE_MS);
			},
		);
		return () => {
			if (timer) clearTimeout(timer);
			unsubscribe();
		};
	}, [path, files, t]);

	useEffect(() => {
		if (ready)
			post(hostMessage({ kind: "event", event: "theme", payload: theme }));
	}, [theme, ready, post]);

	useEffect(() => {
		if (ready)
			post(
				hostMessage({
					kind: "event",
					event: "assistant",
					payload: assistantOpen,
				}),
			);
	}, [assistantOpen, ready, post]);

	useEffect(() => {
		if (!notice) return;
		const timer = setTimeout(() => setNotice(null), 2_500);
		return () => clearTimeout(timer);
	}, [notice]);

	useImperativeHandle(
		ref,
		() => ({
			requestClose: () =>
				ready
					? new Promise<void>((resolve) => {
							const done = () => {
								clearTimeout(timer);
								exitWaiters.current.delete(done);
								resolve();
							};
							const timer = setTimeout(done, CLOSE_WAIT_MS);
							exitWaiters.current.add(done);
							post(hostMessage({ kind: "event", event: "close" }));
						})
					: Promise.resolve(),
		}),
		[ready, post],
	);

	const name = HOSTED_APPS[app].name;
	return (
		<div className={cn("flex min-h-0 flex-1 bg-background", className)}>
			<div className="relative flex min-h-0 min-w-0 flex-1">
				<iframe
					// A new file is a new opening: the app starts again and says hello,
					// which the bridge for that file waits for.
					key={`${path ?? ""}#${reloads}`}
					ref={frame}
					src={src}
					title={path ? `${name} · ${path.split("/").pop()}` : name}
					className="h-full w-full flex-1 border-0"
					allow="clipboard-read; clipboard-write; fullscreen"
					data-hosted-app={app}
				/>
				{!ready ? (
					<div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/80 text-xs text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin" />
						{t("hostedApp.opening", {
							defaultValue: "Opening {{app}}…",
							app: name,
						})}
					</div>
				) : null}
				{notice ? (
					<div
						role="status"
						className="pointer-events-none absolute right-3 top-3 rounded-md border bg-card px-2.5 py-1 text-xs text-muted-foreground shadow-sm"
					>
						{notice}
					</div>
				) : null}
			</div>
			{assistantOpen && path ? (
				<HostedAssistantPanel
					// One conversation per file.
					key={path}
					app={app}
					path={path}
					ai={ai}
					onClose={() => setAssistantOpen(false)}
				/>
			) : null}
			<HostedFilePicker
				request={pick?.request ?? null}
				files={files}
				onDone={(paths) => {
					pick?.resolve(paths);
					setPick(null);
				}}
			/>
		</div>
	);
});

export const HostedAppFrame = React.memo(HostedAppFrameView);
