import React, { useCallback, useRef, useState } from "react";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";
import { Check, Copy, Eye, RotateCcw, SquareCode } from "lucide-react";
import { cn } from "@/lib/utils";
import {
	IsolatedHtmlFrame,
	clampHtmlHeight,
} from "@/main/modules/openui/components/html-block";
import {
	openUIStateKey,
	readOpenUIState,
	writeOpenUIState,
} from "@/main/modules/openui/openui-form-state";

/**
 * An editable code surface, for code the user is meant to change rather than
 * just read.
 *
 * `CodeBlockComp` stays the right choice for code being explained — it
 * highlights and is read-only. This is the other case: a snippet the user tweaks
 * before copying it out, or an HTML document they iterate on with the result
 * visible beside it.
 *
 * Editing is a plain textarea rather than a highlighted one on purpose. Shiki
 * highlighting is asynchronous and costs a full re-tokenise, which is fine once
 * for a static block and wrong on every keystroke; and two of the three themes
 * render code unhighlighted already, so nothing is lost in exchange for an
 * editor that never stutters. It also means no new dependency in a bundle that
 * is already over budget.
 *
 * Preview renders through `IsolatedHtmlFrame`, so edited HTML runs under exactly
 * the sandbox `HtmlBlock` uses — scripts yes, storage and host page no.
 */

const HTML_LANGUAGES = new Set(["html", "htm", "xhtml", "svg"]);
const TAB = "  ";

/**
 * Edits have to outlive the unmount, same as any form field.
 *
 * A message's OpenUI tree is dropped once it scrolls ~1.5 viewports away, so
 * plain `useState` would lose whatever the user had typed the moment they
 * scrolled up to re-read the conversation. Keyed on the original source, so the
 * same editor reclaims its own edits and a different one never does.
 */
const editorStateKey = (code: string, name?: string): string =>
	openUIStateKey(`codeeditor:${name ?? ""}`, code);

export const CodeEditorBlock = defineComponent({
	name: "CodeEditorBlock",
	description:
		"Editable code surface. Set preview for HTML the user can edit and run in an isolated frame.",
	props: z.object({
		code: z.string(),
		language: z.string().default("typescript"),
		filename: z.string().optional(),
		height: z.number().optional(),
		preview: z.boolean().optional(),
		name: z.string().optional(),
	}),
	component: ({ props }) => {
		const stateKey = editorStateKey(props.code, props.name);
		const [value, setValue] = useState(() => {
			const saved = readOpenUIState(stateKey);
			return typeof saved?.value === "string" ? saved.value : props.code;
		});
		const [copied, setCopied] = useState(false);
		const [showPreview, setShowPreview] = useState(false);
		const textareaRef = useRef<HTMLTextAreaElement>(null);

		const height = clampHtmlHeight(props.height);
		const label = props.filename ?? props.language;
		const isHtml = HTML_LANGUAGES.has(props.language.toLowerCase());
		const canPreview =
			props.preview === true || (props.preview !== false && isHtml);
		const isDirty = value !== props.code;

		const commit = useCallback(
			(next: string) => {
				setValue(next);
				writeOpenUIState(stateKey, { value: next });
			},
			[stateKey],
		);

		const copy = useCallback(() => {
			void navigator.clipboard?.writeText(value).then(
				() => {
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				},
				() => undefined,
			);
		}, [value]);

		// Tab belongs to the code here, not to focus traversal.
		const handleKeyDown = useCallback(
			(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
				if (event.key !== "Tab") return;
				event.preventDefault();
				const target = event.currentTarget;
				const { selectionStart, selectionEnd } = target;
				const next =
					value.slice(0, selectionStart) + TAB + value.slice(selectionEnd);
				commit(next);
				requestAnimationFrame(() => {
					const caret = selectionStart + TAB.length;
					target.setSelectionRange(caret, caret);
				});
			},
			[value, commit],
		);

		const action = (
			onClick: () => void,
			icon: React.ReactNode,
			text: string,
			disabled = false,
		) => (
			<button
				type="button"
				onClick={onClick}
				disabled={disabled}
				className={cn(
					"inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors",
					disabled
						? "cursor-not-allowed opacity-40"
						: "text-muted-foreground hover:bg-muted hover:text-foreground",
				)}
			>
				{icon}
				{text}
			</button>
		);

		return (
			<figure className="my-2 overflow-hidden rounded-md border border-border">
				<figcaption className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-2 py-1">
					<span className="truncate px-1 text-xs text-muted-foreground">
						{label}
						{isDirty ? " •" : ""}
					</span>
					<span className="flex shrink-0 items-center gap-0.5">
						{canPreview
							? action(
									() => setShowPreview((shown) => !shown),
									showPreview ? (
										<SquareCode className="h-3 w-3" />
									) : (
										<Eye className="h-3 w-3" />
									),
									showPreview ? "Code" : "Preview",
								)
							: null}
						{action(
							() => commit(props.code),
							<RotateCcw className="h-3 w-3" />,
							"Reset",
							!isDirty,
						)}
						{action(
							copy,
							copied ? (
								<Check className="h-3 w-3" />
							) : (
								<Copy className="h-3 w-3" />
							),
							copied ? "Copied" : "Copy",
						)}
					</span>
				</figcaption>

				{showPreview ? (
					<IsolatedHtmlFrame
						html={value}
						height={height}
						title={`${label} preview`}
					/>
				) : (
					<textarea
						ref={textareaRef}
						value={value}
						onChange={(event) => commit(event.target.value)}
						onKeyDown={handleKeyDown}
						spellCheck={false}
						autoCapitalize="off"
						autoCorrect="off"
						aria-label={`${label} editor`}
						className="block w-full resize-y bg-transparent p-3 font-mono text-sm leading-relaxed outline-none"
						style={{ height, tabSize: 2 }}
					/>
				)}
			</figure>
		);
	},
});
