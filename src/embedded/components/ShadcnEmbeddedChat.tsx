import React, {
	useCallback,
	useEffect,
	useState,
	type FormEventHandler,
} from "react";
import { createRoot } from "react-dom/client";
import { nanoid } from "nanoid";
import type { ChatModalProps, ChatMessage } from "../types";

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
	from: "user" | "assistant";
	children: React.ReactNode;
}> = ({ from, children }) => (
	<div
		className={`flex gap-3 ${from === "user" ? "justify-end" : "justify-start"}`}
	>
		{children}
	</div>
);

const MessageContent: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => (
	<div className="flex-1 space-y-2">
		<div className="rounded-lg bg-muted p-3 text-sm">{children}</div>
	</div>
);

const MessageAvatar: React.FC<{ src: string; name: string }> = ({
	src,
	name,
}) => (
	<div className="w-8 h-8 rounded-full overflow-hidden border flex-shrink-0">
		<img src={src} alt={name} className="w-full h-full object-cover" />
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
}> = ({ disabled, status }) => (
	<button
		type="submit"
		disabled={disabled}
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

// Sample responses (same as your example)
const sampleResponses = [
	{
		content:
			"Based on your knowledge base, I found some relevant information about this topic. Let me share what I discovered from your saved content.",
		reasoning:
			"The user is asking about a topic that appears in their knowledge base. I should provide a helpful overview while referencing their saved information to give a more targeted response.",
		sources: [
			{ title: "Knowledge Base Entry #1", url: "#" },
			{ title: "Related Research Notes", url: "#" },
		],
	},
	{
		content:
			"I've searched through your knowledge base and found several related entries. Here's what I can tell you based on your previous research and saved information.",
		reasoning:
			"The user's query matches content in their personal knowledge collection. I should explain the relationships and highlight key insights from their stored materials.",
		sources: [
			{ title: "Saved Article: Topic Overview", url: "#" },
			{ title: "Personal Notes", url: "#" },
		],
	},
	{
		content:
			"From your personal knowledge collection, I can see you've explored this topic before. Let me compile the most relevant information for you.",
		reasoning:
			"This query relates to previously saved content in the user's knowledge base. I should synthesize the information while keeping the explanation accessible and relevant.",
		sources: [
			{ title: "Research Collection", url: "#" },
			{ title: "Bookmarked Resources", url: "#" },
		],
	},
];

// Main component following your exact example structure
const ShadcnEmbeddedChat: React.FC<ChatModalProps> = ({
	context,
	mode = "general",
	pageUrl,
	pageTitle,
	onClose,
}) => {
	const [messages, setMessages] = useState<ChatMessage[]>([]);

	const [inputValue, setInputValue] = useState("");
	const [selectedModel] = useState("knowledge-recall");
	const [isTyping, setIsTyping] = useState(false);
	const [streamingMessageId, setStreamingMessageId] = useState<string | null>(
		null,
	);

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

	const simulateTyping = useCallback(
		(
			messageId: string,
			content: string,
			reasoning?: string,
			sources?: Array<{ title: string; url: string }>,
		) => {
			let currentIndex = 0;
			const typeInterval = setInterval(() => {
				setMessages((prev) =>
					prev.map((msg) => {
						if (msg.id === messageId) {
							const currentContent = content.slice(0, currentIndex);
							return {
								...msg,
								content: currentContent,
								isStreaming: currentIndex < content.length,
								reasoning:
									currentIndex >= content.length ? reasoning : undefined,
								sources: currentIndex >= content.length ? sources : undefined,
							};
						}
						return msg;
					}),
				);
				currentIndex += Math.random() > 0.1 ? 1 : 0; // Simulate variable typing speed

				if (currentIndex >= content.length) {
					clearInterval(typeInterval);
					setIsTyping(false);
					setStreamingMessageId(null);
				}
			}, 50);
			return () => clearInterval(typeInterval);
		},
		[],
	);

	const handleSubmit: FormEventHandler<HTMLFormElement> = useCallback(
		(event) => {
			event.preventDefault();

			if (!inputValue.trim() || isTyping) return;

			// Add user message
			const userMessage: ChatMessage = {
				id: nanoid(),
				content: inputValue.trim(),
				role: "user",
				timestamp: new Date(),
			};
			setMessages((prev) => [...prev, userMessage]);
			setInputValue("");
			setIsTyping(true);

			// Simulate AI response with delay
			setTimeout(() => {
				const responseData =
					sampleResponses[Math.floor(Math.random() * sampleResponses.length)];
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

				// Start typing simulation
				simulateTyping(
					assistantMessageId,
					responseData.content,
					responseData.reasoning,
					responseData.sources,
				);
			}, 800);
		},
		[inputValue, isTyping, simulateTyping],
	);

	const handleReset = useCallback(() => {
		setMessages([]);
		setInputValue("");
		setIsTyping(false);
		setStreamingMessageId(null);
	}, [mode]);

	return (
		<div className="fixed inset-0 z-[999999] bg-black/80 flex items-center justify-center p-4">
			<div className="flex h-full w-full max-w-4xl max-h-[90vh] flex-col overflow-hidden rounded-xl border bg-background shadow-sm">
				{/* Header - exact same structure as your example */}
				<div className="flex items-center justify-between border-b bg-muted/50 px-4 py-3">
					<div className="flex items-center gap-3">
						<div className="flex items-center gap-2">
							<div className="size-2 rounded-full bg-green-500" />
							<span className="font-medium text-sm">
								{mode === "topic" ? "📚 Recall Topic" : "🧠 Recall Knowledge"}
							</span>
						</div>
						<div className="h-4 w-px bg-border" />
						<span className="text-muted-foreground text-xs">
							{pageTitle?.substring(0, 30) || "Knowledge Recall"}
						</span>
					</div>
					<Button
						variant="ghost"
						size="sm"
						onClick={onClose}
						className="h-8 px-2"
					>
						<RotateCcwIcon className="size-4" />
						<span className="ml-1">Close</span>
					</Button>
				</div>

				{/* Conversation Area - exact same structure as your example */}
				<Conversation className="flex-1">
					<ConversationContent className="space-y-4">
						{messages.length === 0 ? (
							<div className="flex flex-col items-center justify-center h-full text-center py-12">
								<div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
									<span className="text-2xl">🧠</span>
								</div>
								<h3 className="text-lg font-medium mb-2">Recall Knowledge</h3>
								<p className="text-muted-foreground text-sm max-w-sm">
									Ask me anything about your saved knowledge and I'll help you
									recall relevant information.
								</p>
							</div>
						) : (
							messages.map((message) => (
								<div key={message.id} className="space-y-3">
									<Message from={message.role}>
										<MessageContent>
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
										<MessageAvatar
											src={
												message.role === "user"
													? "https://github.com/dovazencot.png"
													: "https://github.com/vercel.png"
											}
											name={message.role === "user" ? "User" : "AI"}
										/>
									</Message>
									{/* Reasoning - exact same structure */}
									{message.reasoning && (
										<div className="ml-10">
											<Reasoning
												isStreaming={message.isStreaming}
												defaultOpen={false}
											>
												<ReasoningTrigger />
												<ReasoningContent>{message.reasoning}</ReasoningContent>
											</Reasoning>
										</div>
									)}
									{/* Sources - exact same structure */}
									{message.sources && message.sources.length > 0 && (
										<div className="ml-10">
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

				{/* Input Area - exact same structure as your example */}
				<div className="border-t p-4">
					<PromptInput onSubmit={handleSubmit}>
						<PromptInputTextarea
							value={inputValue}
							onChange={(e) => setInputValue(e.target.value)}
							placeholder={
								mode === "topic"
									? "Ask about specific topics in your knowledge base..."
									: "What would you like to recall from your knowledge base?"
							}
							disabled={isTyping}
						/>
						<PromptInputToolbar>
							<PromptInputTools>
								<PromptInputButton disabled={isTyping}>
									<PaperclipIcon size={16} />
								</PromptInputButton>
								<PromptInputButton disabled={isTyping}>
									<MicIcon size={16} />
									<span>Voice</span>
								</PromptInputButton>
								<span className="text-xs text-muted-foreground px-2">
									{mode === "topic" ? "Topic Mode" : "Knowledge Mode"}
								</span>
							</PromptInputTools>
							<PromptInputSubmit
								disabled={!inputValue.trim() || isTyping}
								status={isTyping ? "streaming" : "ready"}
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
