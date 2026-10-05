import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { type ITheme, Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { FolderOpen, ShieldAlert, Square } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useTheme } from "@/main/components/molecules/ThemeContext";
import { Button } from "@/main/components/ui/button";
import type { MemonPiCodeOutput } from "@/services/memon/operation-types";
import type {
	MemonPiCodeApproval,
	MemonPiCodeState,
} from "@/services/memon/types";
import type { MemonSend } from "../types";
import { PiCodeFolderPicker } from "./PiCodeFolderPicker";

const FONT_FAMILY = '"IBM Plex Mono", ui-monospace, monospace';
const FONT_SIZE = 12;
/** How long one read waits on the machine for output to arrive. */
const READ_WAIT_MS = 1_500;
const RETRY_MS = 400;
/** Shift+Enter as pi reads it (CSI u): xterm.js sends a plain CR otherwise. */
const SHIFT_ENTER = "\x1b[13;2u";

/** pi's own dark and light backgrounds (its themes' page colors). */
const THEMES: Record<"light" | "dark", ITheme> = {
	dark: {
		background: "#18181e",
		foreground: "#d4d4d4",
		cursor: "#d4d4d4",
		cursorAccent: "#18181e",
		selectionBackground: "#3a3a4a",
		scrollbarSliderBackground: "rgba(255, 255, 255, 0.18)",
		scrollbarSliderHoverBackground: "rgba(255, 255, 255, 0.3)",
		scrollbarSliderActiveBackground: "rgba(255, 255, 255, 0.4)",
	},
	light: {
		background: "#f8f8f8",
		foreground: "#1f1f1f",
		cursor: "#1f1f1f",
		cursorAccent: "#f8f8f8",
		selectionBackground: "#d0d0e0",
		scrollbarSliderBackground: "rgba(0, 0, 0, 0.18)",
		scrollbarSliderHoverBackground: "rgba(0, 0, 0, 0.3)",
		scrollbarSliderActiveBackground: "rgba(0, 0, 0, 0.4)",
	},
};

const loadClient = () =>
	import("@/services/memon/memon-client").then((module) => module.memonClient);

/** A localhost link as the computer's Browser opens it. */
const localUrl = (uri: string): string | null => {
	try {
		const url = new URL(uri);
		if (
			!["localhost", "0.0.0.0", "127.0.0.1", "[::1]"].includes(url.hostname)
		) {
			return null;
		}
		url.hostname = "localhost";
		return url.toString();
	} catch {
		return null;
	}
};

/**
 * MemonOS Bot asks to hand pi code work: shown on top of the window, in
 * amber so it stands out, until the user answers. Declined, the agent codes
 * it itself (and remembers not to ask again).
 */
const PiCodeApprovalCard: React.FC<{
	approval: MemonPiCodeApproval;
	onAnswer: (decision: "approve" | "deny") => void;
}> = ({ approval, onAnswer }) => {
	const { t } = useTranslation("common");
	const titleId = React.useId();
	return (
		<div
			role="alertdialog"
			aria-labelledby={titleId}
			data-testid="memon-pi-code-approval"
			className="m-2 mb-0 shrink-0 space-y-2 rounded-lg border-2 border-amber-400 bg-amber-50 px-3 py-2.5 text-xs shadow-[0_0_0_4px_rgba(251,191,36,0.3)] dark:bg-amber-950"
		>
			<div
				id={titleId}
				className="flex items-center gap-2 font-semibold text-amber-900 dark:text-amber-100"
			>
				<span className="relative flex h-2.5 w-2.5 shrink-0">
					<span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 motion-safe:animate-ping" />
					<span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
				</span>
				<ShieldAlert size={14} className="shrink-0" />
				{t("memonComputer.piCode.approvalTitle")}
			</div>
			<p className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-md bg-white/80 px-2 py-1.5 font-mono text-[11px] text-foreground dark:bg-black/30">
				{approval.task}
			</p>
			<div className="flex flex-wrap items-center gap-2">
				<span className="min-w-0 flex-1 text-[11px] leading-snug text-amber-900/80 dark:text-amber-100/80">
					{t("memonComputer.piCode.approvalHint")}
				</span>
				<Button
					type="button"
					size="sm"
					variant="outline"
					className="h-7 text-[11px]"
					onClick={() => onAnswer("deny")}
				>
					{t("memonComputer.piCode.deny")}
				</Button>
				<Button
					type="button"
					size="sm"
					className="h-7 bg-amber-500 text-[11px] text-amber-950 hover:bg-amber-400"
					onClick={() => onAnswer("approve")}
				>
					{t("memonComputer.piCode.approve")}
				</Button>
			</div>
		</div>
	);
};

/**
 * pi code: the pi coding agent's own terminal UI, drawn by xterm.js.
 *
 * Opened by the user, the window first asks which folder pi opens in (the
 * folder picker); the folder button over pi opens another one later, and
 * pi moves there. pi runs in the computer, not here: this window attaches
 * with its size,
 * streams pi's screen output and sends raw keys. Closing the window quits
 * pi; leaving the page or collapsing the panel only detaches the view, and
 * the next view redraws pi's screen in full. When MemonOS Bot asks to hand
 * pi work, the question waits on top of the window for the user. While pi
 * works, Stop ends its turn (as Escape in pi does) and MemonOS Bot, waiting
 * on pi, hears that the user stopped it.
 */
export const PiCodeWindow: React.FC<{
	machineKey: string;
	state: MemonPiCodeState | undefined;
	/** The agent's home, shown as `~`. */
	home: string;
	/** Window in front: keys go to pi. */
	focused: boolean;
	send: MemonSend;
}> = ({ machineKey, state, home, focused, send }) => {
	const { t } = useTranslation("common");
	const { actualTheme } = useTheme();
	const hostRef = React.useRef<HTMLDivElement>(null);
	const termRef = React.useRef<Terminal | null>(null);
	const live = React.useRef({ machineKey, actualTheme, send });
	live.current = { machineKey, actualTheme, send };
	const [connected, setConnected] = React.useState(false);
	const status = state?.status;
	/** A new start of pi (/resume, another folder) needs attaching again. */
	const instance = state?.instance;
	/** The folder picker, over pi or its error, to open another folder. */
	const [picking, setPicking] = React.useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new start of pi closes the picker.
	React.useEffect(() => {
		setPicking(false);
	}, [instance]);

	// One xterm.js terminal per start of pi, attached while it runs.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reconnects when pi (re)starts, even too fast to see "starting"; other inputs are read through `live`.
	React.useEffect(() => {
		const host = hostRef.current;
		if (!host || status !== "running") return;
		let disposed = false;
		const key = live.current.machineKey;
		const term = new Terminal({
			fontFamily: FONT_FAMILY,
			fontSize: FONT_SIZE,
			lineHeight: 1.15,
			cursorBlink: false,
			cursorStyle: "bar",
			cursorInactiveStyle: "none",
			scrollback: 10_000,
			theme: THEMES[live.current.actualTheme],
			drawBoldTextInBrightColors: false,
			rightClickSelectsWord: false,
		});
		const fit = new FitAddon();
		term.loadAddon(fit);
		term.loadAddon(
			new WebLinksAddon((_event, uri) => {
				const local = localUrl(uri);
				if (local) {
					void live.current.send("browser.navigate", {
						key,
						url: local,
						newTab: true,
					});
				} else {
					window.open(uri, "_blank", "noopener,noreferrer");
				}
			}),
		);
		termRef.current = term;

		// Keys go out in order, batched while one send is on its way.
		let pending = "";
		let sending = false;
		const flushInput = async () => {
			if (sending || !pending) return;
			sending = true;
			const data = pending;
			pending = "";
			try {
				const client = await loadClient();
				await client.request("piCode.input", { key, data });
			} catch {
				// pi stopped; the read loop notices.
			} finally {
				sending = false;
				if (pending && !disposed) void flushInput();
			}
		};
		const sendInput = (data: string) => {
			pending += data;
			void flushInput();
		};

		// Copy and paste as a terminal has them: Ctrl+C copies a selection
		// (else it reaches pi), Ctrl+Shift+C always; Ctrl+V is the browser's
		// paste, which pi receives bracketed. Shift+Enter is pi's new line.
		term.attachCustomKeyEventHandler((event) => {
			if (event.type !== "keydown") return true;
			const keyName = event.key.toLowerCase();
			const modifier = event.ctrlKey || event.metaKey;
			if (
				modifier &&
				keyName === "c" &&
				(event.shiftKey || event.metaKey || term.hasSelection())
			) {
				const text = term.getSelection();
				if (text)
					void navigator.clipboard?.writeText(text).catch(() => undefined);
				if (!event.metaKey) term.clearSelection();
				event.preventDefault();
				return false;
			}
			if (modifier && keyName === "v") return false;
			if (keyName === "enter" && event.shiftKey && !modifier && !event.altKey) {
				event.preventDefault();
				sendInput(SHIFT_ENTER);
				return false;
			}
			return true;
		});
		const data = term.onData(sendInput);
		const selection = term.onSelectionChange(() => {
			const text = term.getSelection();
			if (text) host.dataset.memonAskSelection = text;
			else delete host.dataset.memonAskSelection;
		});

		let resizeTimer: ReturnType<typeof setTimeout> | undefined;
		const fitToHost = () => {
			if (disposed || !term.element) return;
			const size = fit.proposeDimensions();
			if (!size || !(size.cols >= 2) || !(size.rows >= 1)) return;
			if (size.cols === term.cols && size.rows === term.rows) return;
			term.resize(size.cols, size.rows);
			clearTimeout(resizeTimer);
			resizeTimer = setTimeout(() => {
				void loadClient()
					.then((client) =>
						client.request("piCode.resize", {
							key,
							columns: term.cols,
							rows: term.rows,
						}),
					)
					.catch(() => undefined);
			}, 80);
		};
		let frame = 0;
		const observer =
			typeof ResizeObserver === "undefined"
				? null
				: new ResizeObserver(() => {
						cancelAnimationFrame(frame);
						frame = requestAnimationFrame(fitToHost);
					});

		/** Attaches, then writes pi's output until pi stops or the window goes. */
		const stream = async () => {
			const client = await loadClient();
			let cursor: number | null = null;
			while (!disposed && cursor === null) {
				const attached = await client
					.request("piCode.attach", {
						key,
						columns: term.cols,
						rows: term.rows,
						theme: live.current.actualTheme,
					})
					.catch(() => null);
				if (attached) {
					cursor = attached.cursor;
				} else {
					await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
				}
			}
			if (disposed || cursor === null) return;
			let readFrom: number = cursor;
			term.reset();
			setConnected(true);
			term.focus();
			while (!disposed) {
				const output: MemonPiCodeOutput | null = await client
					.request("piCode.read", {
						key,
						cursor: readFrom,
						waitMs: READ_WAIT_MS,
					})
					.catch(() => null);
				if (disposed) return;
				if (!output) {
					await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
					continue;
				}
				if (output.reset) term.reset();
				if (output.data) term.write(output.data);
				readFrom = output.cursor;
				if (output.closed) {
					setConnected(false);
					return;
				}
			}
		};

		// Measured in its font: opened once the font is there.
		const fonts = typeof document === "undefined" ? undefined : document.fonts;
		const fontReady = fonts?.load
			? fonts.load(`${FONT_SIZE}px "IBM Plex Mono"`).catch(() => undefined)
			: Promise.resolve();
		void fontReady.then(() => {
			if (disposed) return;
			term.open(host);
			const size = fit.proposeDimensions();
			if (size && size.cols >= 2 && size.rows >= 1)
				term.resize(size.cols, size.rows);
			observer?.observe(host);
			void stream();
		});

		return () => {
			disposed = true;
			setConnected(false);
			clearTimeout(resizeTimer);
			cancelAnimationFrame(frame);
			observer?.disconnect();
			data.dispose();
			selection.dispose();
			term.dispose();
			termRef.current = null;
		};
	}, [status, instance]);

	// The theme follows the app's: xterm's colors here, pi's colors in pi
	// (pi redraws in its other theme; the read loop replays it).
	const attachedTheme = React.useRef<"light" | "dark" | null>(null);
	React.useEffect(() => {
		const term = termRef.current;
		if (!term || !connected) return;
		term.options.theme = THEMES[actualTheme];
		if (attachedTheme.current === null) {
			attachedTheme.current = actualTheme;
			return;
		}
		if (attachedTheme.current === actualTheme) return;
		attachedTheme.current = actualTheme;
		void loadClient()
			.then((client) =>
				client.request("piCode.attach", {
					key: machineKey,
					columns: term.cols,
					rows: term.rows,
					theme: actualTheme,
				}),
			)
			.catch(() => undefined);
	}, [actualTheme, machineKey, connected]);

	React.useEffect(() => {
		if (focused && connected && !picking) termRef.current?.focus();
	}, [focused, connected, picking]);

	const approval = state?.approval;
	const choosing = status === "choosing";
	const notice = choosing
		? null
		: status === "error"
			? t("memonComputer.piCode.error", { error: state?.error ?? "" })
			: status === "idle"
				? t("memonComputer.piCode.waiting")
				: status !== "running" || !connected
					? t("memonComputer.piCode.starting")
					: null;
	const closePicker = () => {
		setPicking(false);
		termRef.current?.focus();
	};

	return (
		<div
			className={cn(
				"flex min-h-0 flex-1 flex-col overflow-hidden",
				approval && "ring-2 ring-inset ring-amber-400",
			)}
			style={{ background: THEMES[actualTheme].background }}
		>
			{approval ? (
				<PiCodeApprovalCard
					approval={approval}
					onAnswer={(decision) =>
						void send("piCode.approval", {
							key: machineKey,
							id: approval.id,
							decision,
						})
					}
				/>
			) : null}
			<div className="relative min-h-0 flex-1 px-2 py-1.5">
				<div
					ref={hostRef}
					data-memon-ref="p1"
					data-testid="memon-pi-code-screen"
					className="h-full w-full"
				/>
				{choosing || picking ? (
					<div className="absolute inset-0 z-20">
						<PiCodeFolderPicker
							machineKey={machineKey}
							home={home}
							send={send}
							focused={focused}
							current={status === "running" ? state?.cwd : undefined}
							onCancel={picking ? closePicker : undefined}
							onOpened={() => setPicking(false)}
						/>
					</div>
				) : null}
				{notice ? (
					<div
						role="status"
						className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center font-mono text-xs text-muted-foreground"
					>
						{notice}
						{status === "error" ? (
							<Button
								type="button"
								size="sm"
								variant="outline"
								className="h-7 gap-1.5 font-sans text-[11px]"
								onClick={() => setPicking(true)}
							>
								<FolderOpen size={12} />
								{t("memonComputer.piCode.chooseFolder")}
							</Button>
						) : null}
					</div>
				) : state?.working ? (
					<button
						type="button"
						data-testid="memon-pi-code-stop"
						title={t("memonComputer.piCode.stopHint")}
						onClick={() => {
							void send("piCode.stop", { key: machineKey });
							termRef.current?.focus();
						}}
						className="absolute right-3 top-2 z-10 inline-flex h-6 items-center gap-1 rounded-md border border-input bg-background/90 px-2 text-[11px] font-medium text-foreground shadow-sm hover:bg-accent"
					>
						<Square size={10} />
						{t("memonComputer.piCode.stop")}
					</button>
				) : connected && !picking ? (
					<button
						type="button"
						data-testid="memon-pi-code-open-folder-button"
						title={t("memonComputer.piCode.openFolder")}
						aria-label={t("memonComputer.piCode.openFolder")}
						onClick={() => setPicking(true)}
						className="absolute right-3 top-2 z-10 inline-flex h-6 w-6 items-center justify-center rounded-md border border-input bg-background/90 text-muted-foreground opacity-70 shadow-sm hover:bg-accent hover:text-foreground hover:opacity-100"
					>
						<FolderOpen size={12} />
					</button>
				) : null}
			</div>
		</div>
	);
};
