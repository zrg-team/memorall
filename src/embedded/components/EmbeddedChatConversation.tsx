import React, { useState } from "react";
import {
	Conversation,
	ConversationContent,
	Message,
	MessageContent,
	Reasoning,
	ReasoningContent,
	ReasoningTrigger,
	Source,
	Sources,
	SourcesContent,
	SourcesTrigger,
} from "@/embedded/components/MessageControl";
import { EmbeddedMessageRenderer } from "@/embedded/components/EmbeddedMessageRenderer";
import { useEmbeddedTranslation } from "@/embedded/hooks/use-embedded-language";
import type { MessageActionRequest } from "@/main/modules/chat/components/artifacts/ArtifactActionsMenu";
import type { ChatMessage, EmbeddedContextItem } from "@/embedded/types";

interface EmbeddedChatConversationProps {
	conversationRef: React.RefObject<HTMLDivElement | null>;
	onScroll: React.UIEventHandler<HTMLDivElement>;
	onWheel: React.WheelEventHandler<HTMLDivElement>;
	needsPasskey: boolean;
	noModelConfig: boolean;
	encryptedProviders: string[];
	selectedProvider: string;
	messages: ChatMessage[];
	selectedTopic: string;
	pageHost: string;
	suggestedPrompts: string[];
	primaryPageContext?: EmbeddedContextItem;
	onAttachContext: (contextItem: EmbeddedContextItem) => void;
	onSelectPrompt: (prompt: string) => void;
	onOpenMainApp: () => void;
	onPasskeySubmit: (passkey: string) => Promise<void>;
	onMessageAction?: (action: MessageActionRequest) => void | Promise<void>;
}

const formatProviderLabel = (provider: string): string =>
	provider === "openai"
		? "OpenAI"
		: provider === "openrouter"
			? "OpenRouter"
			: provider;

const AuthRequiredState = ({
	encryptedProviders,
	selectedProvider,
	onPasskeySubmit,
}: Pick<
	EmbeddedChatConversationProps,
	"encryptedProviders" | "selectedProvider" | "onPasskeySubmit"
>) => {
	const t = useEmbeddedTranslation("chat");
	const [passkey, setPasskey] = useState("");
	const [showPasskey, setShowPasskey] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState("");
	const providers =
		encryptedProviders.length > 0 ? encryptedProviders : [selectedProvider];
	const providerText = providers
		.filter(Boolean)
		.map(formatProviderLabel)
		.join(", ");

	const handleSubmit = async () => {
		if (passkey.length < 6) {
			setError(t("passkeyLengthError"));
			return;
		}
		setIsLoading(true);
		setError("");
		try {
			await onPasskeySubmit(passkey);
		} catch (err) {
			setError(err instanceof Error ? err.message : t("passkeyUnlockError"));
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className="flex flex-col items-center justify-center h-full text-center py-8 px-4">
			<div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-3">
				<svg
					className="w-6 h-6 text-amber-600 dark:text-amber-400"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={2}
						d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
					/>
				</svg>
			</div>
			<h3 className="font-medium mb-2 text-foreground">{t("authRequired")}</h3>
			<p className="text-muted-foreground text-xs leading-relaxed mb-4 max-w-sm">
				{t("passkeyInlineDescription").replace("{{providers}}", providerText)}
			</p>
			<div className="w-full max-w-sm space-y-3 text-left">
				{providerText && (
					<div className="rounded-md border border-border bg-muted/20 px-3 py-2">
						<div className="text-xs text-muted-foreground">
							{t("passkeyWillUnlock")}
						</div>
						<div className="mt-1 text-sm font-medium text-foreground">
							{providerText}
						</div>
					</div>
				)}
				<label className="block text-xs text-muted-foreground">
					{t("passkeyLabel")}
				</label>
				<div className="relative">
					<input
						type={showPasskey ? "text" : "password"}
						value={passkey}
						onChange={(event) => setPasskey(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && passkey.length >= 6 && !isLoading) {
								void handleSubmit();
							}
						}}
						disabled={isLoading}
						autoFocus
						placeholder={t("passkeyPlaceholder")}
						className="w-full rounded-md border border-border bg-background px-3 py-2 pr-12 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
					/>
					<button
						type="button"
						onClick={() => setShowPasskey((value) => !value)}
						disabled={isLoading}
						className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-60"
					>
						{showPasskey ? t("hidePasskey") : t("showPasskey")}
					</button>
				</div>
				{passkey.length > 0 && passkey.length < 6 && (
					<div className="rounded border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
						{t("passkeyLengthHint").replace("{{current}}", `${passkey.length}`)}
					</div>
				)}
				{error && (
					<div className="rounded border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
						{error}
					</div>
				)}
				<button
					type="button"
					onClick={() => void handleSubmit()}
					disabled={isLoading || passkey.length < 6}
					className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
				>
					{isLoading ? t("passkeyUnlocking") : t("passkeyUnlock")}
				</button>
				<p className="text-center text-xs text-muted-foreground">
					{t("passkeyHelpText")}
				</p>
			</div>
		</div>
	);
};

const NoModelConfigState = ({
	onOpenMainApp,
}: Pick<EmbeddedChatConversationProps, "onOpenMainApp">) => {
	const t = useEmbeddedTranslation("chat");
	return (
		<div className="flex flex-col items-center justify-center h-full text-center py-8 px-4">
			<div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
				<svg
					className="w-6 h-6 text-muted-foreground"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={2}
						d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
					/>
				</svg>
			</div>
			<h3 className="font-medium mb-2 text-foreground">{t("noModelConfig")}</h3>
			<p className="text-muted-foreground text-xs leading-relaxed mb-4">
				{t("noModelConfigDescription")}
			</p>
			<button
				onClick={onOpenMainApp}
				className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 transition-colors"
			>
				{t("configureModel")}
			</button>
		</div>
	);
};

const EmptyConversationState = ({
	pageHost,
	suggestedPrompts,
	primaryPageContext,
	onSelectPrompt,
	onAttachContext,
}: Pick<
	EmbeddedChatConversationProps,
	| "pageHost"
	| "suggestedPrompts"
	| "primaryPageContext"
	| "onSelectPrompt"
	| "onAttachContext"
>) => {
	const t = useEmbeddedTranslation("chat");
	return (
		<div className="memorall-empty-state">
			<div className="memorall-empty-logo">
				<img
					src={chrome.runtime.getURL("logo.png")}
					alt="Memorall Logo"
					className="memorall-empty-logo-image"
				/>
			</div>
			<div className="memorall-empty-kicker">
				{t("pageContext")}: {pageHost}
			</div>
			<h3 className="memorall-empty-title">{t("askAboutPage")}</h3>
			<p className="memorall-empty-description">{t("recallDescription")}</p>
			<div className="memorall-suggested-prompts">
				{suggestedPrompts.map((prompt) => (
					<button
						key={prompt}
						type="button"
						className="memorall-suggested-prompt"
						onClick={() => onSelectPrompt(prompt)}
						onKeyDown={(event) => event.stopPropagation()}
						onKeyUp={(event) => event.stopPropagation()}
						onKeyPress={(event) => event.stopPropagation()}
					>
						{prompt}
					</button>
				))}
			</div>
			{primaryPageContext && (
				<button
					type="button"
					className="memorall-context-cta"
					onClick={() => onAttachContext(primaryPageContext)}
					onKeyDown={(event) => event.stopPropagation()}
					onKeyUp={(event) => event.stopPropagation()}
					onKeyPress={(event) => event.stopPropagation()}
				>
					{t("attachPageContext")}
				</button>
			)}
		</div>
	);
};

const ChatMessageItem = ({
	message,
	messages,
	selectedTopic,
	onMessageAction,
}: {
	message: ChatMessage;
	messages: ChatMessage[];
	selectedTopic: string;
	onMessageAction?: (action: MessageActionRequest) => void | Promise<void>;
}) => (
	<div className="space-y-3 overflow-x-hidden">
		<Message role={message.role}>
			<MessageContent role={message.role}>
				<EmbeddedMessageRenderer
					message={message}
					isLoading={message.isStreaming || false}
					allMessages={messages}
					selectedTopic={selectedTopic}
					onMessageAction={onMessageAction}
				/>
			</MessageContent>
		</Message>
		{message.reasoning && message.role === "assistant" && (
			<div className="max-w-[100%]">
				<Reasoning isStreaming={message.isStreaming} defaultOpen={false}>
					<ReasoningTrigger />
					<ReasoningContent>{message.reasoning}</ReasoningContent>
				</Reasoning>
			</div>
		)}
		{message.sources &&
			message.sources.length > 0 &&
			message.role === "assistant" && (
				<div className="max-w-[100%]">
					<Sources>
						<SourcesTrigger count={message.sources.length} />
						<SourcesContent>
							{message.sources.map((source, index) => (
								<Source
									key={`${source.url}-${index}`}
									href={source.url}
									title={source.title}
								/>
							))}
						</SourcesContent>
					</Sources>
				</div>
			)}
	</div>
);

export const EmbeddedChatConversation = ({
	conversationRef,
	onScroll,
	onWheel,
	needsPasskey,
	noModelConfig,
	encryptedProviders,
	selectedProvider,
	messages,
	selectedTopic,
	pageHost,
	suggestedPrompts,
	primaryPageContext,
	onAttachContext,
	onSelectPrompt,
	onOpenMainApp,
	onPasskeySubmit,
	onMessageAction,
}: EmbeddedChatConversationProps) => (
	<Conversation
		ref={conversationRef}
		className="flex-1 overflow-y-auto overscroll-contain"
		onScroll={onScroll}
		onWheel={onWheel}
	>
		<ConversationContent className="space-y-4">
			{needsPasskey ? (
				<AuthRequiredState
					encryptedProviders={encryptedProviders}
					selectedProvider={selectedProvider}
					onPasskeySubmit={onPasskeySubmit}
				/>
			) : noModelConfig ? (
				<NoModelConfigState onOpenMainApp={onOpenMainApp} />
			) : messages.length === 0 ? (
				<EmptyConversationState
					pageHost={pageHost}
					suggestedPrompts={suggestedPrompts}
					primaryPageContext={primaryPageContext}
					onSelectPrompt={onSelectPrompt}
					onAttachContext={onAttachContext}
				/>
			) : (
				messages.map((message) => (
					<ChatMessageItem
						key={message.id}
						message={message}
						messages={messages}
						selectedTopic={selectedTopic}
						onMessageAction={onMessageAction}
					/>
				))
			)}
		</ConversationContent>
	</Conversation>
);
