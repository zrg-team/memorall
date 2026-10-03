import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { type ITheme, Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import React from "react";
import { useTheme } from "@/main/components/molecules/ThemeContext";
import { terminalRunsInFront } from "@/services/memon/terminal/terminal-state";
import type { MemonTerminalState } from "@/services/memon/types";
import type { MemonSend } from "../../types";
import {
	editLine,
	emptyLineEditor,
	type LineEditorEffect,
	type LineEditorState,
	lineEditorView,
} from "./line-editor";
import { parseTerminalInput } from "./terminal-keys";
import { TerminalScreen } from "./terminal-screen";
import {
	graphemes,
	renderPromptLine,
	renderSuggestions,
	stripControls,
} from "./terminal-text";

const FONT_FAMILY = '"IBM Plex Mono", ui-monospace, monospace';
const FONT_SIZE = 12;
/** A line sent stays on screen this long for the tab's lines to bring it. */
const ECHO_GRACE_MS = 400;

/** Colors as the computer's other windows have them (light and dark). */
const THEMES: Record<"light" | "dark", ITheme> = {
	light: {
		background: "#f5f5f5",
		foreground: "#171717",
		cursor: "#171717",
		cursorAccent: "#f5f5f5",
		selectionBackground: "#bfdbfe",
		scrollbarSliderBackground: "rgba(0, 0, 0, 0.18)",
		scrollbarSliderHoverBackground: "rgba(0, 0, 0, 0.3)",
		scrollbarSliderActiveBackground: "rgba(0, 0, 0, 0.4)",
		black: "#171717",
		red: "#dc2626",
		green: "#059669",
		yellow: "#b45309",
		blue: "#0369a1",
		magenta: "#9333ea",
		cyan: "#0e7490",
		white: "#737373",
		brightBlack: "#737373",
		brightRed: "#ef4444",
		brightGreen: "#10b981",
		brightYellow: "#d97706",
		brightBlue: "#0284c7",
		brightMagenta: "#a855f7",
		brightCyan: "#0891b2",
		brightWhite: "#a3a3a3",
	},
	dark: {
		background: "#262626",
		foreground: "#fafafa",
		cursor: "#fafafa",
		cursorAccent: "#262626",
		selectionBackground: "#3b5a8a",
		scrollbarSliderBackground: "rgba(255, 255, 255, 0.18)",
		scrollbarSliderHoverBackground: "rgba(255, 255, 255, 0.3)",
		scrollbarSliderActiveBackground: "rgba(255, 255, 255, 0.4)",
		black: "#404040",
		red: "#f87171",
		green: "#34d399",
		yellow: "#fbbf24",
		blue: "#38bdf8",
		magenta: "#c084fc",
		cyan: "#22d3ee",
		white: "#e5e5e5",
		brightBlack: "#a3a3a3",
		brightRed: "#fca5a5",
		brightGreen: "#6ee7b7",
		brightYellow: "#fcd34d",
		brightBlue: "#7dd3fc",
		brightMagenta: "#d8b4fe",
		brightCyan: "#67e8f9",
		brightWhite: "#ffffff",
	},
};

const errorText = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/** A localhost link as the computer's Browser opens it. */
const browserUrl = (uri: string): string | null => {
	try {
		const url = new URL(uri);
		if (["0.0.0.0", "127.0.0.1", "[::1]"].includes(url.hostname)) {
			url.hostname = "localhost";
		}
		return url.toString();
	} catch {
		return null;
	}
};

/** The text of the screen row under the pointer, with the rows it wraps onto. */
const rowTextAt = (term: Terminal, clientY: number): string => {
	const screen = term.element?.querySelector(".xterm-screen");
	if (!screen) return "";
	const rect = screen.getBoundingClientRect();
	if (!rect.height) return "";
	const row = Math.floor(((clientY - rect.top) / rect.height) * term.rows);
	if (row < 0 || row >= term.rows) return "";
	const buffer = term.buffer.active;
	let start = buffer.viewportY + row;
	let end = start;
	while (start > 0 && buffer.getLine(start)?.isWrapped) start -= 1;
	while (buffer.getLine(end + 1)?.isWrapped) end += 1;
	let text = "";
	for (let index = start; index <= end; index += 1) {
		text += buffer.getLine(index)?.translateToString(true) ?? "";
	}
	return text.trim();
};

export interface XtermTerminalHandle {
	focus(): void;
}

/**
 * The Terminal's screen, in xterm.js: output as a terminal shows it, and the
 * line typed after the prompt edited the way a shell edits it. Enter runs the
 * line; while a command runs in the tab it is typed into it instead, and
 * Ctrl+C stops it.
 */
export const XtermTerminal = React.forwardRef<
	XtermTerminalHandle,
	{
		machineKey: string;
		terminal: MemonTerminalState;
		/** The agent's home, shown as `~` in the prompt. */
		home: string;
		send: MemonSend;
	}
>(({ machineKey, terminal, home, send }, ref) => {
	const { actualTheme } = useTheme();
	const hostRef = React.useRef<HTMLDivElement>(null);
	const termRef = React.useRef<Terminal | null>(null);
	const screenRef = React.useRef<TerminalScreen | null>(null);
	// What the handlers below read: always the latest props.
	const live = React.useRef({ machineKey, terminal, home, send, actualTheme });
	live.current = { machineKey, terminal, home, send, actualTheme };
	/** Each tab's line being typed, as a shell keeps one per tab. */
	const editors = React.useRef(new Map<string, LineEditorState>());
	/** Commands sent that have not answered yet: no prompt until they do. */
	const waiting = React.useRef(0);
	/** Lines entered while waiting, run (or typed) once it is over. */
	const typeAhead = React.useRef<string[]>([]);
	const completing = React.useRef(false);

	React.useImperativeHandle(ref, () => ({
		focus: () => termRef.current?.focus(),
	}));

	const handlers = React.useMemo(() => {
		const tabId = () => live.current.terminal.activeTabId;
		const editor = () => editors.current.get(tabId()) ?? emptyLineEditor();
		const runningHere = () => terminalRunsInFront(live.current.terminal);
		const takesInput = () => runningHere() || waiting.current > 0;

		/** The prompt and line as the tab now has them. */
		const syncInput = () => {
			const { terminal } = live.current;
			screenRef.current?.setInput({
				promptCwd: takesInput() ? null : terminal.cwd,
				view: lineEditorView(editor(), terminal.history ?? []),
			});
		};

		/** Draws the tab's lines and the line being typed. */
		const sync = () => {
			const screen = screenRef.current;
			if (!screen) return;
			const { terminal, home } = live.current;
			screen.batch(() => {
				screen.setHome(home);
				screen.setSource({
					key: `${terminal.activeTabId}:${terminal.screenId ?? 0}`,
					lines: terminal.lines,
					offset: terminal.lineOffset ?? 0,
				});
				syncInput();
			});
		};

		/** Sends a line; it stays on screen (with any error) once that is over. */
		const track = (echo: number, sent: Promise<void>, after?: () => void) => {
			sent
				.then(() => {
					setTimeout(() => screenRef.current?.settleEcho(echo), ECHO_GRACE_MS);
				})
				.catch((error) => screenRef.current?.settleEcho(echo, errorText(error)))
				.finally(() => after?.());
		};

		const runTypeAhead = () => {
			if (waiting.current > 0) return;
			const next = typeAhead.current.shift();
			if (next !== undefined) submit(next);
		};

		const submit = (line: string) => {
			const screen = screenRef.current;
			const { terminal, machineKey: key, home, send } = live.current;
			if (!screen) return;
			if (waiting.current > 0) {
				typeAhead.current.push(line);
				return;
			}
			if (runningHere()) {
				const echo = screen.echo("input", line, terminal.cwd);
				track(
					echo,
					send("terminal.input", { key, text: line }, { rethrow: true }),
				);
				return;
			}
			const command = line.trim();
			if (!command || command === "exit") {
				screen.print(renderPromptLine(terminal.cwd, home, line));
				// `exit` ends the shell: its tab closes (the last one is cleared).
				if (command === "exit") {
					void send("terminal.close", {
						key,
						terminalId: terminal.activeTabId,
					});
				}
				return;
			}
			const echo = screen.echo("command", line, terminal.cwd);
			waiting.current += 1;
			track(
				echo,
				send(
					"terminal.exec",
					{ key, command: line, terminalId: terminal.activeTabId },
					{ rethrow: true },
				),
				() => {
					waiting.current -= 1;
					syncInput();
					runTypeAhead();
				},
			);
		};

		const interrupt = (line: string) => {
			const { terminal, machineKey: key, home, send } = live.current;
			typeAhead.current = [];
			if (takesInput()) {
				void send("terminal.stop", { key });
				return;
			}
			screenRef.current?.print(
				renderPromptLine(terminal.cwd, home, `${line}^C`),
			);
		};

		/** Tab: completes the line before the cursor, else lists the matches. */
		const complete = async (before: string, after: string) => {
			if (completing.current) return;
			completing.current = true;
			const { machineKey: key } = live.current;
			const tab = tabId();
			try {
				const { memonClient } = await import("@/services/memon/memon-client");
				const result = await memonClient.request("terminal.complete", {
					key,
					line: before,
					terminalId: tab,
				});
				const state = editors.current.get(tab) ?? emptyLineEditor();
				// Typed on meanwhile, or another tab: the answer is too late.
				if (
					tabId() !== tab ||
					state.chars.slice(0, state.cursor).join("") !== before ||
					state.chars.slice(state.cursor).join("") !== after
				) {
					return;
				}
				const screen = screenRef.current;
				if (result.line !== before) {
					const head = graphemes(result.line);
					editors.current.set(tab, {
						...state,
						chars: [...head, ...graphemes(after)],
						cursor: head.length,
						historyIndex: null,
					});
					syncInput();
				} else if (result.suggestions.length && screen && termRef.current) {
					const { terminal, home } = live.current;
					const line = before + after;
					screen.print(
						`${
							takesInput()
								? `${stripControls(line)}\r\n`
								: renderPromptLine(terminal.cwd, home, line)
						}${renderSuggestions(result.suggestions, termRef.current.cols)}`,
					);
				}
			} catch {
				// Nothing to complete with.
			} finally {
				completing.current = false;
			}
		};

		const effect = (entry: LineEditorEffect) => {
			const { terminal, machineKey: key, home, send } = live.current;
			switch (entry.type) {
				case "submit":
					return submit(entry.line);
				case "interrupt":
					return interrupt(entry.line);
				case "complete":
					return void complete(entry.before, entry.after);
				case "clearScreen":
					return void send("terminal.clear", {
						key,
						terminalId: terminal.activeTabId,
					});
				case "eof":
					if (takesInput()) return;
					screenRef.current?.print(
						renderPromptLine(terminal.cwd, home, "exit"),
					);
					return void send("terminal.close", {
						key,
						terminalId: terminal.activeTabId,
					});
				case "scroll":
					return termRef.current?.scrollPages(entry.pages);
			}
		};

		/** Keys from xterm.js, through the line editor. */
		const onData = (data: string) => {
			const screen = screenRef.current;
			if (!screen) return;
			screen.batch(() => {
				for (const key of parseTerminalInput(data)) {
					const tab = tabId();
					const result = editLine(editor(), key, {
						history: live.current.terminal.history ?? [],
						stdin: takesInput(),
					});
					editors.current.set(tab, result.state);
					for (const entry of result.effects) effect(entry);
				}
				// After the effects: a line sent hides the prompt until it answers.
				syncInput();
			});
		};

		const openLink = (_event: MouseEvent, uri: string) => {
			const url = browserUrl(uri);
			const { machineKey: key, send } = live.current;
			if (url) void send("browser.navigate", { key, url, newTab: true });
		};

		return { sync, onData, openLink };
	}, []);

	// One xterm.js terminal for the window's life; the tabs share it.
	React.useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		let disposed = false;
		const term = new Terminal({
			fontFamily: FONT_FAMILY,
			fontSize: FONT_SIZE,
			lineHeight: 1.25,
			cursorBlink: true,
			cursorStyle: "bar",
			cursorInactiveStyle: "outline",
			scrollback: 5000,
			theme: THEMES[live.current.actualTheme],
			drawBoldTextInBrightColors: false,
			// Right-click is Ask in chat's: it keeps the selection as it is.
			rightClickSelectsWord: false,
		});
		const fit = new FitAddon();
		term.loadAddon(fit);
		term.loadAddon(new WebLinksAddon(handlers.openLink));
		const screen = new TerminalScreen(term, live.current.home);
		termRef.current = term;
		screenRef.current = screen;

		// Copy and paste as a terminal has them: Ctrl+C copies a selection
		// (else it stops the command), Ctrl+Shift+C always; Ctrl+V pastes.
		term.attachCustomKeyEventHandler((event) => {
			if (event.type !== "keydown") return true;
			const key = event.key.toLowerCase();
			const modifier = event.ctrlKey || event.metaKey;
			if (
				modifier &&
				key === "c" &&
				(event.shiftKey || event.metaKey || term.hasSelection())
			) {
				const text = term.getSelection();
				if (text)
					void navigator.clipboard?.writeText(text).catch(() => undefined);
				if (!event.metaKey) term.clearSelection();
				event.preventDefault();
				return false;
			}
			// The browser pastes; xterm.js reads the paste.
			if (modifier && key === "v") return false;
			return true;
		});
		const data = term.onData(handlers.onData);
		// What is selected, for Ask in chat.
		const selection = term.onSelectionChange(() => {
			const text = term.getSelection();
			if (text) host.dataset.memonAskSelection = text;
			else delete host.dataset.memonAskSelection;
		});
		// The row right-clicked, for Ask in chat; a prompt's row is its command.
		const onContextMenu = (event: MouseEvent) => {
			const text = rowTextAt(term, event.clientY);
			const command = /^user@memon:[^$]*\$ ?(.*)$/.exec(text);
			const ask = command ? (command[1] ? `$ ${command[1]}` : "") : text;
			if (ask) host.dataset.memonAsk = ask;
			else delete host.dataset.memonAsk;
		};
		host.addEventListener("contextmenu", onContextMenu);

		const fitToHost = () => {
			if (disposed || !term.element) return;
			const size = fit.proposeDimensions();
			if (!size || !(size.cols >= 2) || !(size.rows >= 1)) return;
			if (size.cols === term.cols && size.rows === term.rows) return;
			const wider = size.cols !== term.cols;
			term.resize(size.cols, size.rows);
			// Rows wrap at the new width: everything is drawn again.
			if (wider) screen.redraw();
		};
		let frame = 0;
		const observer =
			typeof ResizeObserver === "undefined"
				? null
				: new ResizeObserver(() => {
						cancelAnimationFrame(frame);
						frame = requestAnimationFrame(fitToHost);
					});
		observer?.observe(host);

		// Measured in its font: opened once the font is there.
		const fonts = typeof document === "undefined" ? undefined : document.fonts;
		const fontReady = fonts?.load
			? fonts.load(`${FONT_SIZE}px "IBM Plex Mono"`).catch(() => undefined)
			: Promise.resolve();
		void fontReady.then(() => {
			if (disposed) return;
			term.open(host);
			fitToHost();
			handlers.sync();
		});

		return () => {
			disposed = true;
			cancelAnimationFrame(frame);
			observer?.disconnect();
			host.removeEventListener("contextmenu", onContextMenu);
			data.dispose();
			selection.dispose();
			screen.dispose();
			term.dispose();
			termRef.current = null;
			screenRef.current = null;
		};
	}, [handlers]);

	React.useEffect(() => {
		if (termRef.current) termRef.current.options.theme = THEMES[actualTheme];
	}, [actualTheme]);

	// The machine's state: new lines, another tab, the prompt's directory.
	// biome-ignore lint/correctness/useExhaustiveDependencies: sync reads the latest terminal and home; it runs when they change.
	React.useEffect(() => {
		handlers.sync();
	}, [handlers, terminal, home]);

	return (
		<div
			className="min-h-0 flex-1 overflow-hidden rounded px-2 py-1.5"
			style={{ background: THEMES[actualTheme].background }}
		>
			<div
				ref={hostRef}
				data-memon-ref="t1"
				data-testid="memon-terminal-screen"
				className="h-full w-full"
			/>
		</div>
	);
});
XtermTerminal.displayName = "XtermTerminal";
