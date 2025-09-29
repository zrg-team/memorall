import React, {
	useCallback,
	useEffect,
	useState,
	type FormEventHandler,
} from "react";
import { createRoot } from "react-dom/client";
import { nanoid } from "nanoid";
import type { ChatModalProps, ChatMessage } from "../types";
import { embeddedChatService } from "../chat-service";
import { backgroundJob } from "@/services/background-jobs/background-job";

// Mock implementations of shadcn/ui AI components for content script context
// These replicate the exact structure and styling from your example

const Conversation: React.FC<{
	className?: string;
	children: React.ReactNode;
}> = ({ className, children }) => (
	<div className={`relative ${className || ""}`}>{children}</div>
);

const ConversationContent: React.FC<{
	className?: string;
	children: React.ReactNode;
}> = ({ className, children }) => (
	<div className={`overflow-y-auto px-4 py-4 ${className || ""}`}>
		{children}
	</div>
);

const ConversationScrollButton: React.FC = () => (
	<button className="absolute bottom-2 right-2 rounded-full bg-background border shadow-sm p-2 hover:bg-muted transition-colors">
		<svg
			className="w-4 h-4"
			fill="none"
			stroke="currentColor"
			viewBox="0 0 24 24"
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M19 14l-7 7m0 0l-7-7m7 7V3"
			/>
		</svg>
	</button>
);

const Message: React.FC<{
	role: "user" | "assistant";
	children: React.ReactNode;
}> = ({ role, children }) => (
	<div
		className={`flex flex-col gap-2 ${role === "user" ? "items-end" : "items-start"}`}
	>
		{children}
	</div>
);

const MessageContent: React.FC<{
	role: "user" | "assistant";
	children: React.ReactNode;
}> = ({ role, children }) => (
	<div
		className={`p-3 text-sm max-w-[85%] ${
			role === "user" ? "ml-auto text-foreground" : "bg-muted rounded-lg"
		}`}
	>
		{children}
	</div>
);

const Loader: React.FC<{ size?: number }> = ({ size = 16 }) => (
	<div
		className="animate-spin rounded-full border-2 border-muted border-t-primary"
		style={{ width: size, height: size }}
	/>
);

const Reasoning: React.FC<{
	isStreaming?: boolean;
	defaultOpen?: boolean;
	children: React.ReactNode;
}> = ({ isStreaming, defaultOpen = false, children }) => (
	<details className="group" open={defaultOpen}>
		{children}
	</details>
);

const ReasoningTrigger: React.FC = () => (
	<summary className="cursor-pointer flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground p-2 rounded border bg-muted/50">
		<svg
			className="w-3 h-3 group-open:rotate-90 transition-transform"
			fill="currentColor"
			viewBox="0 0 20 20"
		>
			<path
				fillRule="evenodd"
				d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
				clipRule="evenodd"
			/>
		</svg>
		<span>💭 Reasoning</span>
	</summary>
);

const ReasoningContent: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => (
	<div className="mt-2 p-3 text-xs text-muted-foreground bg-muted/30 rounded border">
		{children}
	</div>
);

const Sources: React.FC<{ children: React.ReactNode }> = ({ children }) => (
	<details className="group">{children}</details>
);

const SourcesTrigger: React.FC<{ count: number }> = ({ count }) => (
	<summary className="cursor-pointer flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground p-2 rounded border bg-muted/50">
		<svg
			className="w-3 h-3 group-open:rotate-90 transition-transform"
			fill="currentColor"
			viewBox="0 0 20 20"
		>
			<path
				fillRule="evenodd"
				d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
				clipRule="evenodd"
			/>
		</svg>
		<span>🔗 Sources ({count})</span>
	</summary>
);

const SourcesContent: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => <div className="mt-2 space-y-2">{children}</div>;

const Source: React.FC<{ href: string; title: string }> = ({ href, title }) => (
	<div className="p-2 bg-muted/30 rounded border text-xs">
		<div className="font-medium">{title}</div>
		{href !== "#" && (
			<div className="text-muted-foreground text-xs mt-1">{href}</div>
		)}
	</div>
);

const PromptInput: React.FC<{
	onSubmit: FormEventHandler<HTMLFormElement>;
	children: React.ReactNode;
}> = ({ onSubmit, children }) => (
	<form
		onSubmit={onSubmit}
		className="relative border rounded-lg bg-background"
	>
		{children}
	</form>
);

const PromptInputTextarea: React.FC<{
	value: string;
	onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
	placeholder: string;
	disabled: boolean;
}> = ({ value, onChange, placeholder, disabled }) => (
	<textarea
		value={value}
		onChange={onChange}
		placeholder={placeholder}
		disabled={disabled}
		className="w-full resize-none border-0 bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 min-h-[50px] max-h-32"
		onKeyDown={(e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				const form = e.currentTarget.closest("form");
				if (form) {
					form.requestSubmit();
				}
			}
		}}
	/>
);

const PromptInputToolbar: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => (
	<div className="flex items-center justify-between border-t px-3 py-2">
		{children}
	</div>
);

const PromptInputTools: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => <div className="flex items-center gap-1">{children}</div>;

const PromptInputButton: React.FC<{
	disabled?: boolean;
	children: React.ReactNode;
}> = ({ disabled, children }) => (
	<button
		type="button"
		disabled={disabled}
		className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-8 px-2 gap-1"
	>
		{children}
	</button>
);

const PromptInputSubmit: React.FC<{
	disabled: boolean;
	status: "ready" | "streaming";
	onStop?: () => void;
}> = ({ disabled, status, onStop }) => (
	<button
		type={status === "streaming" ? "button" : "submit"}
		disabled={disabled}
		onClick={status === "streaming" ? onStop : undefined}
		className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-8 px-3"
	>
		{status === "streaming" ? (
			<>
				<Loader size={14} />
				<span className="ml-1">Stop</span>
			</>
		) : (
			"Send"
		)}
	</button>
);

const Button: React.FC<{
	variant?: "ghost";
	size?: "sm";
	onClick?: () => void;
	className?: string;
	children: React.ReactNode;
}> = ({ variant, size, onClick, className, children }) => (
	<button
		onClick={onClick}
		className={`inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 ${
			variant === "ghost"
				? "hover:bg-accent hover:text-accent-foreground"
				: "bg-primary text-primary-foreground hover:bg-primary/90"
		} ${size === "sm" ? "h-8 px-3" : "h-10 px-4 py-2"} ${className || ""}`}
	>
		{children}
	</button>
);

// Icons (simplified versions)
const PaperclipIcon: React.FC<{ size: number }> = ({ size }) => (
	<svg
		width={size}
		height={size}
		fill="none"
		stroke="currentColor"
		viewBox="0 0 24 24"
	>
		<path
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth={2}
			d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
		/>
	</svg>
);

const MicIcon: React.FC<{ size: number }> = ({ size }) => (
	<svg
		width={size}
		height={size}
		fill="none"
		stroke="currentColor"
		viewBox="0 0 24 24"
	>
		<path
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth={2}
			d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
		/>
	</svg>
);

const RotateCcwIcon: React.FC<{ className: string }> = ({ className }) => (
	<svg
		className={className}
		fill="none"
		stroke="currentColor"
		viewBox="0 0 24 24"
	>
		<path
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth={2}
			d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
		/>
	</svg>
);

// Main component following your exact example structure
// Model status component following LLMPage.tsx pattern
const ModelStatus: React.FC<{
	modelId?: string;
	provider?: string;
	isActive: boolean;
}> = ({ modelId, provider, isActive }) => {
	if (isActive && modelId && provider) {
		return (
			<div className="flex items-center gap-2 px-3 py-2 bg-primary/10 border border-primary/20 rounded-lg">
				<div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
				<div className="flex-1">
					<div className="font-semibold text-xs text-foreground">{modelId}</div>
					<div className="text-xs text-muted-foreground">{provider}</div>
				</div>
				<div className="text-xs font-medium text-primary">Active</div>
			</div>
		);
	}

	if (provider && !modelId) {
		return (
			<div className="flex items-center gap-2 px-3 py-2 bg-orange-50 border border-orange-200 rounded-lg dark:bg-orange-950 dark:border-orange-800">
				<div className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
				<div className="flex-1">
					<div className="font-semibold text-xs text-foreground">
						Provider: {provider}
					</div>
					<div className="text-xs text-muted-foreground">No model selected</div>
				</div>
				<div className="text-xs font-medium text-orange-600 dark:text-orange-400">
					Configured
				</div>
			</div>
		);
	}

	return (
		<div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border border-border rounded-lg">
			<div className="w-2 h-2 rounded-full bg-muted" />
			<div className="flex-1">
				<div className="font-semibold text-xs text-muted-foreground">
					No model available
				</div>
				<div className="text-xs text-muted-foreground">
					Configure a model in settings
				</div>
			</div>
			<div className="text-xs font-medium text-muted-foreground">Inactive</div>
		</div>
	);
};

// Compact header version of model status
const HeaderModelStatus: React.FC<{
	modelId?: string;
	provider?: string;
	isActive: boolean;
}> = ({ modelId, provider, isActive }) => {
	if (isActive && modelId && provider) {
		return (
			<div className="flex items-center gap-1 text-xs">
				<div className="w-1.5 h-1.5 rounded-full bg-green-500" />
				<span className="text-foreground font-medium truncate">{modelId}</span>
			</div>
		);
	}

	return (
		<div className="flex items-center gap-1 text-xs">
			<div className="w-1.5 h-1.5 rounded-full bg-red-500" />
			<span className="text-muted-foreground">No model</span>
		</div>
	);
};

const ShadcnEmbeddedChat: React.FC<ChatModalProps> = ({
	context,
	mode = "general",
	pageUrl,
	pageTitle,
	onClose,
}) => {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [inputValue, setInputValue] = useState("");
	const [selectedModel, setSelectedModel] = useState<string>("");
	const [selectedProvider, setSelectedProvider] = useState<string>("");
	const [modelAvailable, setModelAvailable] = useState(false);
	const [isTyping, setIsTyping] = useState(false);
	const [streamingMessageId, setStreamingMessageId] = useState<string | null>(
		null,
	);
	const [abortController, setAbortController] =
		useState<AbortController | null>(null);

	// Initialize model and check status
	useEffect(() => {
		const initializeModel = async () => {
			try {
				// Get current model from the service
				const result = await backgroundJob.execute(
					"get-current-model",
					{},
					{ stream: false },
				);

				if (!("promise" in result)) {
					return;
				}
				const jobResult = await result.promise;

				if (jobResult.status === "completed" && jobResult.result) {
					const modelInfo = jobResult.result.modelInfo;
					if (
						modelInfo &&
						typeof modelInfo === "object" &&
						"modelId" in modelInfo &&
						"provider" in modelInfo
					) {
						setSelectedModel(`${modelInfo.modelId}`);
						setSelectedProvider(`${modelInfo.provider}`);
						setModelAvailable(true);
					} else {
						setModelAvailable(false);
					}
				}
			} catch (error) {
				console.error("Failed to initialize model:", error);
				setModelAvailable(false);
			}
		};
		initializeModel();
	}, []);

	// Add initial context if provided
	useEffect(() => {
		if (context) {
			const contextMessage: ChatMessage = {
				id: nanoid(),
				content: `Context from page: "${context}"`,
				role: "user",
				timestamp: new Date(),
			};
			setMessages((prev) => [...prev, contextMessage]);

			// Auto-populate input with query
			const autoQuery =
				mode === "topic"
					? `Tell me about topics related to: ${context}`
					: `What do you know about: ${context}`;
			setInputValue(autoQuery);
		}
	}, [context, mode]);

	const handleStop = useCallback(() => {
		if (abortController) {
			abortController.abort();
			setAbortController(null);
			setIsTyping(false);
			setStreamingMessageId(null);
		}
	}, [abortController]);

	const handleSubmit: FormEventHandler<HTMLFormElement> = useCallback(
		async (event) => {
			event.preventDefault();

			if (!inputValue.trim() || isTyping || !modelAvailable || !selectedModel)
				return;

			const userMessageContent = inputValue.trim();
			setInputValue("");
			setIsTyping(true);

			// Create abort controller for this request
			const controller = new AbortController();
			setAbortController(controller);

			// Add user message
			const userMessage: ChatMessage = {
				id: nanoid(),
				content: userMessageContent,
				role: "user",
				timestamp: new Date(),
			};
			setMessages((prev) => [...prev, userMessage]);

			// Create assistant message placeholder
			const assistantMessageId = nanoid();
			const assistantMessage: ChatMessage = {
				id: assistantMessageId,
				content: "",
				role: "assistant",
				timestamp: new Date(),
				isStreaming: true,
			};
			setMessages((prev) => [...prev, assistantMessage]);
			setStreamingMessageId(assistantMessageId);

			try {
				const allMessages = [...messages, userMessage];

				await embeddedChatService.chatStream({
					messages: allMessages,
					model: selectedModel,
					mode: mode === "topic" ? "knowledge" : "knowledge",
					signal: controller.signal,
					onProgress: (content: string, isComplete: boolean) => {
						setMessages((prev) =>
							prev.map((msg) => {
								if (msg.id === assistantMessageId) {
									return {
										...msg,
										content,
										isStreaming: !isComplete,
									};
								}
								return msg;
							}),
						);
					},
					onError: (error: string) => {
						console.error("Chat error:", error);

						// Update message with error
						setMessages((prev) =>
							prev.map((msg) => {
								if (msg.id === assistantMessageId) {
									return {
										...msg,
										content:
											"Sorry, I encountered an error while processing your request. Please try again.",
										isStreaming: false,
									};
								}
								return msg;
							}),
						);

						setIsTyping(false);
						setStreamingMessageId(null);
						setAbortController(null);
					},
				});
			} catch (error) {
				console.error("Chat submission error:", error);

				// Update message with error
				setMessages((prev) =>
					prev.map((msg) => {
						if (msg.id === assistantMessageId) {
							return {
								...msg,
								content:
									"Sorry, I encountered an error while processing your request. Please try again.",
								isStreaming: false,
							};
						}
						return msg;
					}),
				);
			} finally {
				setIsTyping(false);
				setStreamingMessageId(null);
				setAbortController(null);
			}
		},
		[inputValue, isTyping, selectedModel, messages, mode],
	);

	const handleReset = useCallback(() => {
		setMessages([]);
		setInputValue("");
		setIsTyping(false);
		setStreamingMessageId(null);
	}, [mode]);

	return (
		<div
			className="fixed inset-0 z-[999999] bg-black/30 animate-in fade-in duration-200"
			onClick={onClose}
		>
			<div
				className="fixed right-0 top-0 h-full w-full max-w-[30%] min-w-[400px] flex flex-col overflow-hidden bg-background shadow-2xl border-l animate-in slide-in-from-right duration-300"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header - compact design for right panel */}
				<div className="flex items-center justify-between border-b bg-muted/50 px-4 py-3 flex-shrink-0">
					<div className="flex items-center gap-3">
						<span className="font-medium text-sm">
							{mode === "topic" ? "📚 Recall Topic" : "🧠 Recall"}
						</span>
						<HeaderModelStatus
							modelId={selectedModel}
							provider={selectedProvider}
							isActive={modelAvailable && !!selectedModel}
						/>
					</div>
					<Button
						variant="ghost"
						size="sm"
						onClick={onClose}
						className="h-8 w-8 p-0 !px-0"
					>
						<svg
							className="w-4 h-4"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M6 18L18 6M6 6l12 12"
							/>
						</svg>
					</Button>
				</div>

				{/* Conversation Area - exact same structure as your example */}
				<Conversation className="flex-1">
					<ConversationContent className="space-y-4">
						{messages.length === 0 ? (
							<div className="flex flex-col items-center justify-center h-full text-center py-8 px-4">
								<div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3 overflow-hidden">
									<img
										src={chrome.runtime.getURL("logo.png")}
										alt="Memorall Logo"
										className="w-8 h-8 object-contain"
									/>
								</div>
								<h3 className="font-medium mb-2">Recall Knowledge</h3>
								<p className="text-muted-foreground text-xs leading-relaxed">
									Ask me anything about your saved knowledge and I'll help you
									recall relevant information.
								</p>
							</div>
						) : (
							messages.map((message) => (
								<div key={message.id} className="space-y-3">
									<Message role={message.role}>
										<MessageContent role={message.role}>
											{message.isStreaming && message.content === "" ? (
												<div className="flex items-center gap-2">
													<Loader size={14} />
													<span className="text-muted-foreground text-sm">
														Recalling...
													</span>
												</div>
											) : (
												message.content
											)}
										</MessageContent>
									</Message>
									{/* Reasoning - only for AI messages */}
									{message.reasoning && message.role === "assistant" && (
										<div className="max-w-[85%]">
											<Reasoning
												isStreaming={message.isStreaming}
												defaultOpen={false}
											>
												<ReasoningTrigger />
												<ReasoningContent>{message.reasoning}</ReasoningContent>
											</Reasoning>
										</div>
									)}
									{/* Sources - only for AI messages */}
									{message.sources &&
										message.sources.length > 0 &&
										message.role === "assistant" && (
											<div className="max-w-[85%]">
												<Sources>
													<SourcesTrigger count={message.sources.length} />
													<SourcesContent>
														{message.sources.map((source, index) => (
															<Source
																key={index}
																href={source.url}
																title={source.title}
															/>
														))}
													</SourcesContent>
												</Sources>
											</div>
										)}
								</div>
							))
						)}
					</ConversationContent>
					<ConversationScrollButton />
				</Conversation>

				{/* Input Area - compact design for right panel */}
				<div className="border-t p-3 flex-shrink-0">
					<PromptInput onSubmit={handleSubmit}>
						<PromptInputTextarea
							value={inputValue}
							onChange={(e) => setInputValue(e.target.value)}
							placeholder={
								mode === "topic"
									? "Ask about topics..."
									: "Ask about your knowledge..."
							}
							disabled={isTyping || !modelAvailable || !selectedModel}
						/>
						<PromptInputToolbar>
							<PromptInputTools>
								<span className="text-xs text-muted-foreground">
									{mode === "topic" ? "Topics" : "Knowledge"}
								</span>
							</PromptInputTools>
							<PromptInputSubmit
								disabled={
									!inputValue.trim() ||
									isTyping ||
									!modelAvailable ||
									!selectedModel
								}
								status={isTyping ? "streaming" : "ready"}
								onStop={handleStop}
							/>
						</PromptInputToolbar>
					</PromptInput>
				</div>
			</div>
		</div>
	);
};

// Function to create and mount the shadcn-style chat modal with Shadow DOM isolation
export function createShadcnEmbeddedChatModal(
	props: ChatModalProps,
): () => void {
	// Create container element
	const container = document.createElement("div");
	container.id = "memorall-embedded-chat-modal";

	// Create Shadow DOM for complete CSS isolation
	const shadowRoot = container.attachShadow({ mode: "closed" });

	// Create the actual content container inside shadow DOM
	const shadowContainer = document.createElement("div");
	shadowContainer.className = "memorall-chat-container";

	// Inject Tailwind CSS only within the Shadow DOM
	const tailwindStyle = document.createElement("link");
	tailwindStyle.rel = "stylesheet";
	tailwindStyle.href = chrome.runtime.getURL("action/default_popup.css");

	// Add CSS custom properties for proper theming within Shadow DOM
	const customPropsStyle = document.createElement("style");
	customPropsStyle.textContent = `
		:host {
			/* Ensure the shadow DOM inherits font settings */
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
		}

		/* CSS custom properties for shadcn/ui theming */
		.memorall-chat-container {
			--background: 0 0% 100%;
			--foreground: 0 0% 3.9%;
			--card: 0 0% 100%;
			--card-foreground: 0 0% 3.9%;
			--popover: 0 0% 100%;
			--popover-foreground: 0 0% 3.9%;
			--primary: 0 0% 9%;
			--primary-foreground: 0 0% 98%;
			--secondary: 0 0% 96.1%;
			--secondary-foreground: 0 0% 9%;
			--muted: 0 0% 96.1%;
			--muted-foreground: 0 0% 45.1%;
			--accent: 0 0% 96.1%;
			--accent-foreground: 0 0% 9%;
			--destructive: 0 84.2% 60.2%;
			--destructive-foreground: 0 0% 98%;
			--border: 0 0% 89.8%;
			--input: 0 0% 89.8%;
			--ring: 0 0% 3.9%;
			--radius: 0.5rem;
		}

		@media (prefers-color-scheme: dark) {
			.memorall-chat-container {
				--background: 0 0% 3.9%;
				--foreground: 0 0% 98%;
				--card: 0 0% 3.9%;
				--card-foreground: 0 0% 98%;
				--popover: 0 0% 3.9%;
				--popover-foreground: 0 0% 98%;
				--primary: 0 0% 98%;
				--primary-foreground: 0 0% 9%;
				--secondary: 0 0% 14.9%;
				--secondary-foreground: 0 0% 98%;
				--muted: 0 0% 14.9%;
				--muted-foreground: 0 0% 63.9%;
				--accent: 0 0% 14.9%;
				--accent-foreground: 0 0% 98%;
				--destructive: 0 62.8% 30.6%;
				--destructive-foreground: 0 0% 98%;
				--border: 0 0% 14.9%;
				--input: 0 0% 14.9%;
				--ring: 0 0% 83.1%;
			}
		}
	`;

	// Add styles to shadow DOM in correct order
	shadowRoot.appendChild(customPropsStyle);
	shadowRoot.appendChild(tailwindStyle);
	shadowRoot.appendChild(shadowContainer);

	// Create root and render inside shadow DOM
	const root = createRoot(shadowContainer);

	const cleanupModal = () => {
		root.unmount();
		container.remove();
	};

	const modalProps = {
		...props,
		onClose: () => {
			props.onClose();
			cleanupModal();
		},
	};

	root.render(<ShadcnEmbeddedChat {...modalProps} />);

	// Append to body
	document.body.appendChild(container);

	// Return cleanup function
	return cleanupModal;
}

export default ShadcnEmbeddedChat;
