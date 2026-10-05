/**
 * Interactive mode for the coding agent.
 * Handles TUI rendering and user interaction, delegating business logic to AgentSession.
 *
 * Vendored from @mariozechner/pi-coding-agent 0.73.1 (MIT, see ../../../LICENSE).
 * Browser port: the TUI runs on whatever Terminal the app passes (an xterm.js
 * view streamed from the Memon machine), and quitting hands control back to
 * the app instead of exiting the process. Layout, key handling, the submit
 * handler, the agent event renderer, queues, compaction and retry indicators,
 * ! bash and the built-in commands follow pi's InteractiveMode. Left out:
 * extension UI, model/settings/session selectors, OAuth login, the session
 * tree, external editor, clipboard images, changelog and update checks.
 */

import type { AgentMessage } from "@/services/memon/apps/pi-code/agent";
import type {
	AssistantMessage,
	Message,
} from "@/services/memon/apps/pi-code/ai";
import {
	type AutocompleteFileSystem,
	CombinedAutocompleteProvider,
	type Component,
	Container,
	type Keybinding,
	Loader,
	Markdown,
	type MarkdownTheme,
	SelectList,
	type SlashCommand,
	Spacer,
	setKeybindings,
	type Terminal,
	Text,
	TruncatedText,
	TUI,
} from "@/services/memon/apps/pi-code/tui";
import type { AgentSession, AgentSessionEvent } from "../../core/agent-session";
import { parseSkillBlock } from "../../core/agent-session";
import type { FooterDataProvider } from "../../core/footer-data-provider";
import type { AppKeybinding, KeybindingsManager } from "../../core/keybindings";
import { createCompactionSummaryMessage } from "../../core/messages";
import type { SessionContext, SessionInfo } from "../../core/session-manager";
import { BUILTIN_SLASH_COMMANDS } from "../../core/slash-commands";
import type { TruncationResult } from "../../core/tools/truncate";
import { AssistantMessageComponent } from "./components/assistant-message";
import { BashExecutionComponent } from "./components/bash-execution";
import { BranchSummaryMessageComponent } from "./components/branch-summary-message";
import { CompactionSummaryMessageComponent } from "./components/compaction-summary-message";
import { CountdownTimer } from "./components/countdown-timer";
import { CustomEditor } from "./components/custom-editor";
import { CustomMessageComponent } from "./components/custom-message";
import { DynamicBorder } from "./components/dynamic-border";
import { FooterComponent } from "./components/footer";
import { keyHint, keyText, rawKeyHint } from "./components/keybinding-hints";
import { SkillInvocationMessageComponent } from "./components/skill-invocation-message";
import { ToolExecutionComponent } from "./components/tool-execution";
import { UserMessageComponent } from "./components/user-message";
import {
	getEditorTheme,
	getMarkdownTheme,
	getSelectListTheme,
	theme,
} from "./theme/theme";

/** Interface for components that can be expanded/collapsed */
interface Expandable {
	setExpanded(expanded: boolean): void;
}

function isExpandable(obj: unknown): obj is Expandable {
	return (
		typeof obj === "object" &&
		obj !== null &&
		"setExpanded" in obj &&
		typeof obj.setExpanded === "function"
	);
}

class ExpandableText extends Text implements Expandable {
	constructor(
		private readonly getCollapsedText: () => string,
		private readonly getExpandedText: () => string,
		expanded = false,
		paddingX = 0,
		paddingY = 0,
	) {
		super(
			expanded ? getExpandedText() : getCollapsedText(),
			paddingX,
			paddingY,
		);
	}

	setExpanded(expanded: boolean): void {
		this.setText(expanded ? this.getExpandedText() : this.getCollapsedText());
	}
}

type CompactionQueuedMessage = {
	text: string;
	mode: "steer" | "followUp";
};

/**
 * Options for InteractiveMode initialization.
 */
export interface InteractiveModeOptions {
	/** Shown after the logo in the header. */
	version: string;
	keybindings: KeybindingsManager;
	footerData: FooterDataProvider;
	/** File system for path completion and @-mentions. */
	autocompleteFileSystem: AutocompleteFileSystem | null;
	/** Lines shown under the header (where the model and files come from). */
	onboarding?: string;
	/** How to change the model, shown by /model and the model keys. */
	describeModelChange?: string;
	/** The user quit (/quit, Ctrl+C twice, Ctrl+D on an empty editor). */
	onQuit: () => void;
	/**
	 * Where pi keeps every folder's sessions (~/.pi/agent/sessions): /sessions
	 * and /resume list them all. Without it, only this folder's.
	 */
	sessionsDir?: string;
	/** /resume picked a saved session: the app starts pi again on it, in `cwd`. */
	onResume?: (sessionFile: string, cwd: string) => void;
}

/** How long ago, as a session list shows it. */
const ago = (date: Date): string => {
	const minutes = Math.max(
		0,
		Math.round((Date.now() - date.getTime()) / 60_000),
	);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.round(hours / 24)}d ago`;
};

/** A saved session's name, or its first prompt on one line. */
const sessionTitle = (info: SessionInfo): string =>
	info.name ?? info.firstMessage.replace(/\s+/g, " ").trim();

export class InteractiveMode {
	readonly ui: TUI;
	private chatContainer: Container;
	private pendingMessagesContainer: Container;
	private statusContainer: Container;
	private defaultEditor: CustomEditor;
	private editor: CustomEditor;
	private editorContainer: Container;
	private footer: FooterComponent;
	private footerDataProvider: FooterDataProvider;
	private keybindings: KeybindingsManager;
	private isInitialized = false;
	private loadingAnimation: Loader | undefined = undefined;
	private workingMessage: string | undefined = undefined;
	private workingVisible = true;
	private readonly defaultWorkingMessage = "Working...";
	private readonly defaultHiddenThinkingLabel = "Thinking...";
	private hiddenThinkingLabel = this.defaultHiddenThinkingLabel;

	private lastSigintTime = 0;
	private lastEscapeTime = 0;

	// Status line tracking (for mutating immediately-sequential status updates)
	private lastStatusSpacer: Spacer | undefined = undefined;
	private lastStatusText: Text | undefined = undefined;

	// Streaming message tracking
	private streamingComponent: AssistantMessageComponent | undefined = undefined;
	private streamingMessage: AssistantMessage | undefined = undefined;

	// Tool execution tracking: toolCallId -> component
	private pendingTools = new Map<string, ToolExecutionComponent>();

	// Tool output expansion state
	private toolOutputExpanded = false;

	// Thinking block visibility state
	private hideThinkingBlock = false;

	// Agent subscription unsubscribe function
	private unsubscribe?: () => void;

	// Track if editor is in bash mode (text starts with !)
	private isBashMode = false;

	// Track current bash execution component
	private bashComponent: BashExecutionComponent | undefined = undefined;

	// Track pending bash components (shown in pending area, moved to chat on submit)
	private pendingBashComponents: BashExecutionComponent[] = [];

	// Auto-compaction state
	private autoCompactionLoader: Loader | undefined = undefined;
	private autoCompactionEscapeHandler?: () => void;

	// Auto-retry state
	private retryLoader: Loader | undefined = undefined;
	private retryCountdown: CountdownTimer | undefined = undefined;
	private retryEscapeHandler?: () => void;

	// Messages queued while compaction is running
	private compactionQueuedMessages: CompactionQueuedMessage[] = [];

	// Header container that holds the built-in header
	private headerContainer: Container;
	private builtInHeader: Component | undefined = undefined;

	private isShuttingDown = false;

	private get sessionManager() {
		return this.session.sessionManager;
	}
	private get settingsManager() {
		return this.session.settingsManager;
	}
	private get agent() {
		return this.session.agent;
	}

	constructor(
		private readonly session: AgentSession,
		terminal: Terminal,
		private readonly options: InteractiveModeOptions,
	) {
		this.ui = new TUI(terminal, this.settingsManager.getShowHardwareCursor());
		this.ui.setClearOnShrink(this.settingsManager.getClearOnShrink());
		this.headerContainer = new Container();
		this.chatContainer = new Container();
		this.pendingMessagesContainer = new Container();
		this.statusContainer = new Container();
		this.keybindings = options.keybindings;
		setKeybindings(this.keybindings);
		const editorPaddingX = this.settingsManager.getEditorPaddingX();
		const autocompleteMaxVisible =
			this.settingsManager.getAutocompleteMaxVisible();
		this.defaultEditor = new CustomEditor(
			this.ui,
			getEditorTheme(),
			this.keybindings,
			{
				paddingX: editorPaddingX,
				autocompleteMaxVisible,
			},
		);
		this.editor = this.defaultEditor;
		this.editorContainer = new Container();
		this.editorContainer.addChild(this.editor as Component);
		this.footerDataProvider = options.footerData;
		this.footer = new FooterComponent(this.session, this.footerDataProvider);
		this.footer.setAutoCompactEnabled(this.session.autoCompactionEnabled);

		// Load hide thinking block setting
		this.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();
	}

	private createBaseAutocompleteProvider(): CombinedAutocompleteProvider {
		// Define commands for autocomplete
		const slashCommands: SlashCommand[] = BUILTIN_SLASH_COMMANDS.map(
			(command) => ({
				name: command.name,
				description: command.description,
			}),
		);

		// Build skill commands from session.skills (if enabled)
		const skillCommandList: SlashCommand[] = [];
		if (this.settingsManager.getEnableSkillCommands()) {
			for (const skill of this.session.skills) {
				skillCommandList.push({
					name: `skill:${skill.name}`,
					description: skill.description,
				});
			}
		}

		return new CombinedAutocompleteProvider(
			[...slashCommands, ...skillCommandList],
			this.sessionManager.getCwd(),
			this.options.autocompleteFileSystem,
		);
	}

	private setupAutocompleteProvider(): void {
		this.defaultEditor.setAutocompleteProvider(
			this.createBaseAutocompleteProvider(),
		);
	}

	init(): void {
		if (this.isInitialized) return;

		// Add header container as first child
		this.ui.addChild(this.headerContainer);

		if (!this.settingsManager.getQuietStartup()) {
			const logo =
				theme.bold(theme.fg("accent", "pi")) +
				theme.fg("dim", ` v${this.options.version}`);

			// Build startup instructions using keybinding hint helpers
			const hint = (keybinding: AppKeybinding, description: string) =>
				keyHint(keybinding, description);

			const expandedInstructions = [
				hint("app.interrupt", "to interrupt"),
				hint("app.clear", "to clear"),
				rawKeyHint(`${keyText("app.clear")} twice`, "to exit"),
				hint("app.exit", "to exit (empty)"),
				keyHint("tui.editor.deleteToLineEnd", "to delete to end"),
				hint("app.thinking.cycle", "to cycle thinking level"),
				hint("app.tools.expand", "to expand tools"),
				hint("app.thinking.toggle", "to expand thinking"),
				rawKeyHint("/", "for commands"),
				rawKeyHint("!", "to run bash"),
				rawKeyHint("!!", "to run bash (no context)"),
				hint("app.message.followUp", "to queue follow-up"),
				hint("app.message.dequeue", "to edit all queued messages"),
				rawKeyHint("@", "to mention a file"),
			].join("\n");
			const compactInstructions = [
				hint("app.interrupt", "interrupt"),
				rawKeyHint(
					`${keyText("app.clear")}/${keyText("app.exit")}`,
					"clear/exit",
				),
				rawKeyHint("/", "commands"),
				rawKeyHint("!", "bash"),
				hint("app.tools.expand", "more"),
			].join(theme.fg("muted", " · "));
			const compactOnboarding = theme.fg(
				"dim",
				`Press ${keyText("app.tools.expand")} to show full startup help and loaded resources.`,
			);
			const onboarding = this.options.onboarding
				? `\n\n${theme.fg("dim", this.options.onboarding)}`
				: "";
			this.builtInHeader = new ExpandableText(
				() =>
					`${logo}\n${compactInstructions}\n${compactOnboarding}${onboarding}`,
				() =>
					`${logo}\n${expandedInstructions}${this.getLoadedResourcesText()}${onboarding}`,
				false,
				1,
				0,
			);

			// Setup UI layout
			this.headerContainer.addChild(new Spacer(1));
			this.headerContainer.addChild(this.builtInHeader);
			this.headerContainer.addChild(new Spacer(1));
		} else {
			// Minimal header when silenced
			this.builtInHeader = new Text("", 0, 0);
			this.headerContainer.addChild(this.builtInHeader);
		}

		this.ui.addChild(this.chatContainer);
		this.ui.addChild(this.pendingMessagesContainer);
		this.ui.addChild(this.statusContainer);
		this.ui.addChild(new Spacer(1));
		this.ui.addChild(this.editorContainer);
		this.ui.addChild(this.footer);
		this.ui.setFocus(this.editor);

		this.setupKeyHandlers();
		this.setupEditorSubmitHandler();
		this.setupAutocompleteProvider();
		this.updateEditorBorderColor();

		this.ui.start();
		this.isInitialized = true;

		this.subscribeToAgent();
		this.renderInitialMessages();

		// Git branch changes re-render the footer
		this.footerDataProvider.onBranchChange(() => {
			this.ui.requestRender();
		});
	}

	/** Context files and skills, listed in the expanded header. */
	private getLoadedResourcesText(): string {
		const sections: string[] = [];
		const contextFiles = this.session.systemPrompt
			? this.sessionContextFiles()
			: [];
		if (contextFiles.length > 0) {
			sections.push(
				`${theme.fg("muted", "Context:")}\n${contextFiles.map((p) => `  ${theme.fg("dim", p)}`).join("\n")}`,
			);
		}
		if (this.session.skills.length > 0) {
			sections.push(
				`${theme.fg("muted", "Skills:")}\n${this.session.skills.map((s) => `  ${theme.fg("dim", s.name)}`).join("\n")}`,
			);
		}
		return sections.length > 0 ? `\n\n${sections.join("\n")}` : "";
	}

	private sessionContextFiles(): string[] {
		const matches = this.session.systemPrompt.matchAll(/^## (.+)$/gm);
		return Array.from(matches, (match) => match[1]).filter((path) =>
			path.startsWith("/"),
		);
	}

	private getMarkdownThemeWithSettings(): MarkdownTheme {
		return {
			...getMarkdownTheme(),
			codeBlockIndent: this.settingsManager.getCodeBlockIndent(),
		};
	}

	private getWorkingLoaderMessage(): string {
		return this.workingMessage ?? this.defaultWorkingMessage;
	}

	private createWorkingLoader(): Loader {
		return new Loader(
			this.ui,
			(spinner) => theme.fg("accent", spinner),
			(text) => theme.fg("muted", text),
			this.getWorkingLoaderMessage(),
		);
	}

	private stopWorkingLoader(): void {
		if (this.loadingAnimation) {
			this.loadingAnimation.stop();
			this.loadingAnimation = undefined;
		}
		this.statusContainer.clear();
	}

	private getRegisteredToolDefinition(toolName: string) {
		return this.session.getToolDefinition(toolName);
	}

	private setupKeyHandlers(): void {
		// Set up handlers on defaultEditor - they use this.editor for text access
		// so they work correctly regardless of which editor is active
		this.defaultEditor.onEscape = () => {
			if (this.session.isStreaming) {
				this.restoreQueuedMessagesToEditor({ abort: true });
			} else if (this.session.isBashRunning) {
				this.session.abortBash();
			} else if (this.isBashMode) {
				this.editor.setText("");
				this.isBashMode = false;
				this.updateEditorBorderColor();
			} else if (!this.editor.getText().trim()) {
				// pi opens /tree or /fork on a double escape; neither is part of this app.
				this.lastEscapeTime = Date.now();
			}
		};

		// Register app action handlers
		this.defaultEditor.onAction("app.clear", () => this.handleCtrlC());
		this.defaultEditor.onAction(
			"app.session.resume",
			() => void this.handleResumeCommand(""),
		);
		this.defaultEditor.onCtrlD = () => this.handleCtrlD();
		this.defaultEditor.onAction("app.thinking.cycle", () =>
			this.cycleThinkingLevel(),
		);
		this.defaultEditor.onAction("app.model.cycleForward", () =>
			this.showModelInfo(),
		);
		this.defaultEditor.onAction("app.model.cycleBackward", () =>
			this.showModelInfo(),
		);
		this.defaultEditor.onAction("app.model.select", () => this.showModelInfo());
		this.defaultEditor.onAction("app.tools.expand", () =>
			this.toggleToolOutputExpansion(),
		);
		this.defaultEditor.onAction("app.thinking.toggle", () =>
			this.toggleThinkingBlockVisibility(),
		);
		this.defaultEditor.onAction(
			"app.message.followUp",
			() => void this.handleFollowUp(),
		);
		this.defaultEditor.onAction("app.message.dequeue", () =>
			this.handleDequeue(),
		);
		this.defaultEditor.onAction(
			"app.session.new",
			() => void this.handleClearCommand(),
		);

		this.defaultEditor.onChange = (text: string) => {
			const wasBashMode = this.isBashMode;
			this.isBashMode = text.trimStart().startsWith("!");
			if (wasBashMode !== this.isBashMode) {
				this.updateEditorBorderColor();
			}
		};
	}

	private setupEditorSubmitHandler(): void {
		this.defaultEditor.onSubmit = async (text: string) => {
			text = text.trim();
			if (!text) return;

			// Handle commands
			if (text === "/model" || text.startsWith("/model ")) {
				this.editor.setText("");
				this.showModelInfo();
				return;
			}
			if (text === "/name" || text.startsWith("/name ")) {
				this.handleNameCommand(text);
				this.editor.setText("");
				return;
			}
			if (text === "/session") {
				this.handleSessionCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/sessions") {
				this.editor.setText("");
				await this.handleSessionsCommand();
				return;
			}
			if (text === "/resume" || text.startsWith("/resume ")) {
				this.editor.setText("");
				await this.handleResumeCommand(text.slice("/resume".length).trim());
				return;
			}
			if (text === "/hotkeys") {
				this.handleHotkeysCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/new") {
				this.editor.setText("");
				await this.handleClearCommand();
				return;
			}
			if (text === "/compact" || text.startsWith("/compact ")) {
				const customInstructions = text.startsWith("/compact ")
					? text.slice(9).trim()
					: undefined;
				this.editor.setText("");
				await this.handleCompactCommand(customInstructions);
				return;
			}
			if (text === "/quit") {
				this.editor.setText("");
				this.shutdown();
				return;
			}

			// Handle bash command (! for normal, !! for excluded from context)
			if (text.startsWith("!")) {
				const isExcluded = text.startsWith("!!");
				const command = isExcluded
					? text.slice(2).trim()
					: text.slice(1).trim();
				if (command) {
					if (this.session.isBashRunning) {
						this.showWarning(
							"A bash command is already running. Press Esc to cancel it first.",
						);
						this.editor.setText(text);
						return;
					}
					this.editor.addToHistory?.(text);
					await this.handleBashCommand(command, isExcluded);
					this.isBashMode = false;
					this.updateEditorBorderColor();
					return;
				}
			}

			// Queue input during compaction
			if (this.session.isCompacting) {
				this.queueCompactionMessage(text, "steer");
				return;
			}

			// If streaming, use prompt() with steer behavior
			if (this.session.isStreaming) {
				this.editor.addToHistory?.(text);
				this.editor.setText("");
				await this.session.prompt(text, { streamingBehavior: "steer" });
				this.updatePendingMessagesDisplay();
				this.ui.requestRender();
				return;
			}

			// Normal message submission
			// First, move any pending bash components to chat
			this.flushPendingBashComponents();

			this.editor.addToHistory?.(text);
			this.editor.setText("");
			try {
				await this.session.prompt(text);
			} catch (error: unknown) {
				const errorMessage =
					error instanceof Error ? error.message : "Unknown error occurred";
				this.showError(errorMessage);
			}
		};
	}

	private subscribeToAgent(): void {
		this.unsubscribe = this.session.subscribe(async (event) => {
			await this.handleEvent(event);
		});
	}

	private async handleEvent(event: AgentSessionEvent): Promise<void> {
		if (!this.isInitialized) return;

		this.footer.invalidate();

		switch (event.type) {
			case "agent_start":
				this.pendingTools.clear();
				if (this.settingsManager.getShowTerminalProgress()) {
					this.ui.terminal.setProgress(true);
				}
				// Restore main escape handler if retry handler is still active
				// (retry success event fires later, but we need main handler now)
				if (this.retryEscapeHandler) {
					this.defaultEditor.onEscape = this.retryEscapeHandler;
					this.retryEscapeHandler = undefined;
				}
				if (this.retryCountdown) {
					this.retryCountdown.dispose();
					this.retryCountdown = undefined;
				}
				if (this.retryLoader) {
					this.retryLoader.stop();
					this.retryLoader = undefined;
				}
				this.stopWorkingLoader();
				if (this.workingVisible) {
					this.loadingAnimation = this.createWorkingLoader();
					this.statusContainer.addChild(this.loadingAnimation);
				}
				this.ui.requestRender();
				break;

			case "queue_update":
				this.updatePendingMessagesDisplay();
				this.ui.requestRender();
				break;

			case "session_info_changed":
				this.footer.invalidate();
				this.ui.requestRender();
				break;

			case "thinking_level_changed":
				this.footer.invalidate();
				this.updateEditorBorderColor();
				break;

			case "model_changed":
				this.footer.invalidate();
				this.updateEditorBorderColor();
				this.ui.requestRender();
				break;

			case "message_start":
				if (event.message.role === "custom") {
					this.addMessageToChat(event.message);
					this.ui.requestRender();
				} else if (event.message.role === "user") {
					this.addMessageToChat(event.message);
					this.updatePendingMessagesDisplay();
					this.ui.requestRender();
				} else if (event.message.role === "assistant") {
					this.streamingComponent = new AssistantMessageComponent(
						undefined,
						this.hideThinkingBlock,
						this.getMarkdownThemeWithSettings(),
						this.hiddenThinkingLabel,
					);
					this.streamingMessage = event.message;
					this.chatContainer.addChild(this.streamingComponent);
					this.streamingComponent.updateContent(this.streamingMessage);
					this.ui.requestRender();
				}
				break;

			case "message_update":
				if (this.streamingComponent && event.message.role === "assistant") {
					this.streamingMessage = event.message;
					this.streamingComponent.updateContent(this.streamingMessage);

					for (const content of this.streamingMessage.content) {
						if (content.type === "toolCall") {
							if (!this.pendingTools.has(content.id)) {
								const component = new ToolExecutionComponent(
									content.name,
									content.id,
									content.arguments,
									{
										showImages: this.settingsManager.getShowImages(),
										imageWidthCells: this.settingsManager.getImageWidthCells(),
									},
									this.getRegisteredToolDefinition(content.name),
									this.ui,
									this.sessionManager.getCwd(),
								);
								component.setExpanded(this.toolOutputExpanded);
								this.chatContainer.addChild(component);
								this.pendingTools.set(content.id, component);
							} else {
								const component = this.pendingTools.get(content.id);
								if (component) {
									component.updateArgs(content.arguments);
								}
							}
						}
					}
					this.ui.requestRender();
				}
				break;

			case "message_end":
				if (event.message.role === "user") break;
				if (this.streamingComponent && event.message.role === "assistant") {
					this.streamingMessage = event.message;
					let errorMessage: string | undefined;
					if (this.streamingMessage.stopReason === "aborted") {
						const retryAttempt = this.session.retryAttempt;
						errorMessage =
							retryAttempt > 0
								? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
								: "Operation aborted";
						this.streamingMessage.errorMessage = errorMessage;
					}
					this.streamingComponent.updateContent(this.streamingMessage);

					if (
						this.streamingMessage.stopReason === "aborted" ||
						this.streamingMessage.stopReason === "error"
					) {
						if (!errorMessage) {
							errorMessage = this.streamingMessage.errorMessage || "Error";
						}
						for (const [, component] of this.pendingTools.entries()) {
							component.updateResult({
								content: [{ type: "text", text: errorMessage }],
								isError: true,
							});
						}
						this.pendingTools.clear();
					} else {
						// Args are now complete - trigger diff computation for edit tools
						for (const [, component] of this.pendingTools.entries()) {
							component.setArgsComplete();
						}
					}
					this.streamingComponent = undefined;
					this.streamingMessage = undefined;
					this.footer.invalidate();
				}
				this.ui.requestRender();
				break;

			case "tool_execution_start": {
				let component = this.pendingTools.get(event.toolCallId);
				if (!component) {
					component = new ToolExecutionComponent(
						event.toolName,
						event.toolCallId,
						event.args,
						{
							showImages: this.settingsManager.getShowImages(),
							imageWidthCells: this.settingsManager.getImageWidthCells(),
						},
						this.getRegisteredToolDefinition(event.toolName),
						this.ui,
						this.sessionManager.getCwd(),
					);
					component.setExpanded(this.toolOutputExpanded);
					this.chatContainer.addChild(component);
					this.pendingTools.set(event.toolCallId, component);
				}
				component.markExecutionStarted();
				this.ui.requestRender();
				break;
			}

			case "tool_execution_update": {
				const component = this.pendingTools.get(event.toolCallId);
				if (component) {
					component.updateResult(
						{ ...event.partialResult, isError: false },
						true,
					);
					this.ui.requestRender();
				}
				break;
			}

			case "tool_execution_end": {
				const component = this.pendingTools.get(event.toolCallId);
				if (component) {
					component.updateResult({ ...event.result, isError: event.isError });
					this.pendingTools.delete(event.toolCallId);
					this.ui.requestRender();
				}
				break;
			}

			case "agent_end":
				if (this.settingsManager.getShowTerminalProgress()) {
					this.ui.terminal.setProgress(false);
				}
				if (this.loadingAnimation) {
					this.loadingAnimation.stop();
					this.loadingAnimation = undefined;
					this.statusContainer.clear();
				}
				if (this.streamingComponent) {
					this.chatContainer.removeChild(this.streamingComponent);
					this.streamingComponent = undefined;
					this.streamingMessage = undefined;
				}
				this.pendingTools.clear();
				void this.footerDataProvider.refresh();

				this.ui.requestRender();
				break;

			case "compaction_start": {
				if (this.settingsManager.getShowTerminalProgress()) {
					this.ui.terminal.setProgress(true);
				}
				// Keep editor active; submissions are queued during compaction.
				this.autoCompactionEscapeHandler = this.defaultEditor.onEscape;
				this.defaultEditor.onEscape = () => {
					this.session.abortCompaction();
				};
				this.statusContainer.clear();
				const cancelHint = `(${keyText("app.interrupt")} to cancel)`;
				const label =
					event.reason === "manual"
						? `Compacting context... ${cancelHint}`
						: `${event.reason === "overflow" ? "Context overflow detected, " : ""}Auto-compacting... ${cancelHint}`;
				this.autoCompactionLoader = new Loader(
					this.ui,
					(spinner) => theme.fg("accent", spinner),
					(text) => theme.fg("muted", text),
					label,
				);
				this.statusContainer.addChild(this.autoCompactionLoader);
				this.ui.requestRender();
				break;
			}

			case "compaction_end": {
				if (this.settingsManager.getShowTerminalProgress()) {
					this.ui.terminal.setProgress(false);
				}
				if (this.autoCompactionEscapeHandler) {
					this.defaultEditor.onEscape = this.autoCompactionEscapeHandler;
					this.autoCompactionEscapeHandler = undefined;
				}
				if (this.autoCompactionLoader) {
					this.autoCompactionLoader.stop();
					this.autoCompactionLoader = undefined;
					this.statusContainer.clear();
				}
				if (event.aborted) {
					if (event.reason === "manual") {
						this.showError("Compaction cancelled");
					} else {
						this.showStatus("Auto-compaction cancelled");
					}
				} else if (event.result) {
					this.chatContainer.clear();
					this.rebuildChatFromMessages();
					this.addMessageToChat(
						createCompactionSummaryMessage(
							event.result.summary,
							event.result.tokensBefore,
							new Date().toISOString(),
						),
					);
					this.footer.invalidate();
				} else if (event.errorMessage) {
					if (event.reason === "manual") {
						this.showError(event.errorMessage);
					} else {
						this.chatContainer.addChild(new Spacer(1));
						this.chatContainer.addChild(
							new Text(theme.fg("error", event.errorMessage), 1, 0),
						);
					}
				}
				void this.flushCompactionQueue({ willRetry: event.willRetry });
				this.ui.requestRender();
				break;
			}

			case "auto_retry_start": {
				// Set up escape to abort retry
				this.retryEscapeHandler = this.defaultEditor.onEscape;
				this.defaultEditor.onEscape = () => {
					this.session.abortRetry();
				};
				// Show retry indicator
				this.statusContainer.clear();
				this.retryCountdown?.dispose();
				const retryMessage = (seconds: number) =>
					`Retrying (${event.attempt}/${event.maxAttempts}) in ${seconds}s... (${keyText("app.interrupt")} to cancel)`;
				this.retryLoader = new Loader(
					this.ui,
					(spinner) => theme.fg("warning", spinner),
					(text) => theme.fg("muted", text),
					retryMessage(Math.ceil(event.delayMs / 1000)),
				);
				this.retryCountdown = new CountdownTimer(
					event.delayMs,
					this.ui,
					(seconds) => {
						this.retryLoader?.setMessage(retryMessage(seconds));
					},
					() => {
						this.retryCountdown = undefined;
					},
				);
				this.statusContainer.addChild(this.retryLoader);
				this.ui.requestRender();
				break;
			}

			case "auto_retry_end": {
				// Restore escape handler
				if (this.retryEscapeHandler) {
					this.defaultEditor.onEscape = this.retryEscapeHandler;
					this.retryEscapeHandler = undefined;
				}
				if (this.retryCountdown) {
					this.retryCountdown.dispose();
					this.retryCountdown = undefined;
				}
				// Stop loader
				if (this.retryLoader) {
					this.retryLoader.stop();
					this.retryLoader = undefined;
					this.statusContainer.clear();
				}
				// Show error only on final failure (success shows normal response)
				if (!event.success) {
					this.showError(
						`Retry failed after ${event.attempt} attempts: ${event.finalError || "Unknown error"}`,
					);
				}
				this.ui.requestRender();
				break;
			}
		}
	}

	/** Extract text content from a user message */
	private getUserMessageText(message: Message): string {
		if (message.role !== "user") return "";
		const textBlocks =
			typeof message.content === "string"
				? [{ type: "text", text: message.content }]
				: message.content.filter((c: { type: string }) => c.type === "text");
		return textBlocks.map((c) => (c as { text: string }).text).join("");
	}

	/**
	 * Show a status message in the chat.
	 *
	 * If multiple status messages are emitted back-to-back (without anything else being added to the chat),
	 * we update the previous status line instead of appending new ones to avoid log spam.
	 */
	showStatus(message: string): void {
		const children = this.chatContainer.children;
		const last =
			children.length > 0 ? children[children.length - 1] : undefined;
		const secondLast =
			children.length > 1 ? children[children.length - 2] : undefined;

		if (
			last &&
			secondLast &&
			last === this.lastStatusText &&
			secondLast === this.lastStatusSpacer
		) {
			this.lastStatusText.setText(theme.fg("dim", message));
			this.ui.requestRender();
			return;
		}

		const spacer = new Spacer(1);
		const text = new Text(theme.fg("dim", message), 1, 0);
		this.chatContainer.addChild(spacer);
		this.chatContainer.addChild(text);
		this.lastStatusSpacer = spacer;
		this.lastStatusText = text;
		this.ui.requestRender();
	}

	private addMessageToChat(
		message: AgentMessage,
		options?: { populateHistory?: boolean },
	): void {
		switch (message.role) {
			case "bashExecution": {
				const component = new BashExecutionComponent(
					message.command,
					this.ui,
					message.excludeFromContext,
				);
				if (message.output) {
					component.appendOutput(message.output);
				}
				component.setComplete(
					message.exitCode,
					message.cancelled,
					message.truncated
						? ({ truncated: true } as TruncationResult)
						: undefined,
					message.fullOutputPath,
				);
				this.chatContainer.addChild(component);
				break;
			}
			case "custom": {
				if (message.display) {
					const component = new CustomMessageComponent(
						message,
						undefined,
						this.getMarkdownThemeWithSettings(),
					);
					component.setExpanded(this.toolOutputExpanded);
					this.chatContainer.addChild(component);
				}
				break;
			}
			case "compactionSummary": {
				this.chatContainer.addChild(new Spacer(1));
				const component = new CompactionSummaryMessageComponent(
					message,
					this.getMarkdownThemeWithSettings(),
				);
				component.setExpanded(this.toolOutputExpanded);
				this.chatContainer.addChild(component);
				break;
			}
			case "branchSummary": {
				this.chatContainer.addChild(new Spacer(1));
				const component = new BranchSummaryMessageComponent(
					message,
					this.getMarkdownThemeWithSettings(),
				);
				component.setExpanded(this.toolOutputExpanded);
				this.chatContainer.addChild(component);
				break;
			}
			case "user": {
				const textContent = this.getUserMessageText(message);
				if (textContent) {
					if (this.chatContainer.children.length > 0) {
						this.chatContainer.addChild(new Spacer(1));
					}
					const skillBlock = parseSkillBlock(textContent);
					if (skillBlock) {
						// Render skill block (collapsible)
						const component = new SkillInvocationMessageComponent(
							skillBlock,
							this.getMarkdownThemeWithSettings(),
						);
						component.setExpanded(this.toolOutputExpanded);
						this.chatContainer.addChild(component);
						// Render user message separately if present
						if (skillBlock.userMessage) {
							const userComponent = new UserMessageComponent(
								skillBlock.userMessage,
								this.getMarkdownThemeWithSettings(),
							);
							this.chatContainer.addChild(userComponent);
						}
					} else {
						const userComponent = new UserMessageComponent(
							textContent,
							this.getMarkdownThemeWithSettings(),
						);
						this.chatContainer.addChild(userComponent);
					}
					if (options?.populateHistory) {
						this.editor.addToHistory?.(textContent);
					}
				}
				break;
			}
			case "assistant": {
				const assistantComponent = new AssistantMessageComponent(
					message,
					this.hideThinkingBlock,
					this.getMarkdownThemeWithSettings(),
					this.hiddenThinkingLabel,
				);
				this.chatContainer.addChild(assistantComponent);
				break;
			}
			case "toolResult": {
				// Tool results are rendered inline with tool calls, handled separately
				break;
			}
			default: {
				const _exhaustive: never = message;
			}
		}
	}

	/**
	 * Render session context to chat. Used for initial load and rebuild after compaction.
	 * @param sessionContext Session context to render
	 * @param options.updateFooter Update footer state
	 * @param options.populateHistory Add user messages to editor history
	 */
	private renderSessionContext(
		sessionContext: SessionContext,
		options: { updateFooter?: boolean; populateHistory?: boolean } = {},
	): void {
		this.pendingTools.clear();
		const renderedPendingTools = new Map<string, ToolExecutionComponent>();

		if (options.updateFooter) {
			this.footer.invalidate();
			this.updateEditorBorderColor();
		}

		for (const message of sessionContext.messages) {
			// Assistant messages need special handling for tool calls
			if (message.role === "assistant") {
				this.addMessageToChat(message);
				// Render tool call components
				for (const content of message.content) {
					if (content.type === "toolCall") {
						const component = new ToolExecutionComponent(
							content.name,
							content.id,
							content.arguments,
							{
								showImages: this.settingsManager.getShowImages(),
								imageWidthCells: this.settingsManager.getImageWidthCells(),
							},
							this.getRegisteredToolDefinition(content.name),
							this.ui,
							this.sessionManager.getCwd(),
						);
						component.setExpanded(this.toolOutputExpanded);
						this.chatContainer.addChild(component);

						if (
							message.stopReason === "aborted" ||
							message.stopReason === "error"
						) {
							let errorMessage: string;
							if (message.stopReason === "aborted") {
								const retryAttempt = this.session.retryAttempt;
								errorMessage =
									retryAttempt > 0
										? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
										: "Operation aborted";
							} else {
								errorMessage = message.errorMessage || "Error";
							}
							component.updateResult({
								content: [{ type: "text", text: errorMessage }],
								isError: true,
							});
						} else {
							renderedPendingTools.set(content.id, component);
						}
					}
				}
			} else if (message.role === "toolResult") {
				// Match tool results to pending tool components
				const component = renderedPendingTools.get(message.toolCallId);
				if (component) {
					component.updateResult(message);
					renderedPendingTools.delete(message.toolCallId);
				}
			} else {
				// All other messages use standard rendering
				this.addMessageToChat(message, options);
			}
		}

		for (const [toolCallId, component] of renderedPendingTools) {
			this.pendingTools.set(toolCallId, component);
		}
		this.ui.requestRender();
	}

	renderInitialMessages(): void {
		// Get aligned messages and entries from session context
		const context = this.sessionManager.buildSessionContext();
		this.renderSessionContext(context, {
			updateFooter: true,
			populateHistory: true,
		});

		// Show compaction info if session was compacted
		const allEntries = this.sessionManager.getEntries();
		const compactionCount = allEntries.filter(
			(e) => e.type === "compaction",
		).length;
		if (compactionCount > 0) {
			const times =
				compactionCount === 1 ? "1 time" : `${compactionCount} times`;
			this.showStatus(`Session compacted ${times}`);
		}
	}

	private rebuildChatFromMessages(): void {
		this.chatContainer.clear();
		const context = this.sessionManager.buildSessionContext();
		this.renderSessionContext(context);
	}

	// =========================================================================
	// Key handlers
	// =========================================================================

	private handleCtrlC(): void {
		const now = Date.now();
		if (now - this.lastSigintTime < 500) {
			this.shutdown();
		} else {
			this.clearEditor();
			this.lastSigintTime = now;
		}
	}

	private handleCtrlD(): void {
		// Only called when editor is empty (enforced by CustomEditor)
		this.shutdown();
	}

	/** Hand control back to the app, which closes the pi window and its session. */
	private shutdown(): void {
		if (this.isShuttingDown) return;
		this.isShuttingDown = true;
		this.options.onQuit();
	}

	private async handleFollowUp(): Promise<void> {
		const text = (
			this.editor.getExpandedText?.() ?? this.editor.getText()
		).trim();
		if (!text) return;

		// Queue input during compaction
		if (this.session.isCompacting) {
			this.queueCompactionMessage(text, "followUp");
			return;
		}

		// Alt+Enter queues a follow-up message (waits until agent finishes)
		if (this.session.isStreaming) {
			this.editor.addToHistory?.(text);
			this.editor.setText("");
			await this.session.prompt(text, { streamingBehavior: "followUp" });
			this.updatePendingMessagesDisplay();
			this.ui.requestRender();
		}
		// If not streaming, Alt+Enter acts like regular Enter (trigger onSubmit)
		else if (this.editor.onSubmit) {
			this.editor.setText("");
			this.editor.onSubmit(text);
		}
	}

	private handleDequeue(): void {
		const restored = this.restoreQueuedMessagesToEditor();
		if (restored === 0) {
			this.showStatus("No queued messages to restore");
		} else {
			this.showStatus(
				`Restored ${restored} queued message${restored > 1 ? "s" : ""} to editor`,
			);
		}
	}

	private updateEditorBorderColor(): void {
		if (this.isBashMode) {
			this.editor.borderColor = theme.getBashModeBorderColor();
		} else {
			const level = this.session.thinkingLevel || "off";
			this.editor.borderColor = theme.getThinkingBorderColor(level);
		}
		this.ui.requestRender();
	}

	private cycleThinkingLevel(): void {
		const newLevel = this.session.cycleThinkingLevel();
		if (newLevel === undefined) {
			this.showStatus("Current model does not support thinking");
		} else {
			this.footer.invalidate();
			this.updateEditorBorderColor();
			this.showStatus(`Thinking level: ${newLevel}`);
		}
	}

	/** /model and the model keys: pi follows the chat's model selection. */
	private showModelInfo(): void {
		const model = this.session.model;
		const current = model ? `${model.provider}/${model.id}` : "none selected";
		const change = this.options.describeModelChange ?? "";
		this.showStatus(`Model: ${current}${change ? ` · ${change}` : ""}`);
	}

	private toggleToolOutputExpansion(): void {
		this.setToolsExpanded(!this.toolOutputExpanded);
	}

	private setToolsExpanded(expanded: boolean): void {
		this.toolOutputExpanded = expanded;
		if (isExpandable(this.builtInHeader)) {
			this.builtInHeader.setExpanded(expanded);
		}
		for (const child of this.chatContainer.children) {
			if (isExpandable(child)) {
				child.setExpanded(expanded);
			}
		}
		this.ui.requestRender();
	}

	private toggleThinkingBlockVisibility(): void {
		this.hideThinkingBlock = !this.hideThinkingBlock;
		this.settingsManager.setHideThinkingBlock(this.hideThinkingBlock);

		// Rebuild chat from session messages
		this.chatContainer.clear();
		this.rebuildChatFromMessages();

		// If streaming, re-add the streaming component with updated visibility and re-render
		if (this.streamingComponent && this.streamingMessage) {
			this.streamingComponent.setHideThinkingBlock(this.hideThinkingBlock);
			this.streamingComponent.updateContent(this.streamingMessage);
			this.chatContainer.addChild(this.streamingComponent);
		}

		this.showStatus(
			`Thinking blocks: ${this.hideThinkingBlock ? "hidden" : "visible"}`,
		);
	}

	// =========================================================================
	// UI helpers
	// =========================================================================

	clearEditor(): void {
		this.editor.setText("");
		this.ui.requestRender();
	}

	showError(errorMessage: string): void {
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(
			new Text(theme.fg("error", `Error: ${errorMessage}`), 1, 0),
		);
		this.ui.requestRender();
	}

	showWarning(warningMessage: string): void {
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(
			new Text(theme.fg("warning", `Warning: ${warningMessage}`), 1, 0),
		);
		this.ui.requestRender();
	}

	/**
	 * Get all queued messages (read-only).
	 * Combines session queue and compaction queue.
	 */
	private getAllQueuedMessages(): { steering: string[]; followUp: string[] } {
		return {
			steering: [
				...this.session.getSteeringMessages(),
				...this.compactionQueuedMessages
					.filter((msg) => msg.mode === "steer")
					.map((msg) => msg.text),
			],
			followUp: [
				...this.session.getFollowUpMessages(),
				...this.compactionQueuedMessages
					.filter((msg) => msg.mode === "followUp")
					.map((msg) => msg.text),
			],
		};
	}

	/**
	 * Clear all queued messages and return their contents.
	 * Clears both session queue and compaction queue.
	 */
	private clearAllQueues(): { steering: string[]; followUp: string[] } {
		const { steering, followUp } = this.session.clearQueue();
		const compactionSteering = this.compactionQueuedMessages
			.filter((msg) => msg.mode === "steer")
			.map((msg) => msg.text);
		const compactionFollowUp = this.compactionQueuedMessages
			.filter((msg) => msg.mode === "followUp")
			.map((msg) => msg.text);
		this.compactionQueuedMessages = [];
		return {
			steering: [...steering, ...compactionSteering],
			followUp: [...followUp, ...compactionFollowUp],
		};
	}

	private updatePendingMessagesDisplay(): void {
		this.pendingMessagesContainer.clear();
		const { steering: steeringMessages, followUp: followUpMessages } =
			this.getAllQueuedMessages();
		if (steeringMessages.length > 0 || followUpMessages.length > 0) {
			this.pendingMessagesContainer.addChild(new Spacer(1));
			for (const message of steeringMessages) {
				const text = theme.fg("dim", `Steering: ${message}`);
				this.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
			}
			for (const message of followUpMessages) {
				const text = theme.fg("dim", `Follow-up: ${message}`);
				this.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
			}
			const dequeueHint = this.getAppKeyDisplay("app.message.dequeue");
			const hintText = theme.fg(
				"dim",
				`↳ ${dequeueHint} to edit all queued messages`,
			);
			this.pendingMessagesContainer.addChild(new TruncatedText(hintText, 1, 0));
		}
		for (const component of this.pendingBashComponents) {
			this.pendingMessagesContainer.addChild(component);
		}
	}

	private restoreQueuedMessagesToEditor(options?: {
		abort?: boolean;
		currentText?: string;
	}): number {
		const { steering, followUp } = this.clearAllQueues();
		const allQueued = [...steering, ...followUp];
		if (allQueued.length === 0) {
			this.updatePendingMessagesDisplay();
			if (options?.abort) {
				this.agent.abort();
			}
			return 0;
		}
		const queuedText = allQueued.join("\n\n");
		const currentText = options?.currentText ?? this.editor.getText();
		const combinedText = [queuedText, currentText]
			.filter((t) => t.trim())
			.join("\n\n");
		this.editor.setText(combinedText);
		this.updatePendingMessagesDisplay();
		if (options?.abort) {
			this.agent.abort();
		}
		return allQueued.length;
	}

	private queueCompactionMessage(
		text: string,
		mode: "steer" | "followUp",
	): void {
		this.compactionQueuedMessages.push({ text, mode });
		this.editor.addToHistory?.(text);
		this.editor.setText("");
		this.updatePendingMessagesDisplay();
		this.showStatus("Queued message for after compaction");
	}

	private async flushCompactionQueue(options?: {
		willRetry?: boolean;
	}): Promise<void> {
		if (this.compactionQueuedMessages.length === 0) {
			return;
		}

		const queuedMessages = [...this.compactionQueuedMessages];
		this.compactionQueuedMessages = [];
		this.updatePendingMessagesDisplay();

		const restoreQueue = (error: unknown) => {
			this.session.clearQueue();
			this.compactionQueuedMessages = queuedMessages;
			this.updatePendingMessagesDisplay();
			this.showError(
				`Failed to send queued message${queuedMessages.length > 1 ? "s" : ""}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		};

		try {
			if (options?.willRetry) {
				// When retry is pending, queue messages for the retry turn
				for (const message of queuedMessages) {
					if (message.mode === "followUp") {
						await this.session.followUp(message.text);
					} else {
						await this.session.steer(message.text);
					}
				}
				this.updatePendingMessagesDisplay();
				return;
			}

			const [firstPrompt, ...rest] = queuedMessages;

			// Send first prompt (starts streaming)
			const promptPromise = this.session
				.prompt(firstPrompt.text)
				.catch((error) => {
					restoreQueue(error);
				});

			// Queue remaining messages
			for (const message of rest) {
				if (message.mode === "followUp") {
					await this.session.followUp(message.text);
				} else {
					await this.session.steer(message.text);
				}
			}
			this.updatePendingMessagesDisplay();
			void promptPromise;
		} catch (error) {
			restoreQueue(error);
		}
	}

	/** Move pending bash components from pending area to chat */
	private flushPendingBashComponents(): void {
		for (const component of this.pendingBashComponents) {
			this.pendingMessagesContainer.removeChild(component);
			this.chatContainer.addChild(component);
		}
		this.pendingBashComponents = [];
	}

	private handleNameCommand(text: string): void {
		const name = text.replace(/^\/name\s*/, "").trim();
		if (!name) {
			const currentName = this.sessionManager.getSessionName();
			if (currentName) {
				this.chatContainer.addChild(new Spacer(1));
				this.chatContainer.addChild(
					new Text(theme.fg("dim", `Session name: ${currentName}`), 1, 0),
				);
			} else {
				this.showWarning("Usage: /name <name>");
			}
			this.ui.requestRender();
			return;
		}

		this.session.setSessionName(name);
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(
			new Text(theme.fg("dim", `Session name set: ${name}`), 1, 0),
		);
		this.ui.requestRender();
	}

	private handleSessionCommand(): void {
		const stats = this.session.getSessionStats();
		const sessionName = this.sessionManager.getSessionName();

		let info = `${theme.bold("Session Info")}\n\n`;
		if (sessionName) {
			info += `${theme.fg("dim", "Name:")} ${sessionName}\n`;
		}
		info += `${theme.fg("dim", "File:")} ${stats.sessionFile ?? "In-memory"}\n`;
		info += `${theme.fg("dim", "ID:")} ${stats.sessionId}\n\n`;
		info += `${theme.bold("Messages")}\n`;
		info += `${theme.fg("dim", "User:")} ${stats.userMessages}\n`;
		info += `${theme.fg("dim", "Assistant:")} ${stats.assistantMessages}\n`;
		info += `${theme.fg("dim", "Tool Calls:")} ${stats.toolCalls}\n`;
		info += `${theme.fg("dim", "Tool Results:")} ${stats.toolResults}\n`;
		info += `${theme.fg("dim", "Total:")} ${stats.totalMessages}\n\n`;
		info += `${theme.bold("Tokens")}\n`;
		info += `${theme.fg("dim", "Input:")} ${stats.tokens.input.toLocaleString()}\n`;
		info += `${theme.fg("dim", "Output:")} ${stats.tokens.output.toLocaleString()}\n`;
		if (stats.tokens.cacheRead > 0) {
			info += `${theme.fg("dim", "Cache Read:")} ${stats.tokens.cacheRead.toLocaleString()}\n`;
		}
		if (stats.tokens.cacheWrite > 0) {
			info += `${theme.fg("dim", "Cache Write:")} ${stats.tokens.cacheWrite.toLocaleString()}\n`;
		}
		info += `${theme.fg("dim", "Total:")} ${stats.tokens.total.toLocaleString()}\n`;

		if (stats.cost > 0) {
			info += `\n${theme.bold("Cost")}\n`;
			info += `${theme.fg("dim", "Total:")} ${stats.cost.toFixed(4)}`;
		}

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(info, 1, 0));
		this.ui.requestRender();
	}

	/** A folder as pi shows it: "~" for the agent's home. */
	private folderName(cwd: string): string {
		const home = this.session.home;
		if (home && home !== "/" && (cwd === home || cwd.startsWith(`${home}/`))) {
			return `~${cwd.slice(home.length)}`;
		}
		return cwd;
	}

	/** The folder a saved session works in (an old one may not say). */
	private sessionFolder(session: SessionInfo): string {
		return session.cwd || this.sessionManager.getCwd();
	}

	/**
	 * Every saved session, in /sessions' numbering: this folder's first, then
	 * each other folder's, the folder used last first; the latest first in each.
	 */
	private async savedSessions(): Promise<SessionInfo[]> {
		const all = this.options.sessionsDir
			? await this.sessionManager.listAllSaved(this.options.sessionsDir)
			: await this.sessionManager.listSaved();
		const folders = [this.sessionManager.getCwd()];
		for (const session of all) {
			const folder = this.sessionFolder(session);
			if (!folders.includes(folder)) folders.push(folder);
		}
		return folders.flatMap((folder) =>
			all.filter((session) => this.sessionFolder(session) === folder),
		);
	}

	/** /sessions: every saved session by folder, numbered for /resume. */
	private async handleSessionsCommand(): Promise<void> {
		const sessions = await this.savedSessions();
		const current = this.sessionManager.getSessionFile();
		const here = this.sessionManager.getCwd();
		let info = theme.bold("Sessions");
		if (sessions.length === 0) {
			info += `\n\n${theme.fg("dim", "No saved sessions yet.")}`;
		}
		let folder: string | undefined;
		sessions.forEach((session, index) => {
			const cwd = this.sessionFolder(session);
			if (cwd !== folder) {
				folder = cwd;
				const mark = cwd === here ? theme.fg("dim", " (this folder)") : "";
				info += `\n\n${theme.fg("accent", this.folderName(cwd))}${mark}`;
			}
			const mark =
				session.path === current ? theme.fg("accent", " (current)") : "";
			info += `\n${theme.fg("dim", `${index + 1}.`)} ${sessionTitle(session)}${mark}`;
			info += `\n   ${theme.fg("dim", `${ago(session.modified)} · ${session.messageCount} messages`)}`;
		});
		if (sessions.length > 0) {
			info += `\n\n${theme.fg("dim", "/resume <number> opens one in its folder; /resume alone picks from a list.")}`;
		}
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(info, 1, 0));
		this.ui.requestRender();
	}

	/** /resume [number | name | id]: opens a saved session, in its folder. */
	private async handleResumeCommand(choice: string): Promise<void> {
		if (
			this.session.isStreaming ||
			this.session.isBashRunning ||
			this.session.isCompacting
		) {
			this.showWarning(
				"pi is working: wait for it (or press Esc), then /resume.",
			);
			return;
		}
		const sessions = await this.savedSessions();
		const current = this.sessionManager.getSessionFile();
		if (!choice) {
			this.showSessionPicker(
				sessions.filter((session) => session.path !== current),
			);
			return;
		}
		const wanted = choice.toLowerCase();
		const picked = /^\d+$/.test(choice)
			? sessions[Number(choice) - 1]
			: sessions.find(
					(session) =>
						session.name?.toLowerCase() === wanted ||
						session.id.startsWith(choice),
				);
		if (!picked) {
			this.showWarning(`No saved session "${choice}". /sessions lists them.`);
			return;
		}
		if (picked.path === current) {
			this.showStatus("That is the session you are in.");
			return;
		}
		this.resumeSession(picked);
	}

	/** Picks a saved session in place of the editor; Esc goes back. */
	private showSessionPicker(sessions: SessionInfo[]): void {
		if (sessions.length === 0) {
			this.showStatus("No other saved sessions.");
			return;
		}
		const picker = new SelectList(
			sessions.map((session) => ({
				value: session.path,
				label: sessionTitle(session),
				description: `${this.folderName(this.sessionFolder(session))} · ${ago(session.modified)} · ${session.messageCount} messages`,
			})),
			Math.min(sessions.length, 8),
			getSelectListTheme(),
		);
		const done = () => {
			this.editorContainer.clear();
			this.editorContainer.addChild(this.editor as Component);
			this.ui.setFocus(this.editor);
			this.ui.requestRender();
		};
		picker.onSelect = (item) => {
			done();
			const picked = sessions.find((session) => session.path === item.value);
			if (picked) this.resumeSession(picked);
		};
		picker.onCancel = done;
		this.editorContainer.clear();
		this.editorContainer.addChild(picker);
		this.ui.setFocus(picker);
		this.ui.requestRender();
	}

	/** pi starts again on the session, in its folder (it moves there if need be). */
	private resumeSession(session: SessionInfo): void {
		if (!this.options.onResume) {
			this.showWarning("Opening saved sessions is not available here.");
			return;
		}
		const cwd = this.sessionFolder(session);
		this.showStatus(
			cwd === this.sessionManager.getCwd()
				? "Opening the session…"
				: `Opening the session in ${this.folderName(cwd)}…`,
		);
		this.options.onResume(session.path, cwd);
	}

	/**
	 * Capitalize keybinding for display (e.g., "ctrl+c" -> "Ctrl+C").
	 */
	private capitalizeKey(key: string): string {
		return key
			.split("/")
			.map((k) =>
				k
					.split("+")
					.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
					.join("+"),
			)
			.join("/");
	}

	/**
	 * Get capitalized display string for an app keybinding action.
	 */
	private getAppKeyDisplay(action: AppKeybinding): string {
		return this.capitalizeKey(keyText(action));
	}

	/**
	 * Get capitalized display string for an editor keybinding action.
	 */
	private getEditorKeyDisplay(action: Keybinding): string {
		return this.capitalizeKey(keyText(action));
	}

	private handleHotkeysCommand(): void {
		// Navigation keybindings
		const cursorUp = this.getEditorKeyDisplay("tui.editor.cursorUp");
		const cursorDown = this.getEditorKeyDisplay("tui.editor.cursorDown");
		const cursorLeft = this.getEditorKeyDisplay("tui.editor.cursorLeft");
		const cursorRight = this.getEditorKeyDisplay("tui.editor.cursorRight");
		const cursorWordLeft = this.getEditorKeyDisplay(
			"tui.editor.cursorWordLeft",
		);
		const cursorWordRight = this.getEditorKeyDisplay(
			"tui.editor.cursorWordRight",
		);
		const cursorLineStart = this.getEditorKeyDisplay(
			"tui.editor.cursorLineStart",
		);
		const cursorLineEnd = this.getEditorKeyDisplay("tui.editor.cursorLineEnd");
		const jumpForward = this.getEditorKeyDisplay("tui.editor.jumpForward");
		const jumpBackward = this.getEditorKeyDisplay("tui.editor.jumpBackward");
		const pageUp = this.getEditorKeyDisplay("tui.editor.pageUp");
		const pageDown = this.getEditorKeyDisplay("tui.editor.pageDown");

		// Editing keybindings
		const submit = this.getEditorKeyDisplay("tui.input.submit");
		const newLine = this.getEditorKeyDisplay("tui.input.newLine");
		const deleteWordBackward = this.getEditorKeyDisplay(
			"tui.editor.deleteWordBackward",
		);
		const deleteWordForward = this.getEditorKeyDisplay(
			"tui.editor.deleteWordForward",
		);
		const deleteToLineStart = this.getEditorKeyDisplay(
			"tui.editor.deleteToLineStart",
		);
		const deleteToLineEnd = this.getEditorKeyDisplay(
			"tui.editor.deleteToLineEnd",
		);
		const yank = this.getEditorKeyDisplay("tui.editor.yank");
		const yankPop = this.getEditorKeyDisplay("tui.editor.yankPop");
		const undo = this.getEditorKeyDisplay("tui.editor.undo");
		const tab = this.getEditorKeyDisplay("tui.input.tab");

		// App keybindings
		const interrupt = this.getAppKeyDisplay("app.interrupt");
		const clear = this.getAppKeyDisplay("app.clear");
		const exit = this.getAppKeyDisplay("app.exit");
		const cycleThinkingLevel = this.getAppKeyDisplay("app.thinking.cycle");
		const selectModel = this.getAppKeyDisplay("app.model.select");
		const expandTools = this.getAppKeyDisplay("app.tools.expand");
		const toggleThinking = this.getAppKeyDisplay("app.thinking.toggle");
		const followUp = this.getAppKeyDisplay("app.message.followUp");
		const dequeue = this.getAppKeyDisplay("app.message.dequeue");

		const hotkeys = `
**Navigation**
| Key | Action |
|-----|--------|
| \`${cursorUp}\` / \`${cursorDown}\` / \`${cursorLeft}\` / \`${cursorRight}\` | Move cursor / browse history (Up when empty) |
| \`${cursorWordLeft}\` / \`${cursorWordRight}\` | Move by word |
| \`${cursorLineStart}\` | Start of line |
| \`${cursorLineEnd}\` | End of line |
| \`${jumpForward}\` | Jump forward to character |
| \`${jumpBackward}\` | Jump backward to character |
| \`${pageUp}\` / \`${pageDown}\` | Scroll by page |

**Editing**
| Key | Action |
|-----|--------|
| \`${submit}\` | Send message |
| \`${newLine}\` | New line |
| \`${deleteWordBackward}\` | Delete word backwards |
| \`${deleteWordForward}\` | Delete word forwards |
| \`${deleteToLineStart}\` | Delete to start of line |
| \`${deleteToLineEnd}\` | Delete to end of line |
| \`${yank}\` | Paste the most-recently-deleted text |
| \`${yankPop}\` | Cycle through the deleted text after pasting |
| \`${undo}\` | Undo |

**Other**
| Key | Action |
|-----|--------|
| \`${tab}\` | Path completion / accept autocomplete |
| \`${interrupt}\` | Cancel autocomplete / abort streaming |
| \`${clear}\` | Clear editor (first) / exit (second) |
| \`${exit}\` | Exit (when editor is empty) |
| \`${cycleThinkingLevel}\` | Cycle thinking level |
| \`${selectModel}\` | Show the model (chosen in the chat composer) |
| \`${expandTools}\` | Toggle tool output expansion |
| \`${toggleThinking}\` | Toggle thinking block visibility |
| \`${followUp}\` | Queue follow-up message |
| \`${dequeue}\` | Restore queued messages |
| \`/\` | Slash commands |
| \`!\` | Run bash command |
| \`!!\` | Run bash command (excluded from context) |
`;

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new DynamicBorder());
		this.chatContainer.addChild(
			new Text(theme.bold(theme.fg("accent", "Keyboard Shortcuts")), 1, 0),
		);
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(
			new Markdown(hotkeys.trim(), 1, 1, this.getMarkdownThemeWithSettings()),
		);
		this.chatContainer.addChild(new DynamicBorder());
		this.ui.requestRender();
	}

	private async handleClearCommand(): Promise<void> {
		if (this.loadingAnimation) {
			this.loadingAnimation.stop();
			this.loadingAnimation = undefined;
		}
		this.statusContainer.clear();
		try {
			await this.session.newSession();
			this.pendingTools.clear();
			this.pendingBashComponents = [];
			this.streamingComponent = undefined;
			this.streamingMessage = undefined;
			this.chatContainer.clear();
			this.pendingMessagesContainer.clear();
			this.footer.invalidate();
			this.updateEditorBorderColor();
			this.chatContainer.addChild(new Spacer(1));
			this.chatContainer.addChild(
				new Text(`${theme.fg("accent", "✓ New session started")}`, 1, 1),
			);
			this.ui.requestRender();
		} catch (error: unknown) {
			this.showError(
				`Failed to create session: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private async handleBashCommand(
		command: string,
		excludeFromContext = false,
	): Promise<void> {
		const isDeferred = this.session.isStreaming;
		this.bashComponent = new BashExecutionComponent(
			command,
			this.ui,
			excludeFromContext,
		);

		if (isDeferred) {
			// Show in pending area when agent is streaming
			this.pendingMessagesContainer.addChild(this.bashComponent);
			this.pendingBashComponents.push(this.bashComponent);
		} else {
			// Show in chat immediately when agent is idle
			this.chatContainer.addChild(this.bashComponent);
		}
		this.ui.requestRender();

		try {
			const result = await this.session.executeBash(
				command,
				(chunk) => {
					if (this.bashComponent) {
						this.bashComponent.appendOutput(chunk);
						this.ui.requestRender();
					}
				},
				{ excludeFromContext },
			);

			if (this.bashComponent) {
				this.bashComponent.setComplete(
					result.exitCode,
					result.cancelled,
					result.truncated
						? ({ truncated: true, content: result.output } as TruncationResult)
						: undefined,
					result.fullOutputPath,
				);
			}
		} catch (error) {
			if (this.bashComponent) {
				this.bashComponent.setComplete(undefined, false);
			}
			this.showError(
				`Bash command failed: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}

		this.bashComponent = undefined;
		void this.footerDataProvider.refresh();
		this.ui.requestRender();
	}

	private async handleCompactCommand(
		customInstructions?: string,
	): Promise<void> {
		const entries = this.sessionManager.getEntries();
		const messageCount = entries.filter((e) => e.type === "message").length;

		if (messageCount < 2) {
			this.showWarning("Nothing to compact (no messages yet)");
			return;
		}

		if (this.loadingAnimation) {
			this.loadingAnimation.stop();
			this.loadingAnimation = undefined;
		}
		this.statusContainer.clear();

		try {
			await this.session.compact(customInstructions);
		} catch {
			// Ignore, will be emitted as an event
		}
	}

	/**
	 * A prompt from outside the editor (the Memon agent): sent the way the
	 * editor sends one, leaving whatever the user is typing alone. While pi
	 * works it is queued: steered in after the current tool calls, or as a
	 * follow-up once pi is done. Rejects when pi cannot take it.
	 */
	async submit(
		text: string,
		queue: "steer" | "followUp" = "steer",
	): Promise<void> {
		const message = text.trim();
		if (!message) throw new Error("Nothing to send to pi.");
		if (this.session.isCompacting) {
			this.compactionQueuedMessages.push({ text: message, mode: queue });
			this.updatePendingMessagesDisplay();
			this.ui.requestRender();
			return;
		}
		if (this.session.isStreaming) {
			await this.session.prompt(message, { streamingBehavior: queue });
			this.updatePendingMessagesDisplay();
			this.ui.requestRender();
			return;
		}
		this.flushPendingBashComponents();
		const run = this.session.prompt(message);
		// The run goes on; only a prompt pi refused comes back here.
		const refused = await Promise.race([
			run.then(
				() => undefined,
				(error: unknown) => error,
			),
			new Promise<undefined>((resolve) => {
				const unsubscribe = this.session.subscribe((event) => {
					if (event.type === "agent_start") {
						unsubscribe();
						resolve(undefined);
					}
				});
				run.finally(unsubscribe).catch(() => undefined);
			}),
		]);
		if (refused !== undefined) {
			const errorMessage =
				refused instanceof Error ? refused.message : String(refused);
			this.showError(errorMessage);
			throw refused instanceof Error ? refused : new Error(errorMessage);
		}
		run.catch((error: unknown) => {
			this.showError(error instanceof Error ? error.message : String(error));
		});
	}

	/**
	 * Stops what pi is doing (a turn, a ! command, compaction or a retry) and
	 * drops the queued messages, as the Memon agent's stop.
	 */
	async interrupt(): Promise<void> {
		this.compactionQueuedMessages = [];
		this.clearAllQueues();
		this.updatePendingMessagesDisplay();
		if (this.session.isCompacting) this.session.abortCompaction();
		if (this.session.isBashRunning) this.session.abortBash();
		if (this.session.isStreaming || this.session.isRetrying) {
			await this.session.abort();
		}
		this.ui.requestRender();
	}

	/** /new from outside the editor. */
	newSession(): Promise<void> {
		return this.handleClearCommand();
	}

	/** /compact from outside the editor. */
	compact(customInstructions?: string): Promise<void> {
		return this.handleCompactCommand(customInstructions);
	}

	/** Re-draw everything (a new viewer attached or the theme changed). */
	redraw(): void {
		this.ui.invalidate();
		this.updateEditorBorderColor();
		this.ui.requestRender(true);
	}

	stop(): void {
		if (this.loadingAnimation) {
			this.loadingAnimation.stop();
			this.loadingAnimation = undefined;
		}
		this.autoCompactionLoader?.stop();
		this.retryLoader?.stop();
		this.retryCountdown?.dispose();
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.footer.dispose();
		if (this.isInitialized) {
			this.ui.stop();
			this.isInitialized = false;
		}
	}
}
