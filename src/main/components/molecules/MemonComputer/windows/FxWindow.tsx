import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { type ITheme, Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { FolderOpen } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/main/components/molecules/ThemeContext";
import { Button } from "@/main/components/ui/button";
import type { MemonFxOutput } from "@/services/memon/operation-types";
import type { MemonFxState } from "@/services/memon/types";
import type { MemonSend } from "../types";
import { CodeFolderPicker } from "./CodeFolderPicker";

const FONT_FAMILY = '"IBM Plex Mono", ui-monospace, monospace';
const FONT_SIZE = 12;
/** How long one read waits on the machine for output to arrive. */
const READ_WAIT_MS = 1_500;
const RETRY_MS = 400;

const THEMES: Record<"light" | "dark", ITheme> = {
	dark: {
		background: "#121212",
		foreground: "#e4e4e4",
		cursor: "#e4e4e4",
		cursorAccent: "#121212",
		selectionBackground: "#3a3a3a",
		scrollbarSliderBackground: "rgba(255, 255, 255, 0.18)",
		scrollbarSliderHoverBackground: "rgba(255, 255, 255, 0.3)",
		scrollbarSliderActiveBackground: "rgba(255, 255, 255, 0.4)",
	},
	light: {
		background: "#fafafa",
		foreground: "#1a1a1a",
		cursor: "#1a1a1a",
		cursorAccent: "#fafafa",
		selectionBackground: "#d4d4d8",
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
 * Keys xterm.js sends plainly that fx reads as their own sequences (CSI u):
 * Shift+Enter for a new line, and Cmd with Backspace, the arrows and
 * A/C/X/Z. The same as libfx's xterm adapter does.
 */
export const fxKeySequence = (event: KeyboardEvent): string | null => {
	if (event.type !== "keydown" || event.altKey || event.ctrlKey) return null;
	if (event.key === "Enter" && event.shiftKey && !event.metaKey)
		return "\x1b[13;2u";
	if (!event.metaKey) return null;
	const modifiers = 8 | (event.shiftKey ? 1 : 0);
	if (event.key === "Backspace") return `\x1b[127;${modifiers + 1}u`;
	const arrow = (
		{ ArrowUp: "A", ArrowDown: "B", ArrowRight: "C", ArrowLeft: "D" } as Record<
			string,
			string
		>
	)[event.key];
	if (arrow) return `\x1b[1;${modifiers + 1}${arrow}`;
	const shortcut = ({ a: 97, c: 99, x: 120, z: 122 } as Record<string, number>)[
		event.key.toLowerCase()
	];
	return shortcut ? `\x1b[${shortcut};${modifiers + 1}u` : null;
};

/**
 * fx: Vercel's fx coding agent, its own terminal drawn by xterm.js.
 *
 * fx runs in the computer, not here: this window attaches with its size,
 * replays fx's output from the start (fx prints inline and cannot redraw),
 * follows it and sends raw keys. It opens on a folder picker, as pi code's
 * does, and the folder button over fx moves it to another folder. Closing the
 * window quits fx; leaving the page or collapsing the panel only detaches the
 * view.
 */
const FxWindowView: React.FC<{
	machineKey: string;
	state: MemonFxState | undefined;
	/** The agent's home, where the folder picker starts. */
	home: string;
	/** Window in front: keys go to fx. */
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
	/** A new start of fx needs attaching again. */
	const instance = state?.instance;
	/** The folder picker, over fx or its error, to open another folder. */
	const [picking, setPicking] = React.useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new start of fx closes the picker.
	React.useEffect(() => {
		setPicking(false);
	}, [instance]);

	// One xterm.js terminal per start of fx, attached while it runs.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reconnects when fx (re)starts; other inputs are read through `live`.
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
			const data = pending;
			pending = "";
			sending = true;
			try {
				await (await loadClient()).request("fx.input", { key, data });
			} catch {
				// fx stopped; the read loop notices.
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
		// (else it reaches fx, which stops what runs), Ctrl+Shift+C always;
		// Ctrl+V is the browser's paste, which fx receives bracketed.
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
			const sequence = fxKeySequence(event);
			if (sequence === null) return true;
			event.preventDefault();
			sendInput(sequence);
			return false;
		});
		const data = term.onData(sendInput);
		const selection = term.onSelectionChange(() => {
			const text = term.getSelection();
			if (text) host.dataset.memonAskSelection = text;
			else delete host.dataset.memonAskSelection;
		});

		// A plain click reaches fx as a mouse click (SGR), unless fx tracks the
		// mouse itself, as libfx's xterm adapter does.
		let pointerDown: { id: number; x: number; y: number } | null = null;
		const onPointerDown = (event: PointerEvent) => {
			if (event.button === 0)
				pointerDown = {
					id: event.pointerId,
					x: event.clientX,
					y: event.clientY,
				};
		};
		const onPointerUp = (event: PointerEvent) => {
			const start = pointerDown;
			pointerDown = null;
			if (!start || event.button !== 0 || event.pointerId !== start.id) return;
			if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey)
				return;
			const dx = event.clientX - start.x;
			const dy = event.clientY - start.y;
			if (dx * dx + dy * dy > 16 || term.hasSelection()) return;
			if (term.modes.mouseTrackingMode !== "none") return;
			const screen = term.element?.querySelector(".xterm-screen");
			const rect = screen?.getBoundingClientRect();
			if (!rect || rect.width <= 0 || rect.height <= 0) return;
			if (event.clientX < rect.left || event.clientX >= rect.right) return;
			if (event.clientY < rect.top || event.clientY >= rect.bottom) return;
			const column = Math.min(
				term.cols,
				Math.floor(((event.clientX - rect.left) * term.cols) / rect.width) + 1,
			);
			const row = Math.min(
				term.rows,
				Math.floor(((event.clientY - rect.top) * term.rows) / rect.height) + 1,
			);
			sendInput(`\x1b[<0;${column};${row}M\x1b[<0;${column};${row}m`);
		};

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
						client.request("fx.resize", {
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

		/** Attaches, then writes fx's output until fx stops or the window goes. */
		const stream = async () => {
			const client = await loadClient();
			let cursor: number | null = null;
			while (!disposed && cursor === null) {
				const attached = await client
					.request("fx.attach", { key, columns: term.cols, rows: term.rows })
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
				const output: MemonFxOutput | null = await client
					.request("fx.read", { key, cursor: readFrom, waitMs: READ_WAIT_MS })
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
			term.element?.addEventListener("pointerdown", onPointerDown);
			term.element?.addEventListener("pointerup", onPointerUp);
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
			term.element?.removeEventListener("pointerdown", onPointerDown);
			term.element?.removeEventListener("pointerup", onPointerUp);
			data.dispose();
			selection.dispose();
			term.dispose();
			termRef.current = null;
		};
	}, [status, instance]);

	// The theme follows the app's, on the terminal attached now.
	React.useEffect(() => {
		const term = termRef.current;
		if (term && connected) term.options.theme = THEMES[actualTheme];
	}, [actualTheme, connected]);

	React.useEffect(() => {
		if (focused && connected && !picking) termRef.current?.focus();
	}, [focused, connected, picking]);

	const choosing = status === "choosing";
	const notice = choosing
		? null
		: status === "error"
			? t("memonComputer.fx.error", { error: state?.error ?? "" })
			: status !== "running" || !connected
				? t("memonComputer.fx.starting")
				: null;
	const closePicker = () => {
		setPicking(false);
		termRef.current?.focus();
	};

	return (
		<div
			className="flex min-h-0 flex-1 flex-col overflow-hidden"
			style={{ background: THEMES[actualTheme].background }}
		>
			<div className="relative min-h-0 flex-1 px-2 py-1.5">
				<div
					ref={hostRef}
					data-memon-ref="x1"
					data-testid="memon-fx-screen"
					className="h-full w-full"
				/>
				{choosing || picking ? (
					<div className="absolute inset-0 z-20">
						<CodeFolderPicker
							app="fx"
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
								{t("memonComputer.fx.chooseFolder")}
							</Button>
						) : null}
					</div>
				) : connected && !picking && !state?.working ? (
					<button
						type="button"
						data-testid="memon-fx-open-folder-button"
						title={t("memonComputer.fx.openFolder")}
						aria-label={t("memonComputer.fx.openFolder")}
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

/** Renders only when its slice of the machine changes: the store keeps unchanged slices by reference. */
export const FxWindow = React.memo(FxWindowView);
