/**
 * Memorall's assistant beside a hosted app that has none of its own (PDF):
 * it reads and changes the open file with the app's commands, answered by
 * the chat model chosen in Memorall. Its changes are writes to the file like
 * the agent's, so the app beside it opens the file again and shows them.
 */
import {
	Loader2,
	RotateCcw,
	SendHorizontal,
	Sparkles,
	Square,
	X,
} from "lucide-react";
import type React from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from "@/main/components/ui/shadcn-io/ai/conversation";
import { Response } from "@/main/components/ui/shadcn-io/ai/response";
import { Textarea } from "@/main/components/ui/textarea";
import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
import { toFlowFileSystem } from "@/services/flow-service-adapters";
import type { HostedAppAi } from "@/services/memon/apps/hosted/ai";
import {
	type HostedAssistantEvent,
	runHostedAssistant,
} from "@/services/memon/apps/hosted/assistant";
import {
	HOSTED_APPS,
	type HostedAppId,
} from "@/services/memon/apps/hosted/catalog";
import { loadHostedEngine } from "@/services/memon/apps/hosted/engines";
import {
	hostedEngineServices,
	hostedFileAccess,
} from "@/services/memon/apps/hosted/flow-files";
import type { ChatCompletionMessageParam } from "@/types/openai";

interface HostedAssistantPanelProps {
	app: HostedAppId;
	/** The open file. */
	path: string;
	ai: HostedAppAi;
	onClose: () => void;
	className?: string;
}

interface Entry {
	id: number;
	/** The user's message, the assistant's answer, or what it did to the file. */
	kind: "user" | "assistant" | "activity";
	text: string;
	failed?: boolean;
}

export const HostedAssistantPanel: React.FC<HostedAssistantPanelProps> = ({
	app,
	path,
	ai,
	onClose,
	className,
}) => {
	const { t } = useTranslation("documents");
	const [entries, setEntries] = useState<Entry[]>([]);
	const [draft, setDraft] = useState("");
	const [running, setRunning] = useState(false);
	const transcript = useRef<ChatCompletionMessageParam[]>([]);
	const controller = useRef<AbortController | null>(null);
	const sequence = useRef(0);
	const { files, services } = useMemo(() => {
		const fs = toFlowFileSystem(documentFileSystemService);
		return { files: hostedFileAccess(fs), services: hostedEngineServices(fs) };
	}, []);
	const name = path.split("/").pop() ?? path;

	const add = useCallback((entry: Omit<Entry, "id">) => {
		const id = ++sequence.current;
		setEntries((list) => [...list, { ...entry, id }]);
		return id;
	}, []);

	const send = useCallback(async () => {
		const message = draft.trim();
		if (!message || running) return;
		setDraft("");
		setRunning(true);
		add({ kind: "user", text: message });
		const stop = new AbortController();
		controller.current = stop;
		// Words go to the answer being written; commands end it, and what is
		// said after them starts a new one.
		let answer: number | null = null;
		const onEvent = (event: HostedAssistantEvent) => {
			if (event.type === "text") {
				if (answer === null) answer = add({ kind: "assistant", text: "" });
				const id = answer;
				setEntries((list) =>
					list.map((entry) =>
						entry.id === id
							? { ...entry, text: entry.text + event.text }
							: entry,
					),
				);
				return;
			}
			answer = null;
			if (event.type === "run")
				add({
					kind: "activity",
					text: t("hostedApp.assistant.running", {
						defaultValue: "Running {{commands}}…",
						commands: event.calls.map((call) => call.name).join(", "),
					}),
				});
			else if (event.type === "ran") {
				// Commands before a failed one are kept; those after it are skipped.
				const failed = event.result.outcomes.filter(
					(outcome) => !outcome.ok && !outcome.skipped,
				).length;
				const done = event.result.saved
					? t("hostedApp.assistant.saved", {
							defaultValue: "Saved {{name}}.",
							name,
						})
					: t("hostedApp.assistant.read", {
							defaultValue: "Read {{name}}.",
							name,
						});
				add({
					kind: "activity",
					failed: failed > 0,
					text: failed
						? `${t("hostedApp.assistant.failed", {
								defaultValue: "{{count}} command failed.",
								count: failed,
							})}${event.result.saved ? ` ${done}` : ""}`
						: done,
				});
			} else add({ kind: "activity", failed: true, text: event.reason });
		};
		try {
			await runHostedAssistant({
				path,
				transcript: transcript.current,
				message,
				ai,
				files,
				loadEngine: loadHostedEngine,
				services,
				signal: stop.signal,
				onEvent,
			});
		} catch (error) {
			add({
				kind: "activity",
				failed: !stop.signal.aborted,
				text: stop.signal.aborted
					? t("hostedApp.assistant.stopped", { defaultValue: "Stopped." })
					: error instanceof Error
						? error.message
						: String(error),
			});
		} finally {
			controller.current = null;
			setRunning(false);
		}
	}, [add, ai, draft, files, name, path, running, services, t]);

	const restart = () => {
		controller.current?.abort();
		transcript.current = [];
		setEntries([]);
	};

	return (
		<aside
			className={cn(
				"flex min-h-0 w-[min(360px,45%)] shrink-0 flex-col border-l bg-background",
				className,
			)}
			aria-label={t("hostedApp.assistant.title", { defaultValue: "Assistant" })}
		>
			<header className="flex items-center gap-2 border-b px-3 py-2">
				<Sparkles className="h-4 w-4 text-primary" aria-hidden />
				<span className="flex-1 truncate text-sm font-medium">
					{t("hostedApp.assistant.title", { defaultValue: "Assistant" })}
				</span>
				<Button
					variant="ghost"
					size="icon"
					className="h-7 w-7"
					onClick={restart}
					disabled={!entries.length}
					title={t("hostedApp.assistant.newChat", {
						defaultValue: "New conversation",
					})}
				>
					<RotateCcw className="h-3.5 w-3.5" />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					className="h-7 w-7"
					onClick={onClose}
					title={t("hostedApp.assistant.close", { defaultValue: "Close" })}
				>
					<X className="h-4 w-4" />
				</Button>
			</header>
			<Conversation className="min-h-0">
				<ConversationContent className="flex flex-col gap-3 p-3 text-sm">
					{entries.length === 0 ? (
						<p className="text-muted-foreground">
							{t("hostedApp.assistant.empty", {
								defaultValue:
									"Ask about {{name}}, or say what to change: I work with {{app}}'s tools and save to the file.",
								name,
								app: HOSTED_APPS[app].name,
							})}
						</p>
					) : null}
					{entries.map((entry) =>
						entry.kind === "user" ? (
							<div
								key={entry.id}
								className="self-end whitespace-pre-wrap rounded-lg bg-muted px-3 py-2"
							>
								{entry.text}
							</div>
						) : entry.kind === "assistant" ? (
							<Response key={entry.id}>{entry.text}</Response>
						) : (
							<p
								key={entry.id}
								role="status"
								className={cn(
									"text-xs",
									entry.failed ? "text-destructive" : "text-muted-foreground",
								)}
							>
								{entry.text}
							</p>
						),
					)}
					{running ? (
						<Loader2
							className="h-4 w-4 animate-spin text-muted-foreground"
							aria-label={t("hostedApp.assistant.working", {
								defaultValue: "Working…",
							})}
						/>
					) : null}
				</ConversationContent>
				<ConversationScrollButton />
			</Conversation>
			<form
				className="flex items-end gap-2 border-t p-2"
				onSubmit={(event) => {
					event.preventDefault();
					void send();
				}}
			>
				<Textarea
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						if (
							event.key === "Enter" &&
							!event.shiftKey &&
							!event.nativeEvent.isComposing
						) {
							event.preventDefault();
							void send();
						}
					}}
					rows={2}
					className="min-h-[2.5rem] resize-none text-sm"
					placeholder={t("hostedApp.assistant.placeholder", {
						defaultValue: "Ask or say what to change…",
					})}
				/>
				{running ? (
					<Button
						type="button"
						size="icon"
						variant="outline"
						onClick={() => controller.current?.abort()}
						title={t("hostedApp.assistant.stop", { defaultValue: "Stop" })}
					>
						<Square className="h-3.5 w-3.5" />
					</Button>
				) : (
					<Button
						type="submit"
						size="icon"
						disabled={!draft.trim()}
						title={t("hostedApp.assistant.send", { defaultValue: "Send" })}
					>
						<SendHorizontal className="h-4 w-4" />
					</Button>
				)}
			</form>
		</aside>
	);
};
