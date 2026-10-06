import React, {
	forwardRef,
	useEffect,
	useImperativeHandle,
	useRef,
} from "react";
import { cn } from "@/lib/utils";
import { pastedFiles } from "@/utils/clipboard-files";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MentionRichTextareaProps {
	value: string;
	onChange: (value: string, cursorOffset: number) => void;
	onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
	/** Files or a picture pasted in, to attach; left out, only text pastes. */
	onPasteFiles?: (files: File[]) => void;
	placeholder?: string;
	disabled?: boolean;
	className?: string;
	minHeight?: number;
	maxHeight?: number;
}

export interface MentionRichTextareaHandle {
	focus: () => void;
	/** Set where the cursor should land on the next external value update. */
	setPendingCursor: (offset: number) => void;
}

// ---------------------------------------------------------------------------
// Badge HTML (static — injected into DOM directly)
// ---------------------------------------------------------------------------

// Inline SVG icons — avoids react-dom/server dependency
const SKILL_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`;
const DOC_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`;

const BADGE_CLASS = {
	skill:
		"inline-flex items-center gap-0.5 rounded px-1 py-px text-xs font-medium align-middle bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
	doc: "inline-flex items-center gap-0.5 rounded px-1 py-px text-xs font-medium align-middle bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
} as const;

function buildBadgeHTML(
	kind: "skill" | "doc",
	name: string,
	rawText: string,
): string {
	const icon = kind === "skill" ? SKILL_ICON_SVG : DOC_ICON_SVG;
	return `<span contenteditable="false" data-mention="${rawText}" class="${BADGE_CLASS[kind]}">${icon}<span>${name}</span></span>`;
}

const MENTION_RE = /@(skill|doc):([\w.-]+)/g;

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

/** Build innerHTML for the given plain text, wrapping mentions as badges. */
function buildHTML(text: string): string {
	let html = "";
	let last = 0;
	const re = new RegExp(MENTION_RE.source, "g");

	for (const m of text.matchAll(re)) {
		const [full, kind, name] = m;
		const start = m.index!;
		if (start > last) html += escapeHTML(text.slice(last, start));
		html += buildBadgeHTML(kind as "skill" | "doc", name, full);
		last = start + full.length;
	}
	if (last < text.length) html += escapeHTML(text.slice(last));
	return html;
}

function escapeHTML(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\n/g, "<br>");
}

/** Walk the div's child nodes and extract plain text (badges → their data-mention value). */
function getPlainText(el: HTMLElement): string {
	let text = "";
	for (const node of el.childNodes) {
		if (node.nodeType === Node.TEXT_NODE) {
			text += node.textContent ?? "";
		} else if (node instanceof HTMLElement) {
			const mention = node.dataset.mention;
			text +=
				mention ?? (node.tagName === "BR" ? "\n" : (node.textContent ?? ""));
		}
	}
	return text;
}

/** Plain-text length of one child node (a badge counts as its raw mention). */
function nodeTextLength(node: Node): number {
	if (node instanceof HTMLElement) {
		return (
			node.dataset.mention?.length ??
			(node.tagName === "BR" ? 1 : (node.textContent?.length ?? 0))
		);
	}
	return node.textContent?.length ?? 0;
}

/** Turn a DOM position (container + offset) into a plain-text offset. */
function textOffsetAt(
	el: HTMLElement,
	container: Node,
	containerOffset: number,
): number {
	let offset = 0;
	const children = Array.from(el.childNodes);
	for (const [index, node] of children.entries()) {
		// A position on the div itself counts children, not characters.
		if (container === el && index === containerOffset) return offset;
		if (node === container) return offset + containerOffset;
		if (node.contains(container)) {
			// cursor is inside this node (shouldn't happen for mention spans since they're
			// contenteditable=false, but handle gracefully)
			return offset + nodeTextLength(node);
		}
		offset += nodeTextLength(node);
	}
	return offset;
}

/** Return the selection as plain-text offsets; collapsed when it is a cursor. */
function getSelectionOffsets(el: HTMLElement): { start: number; end: number } {
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0) return { start: 0, end: 0 };
	const range = sel.getRangeAt(0);
	const start = textOffsetAt(el, range.startContainer, range.startOffset);
	const end = range.collapsed
		? start
		: textOffsetAt(el, range.endContainer, range.endOffset);
	return { start, end };
}

/** Return the cursor position as a character offset into the plain text. */
function getCursorOffset(el: HTMLElement): number {
	return getSelectionOffsets(el).start;
}

/** Restore cursor to a given plain-text character offset. */
function setCursorOffset(el: HTMLElement, target: number): void {
	const sel = window.getSelection();
	if (!sel) return;

	let remaining = target;

	for (const node of el.childNodes) {
		let nodeLen: number;

		if (node.nodeType === Node.TEXT_NODE) {
			nodeLen = node.textContent?.length ?? 0;
			if (remaining <= nodeLen) {
				const range = document.createRange();
				range.setStart(node, remaining);
				range.collapse(true);
				sel.removeAllRanges();
				sel.addRange(range);
				return;
			}
		} else if (node instanceof HTMLElement) {
			nodeLen =
				node.dataset.mention?.length ??
				(node.tagName === "BR" ? 1 : (node.textContent?.length ?? 0));
			if (remaining < nodeLen) {
				// Place cursor before this node
				const range = document.createRange();
				range.setStartBefore(node);
				range.collapse(true);
				sel.removeAllRanges();
				sel.addRange(range);
				return;
			}
		} else {
			nodeLen = 0;
		}

		remaining -= nodeLen;
	}

	// End of content
	const range = document.createRange();
	range.selectNodeContents(el);
	range.collapse(false);
	sel.removeAllRanges();
	sel.addRange(range);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const MentionRichTextarea = forwardRef<
	MentionRichTextareaHandle,
	MentionRichTextareaProps
>(
	(
		{
			value,
			onChange,
			onKeyDown,
			onPasteFiles,
			placeholder = "What would you like to know?",
			disabled = false,
			className,
			minHeight = 72,
			maxHeight = 164,
		},
		ref,
	) => {
		const divRef = useRef<HTMLDivElement>(null);
		const lastValueRef = useRef<string>(value);
		// When set, used as the cursor position on the next external value sync
		const pendingCursorRef = useRef<number | null>(null);
		// True while an IME (Vietnamese Telex, pinyin, kana, …) is composing.
		// Rewriting the DOM then cancels the composition mid-word.
		const composingRef = useRef(false);

		useImperativeHandle(ref, () => ({
			focus: () => divRef.current?.focus(),
			setPendingCursor: (offset: number) => {
				pendingCursorRef.current = offset;
			},
		}));

		// Sync external value → DOM (only when changed from outside)
		useEffect(() => {
			const el = divRef.current;
			if (!el) return;
			if (lastValueRef.current === value) return;

			const cursor = pendingCursorRef.current ?? getCursorOffset(el);
			pendingCursorRef.current = null;
			lastValueRef.current = value;
			el.innerHTML = buildHTML(value);
			// Focus so cursor placement is visible
			el.focus();
			setCursorOffset(el, cursor);
		}, [value]);

		// Initial render
		useEffect(() => {
			const el = divRef.current;
			if (!el) return;
			el.innerHTML = buildHTML(value);
			lastValueRef.current = value;
			// eslint-disable-next-line react-hooks/exhaustive-deps
		}, []);

		const commitText = (el: HTMLDivElement, text: string, cursor: number) => {
			// Re-render with badges so new mentions are styled immediately
			el.innerHTML = buildHTML(text);
			lastValueRef.current = text;
			setCursorOffset(el, cursor);

			onChange(text, cursor);
		};

		const handleInput = () => {
			const el = divRef.current;
			if (!el || composingRef.current) return;

			const text = getPlainText(el);
			if (text === lastValueRef.current) return;

			commitText(el, text, getCursorOffset(el));
		};

		const handleCompositionEnd = () => {
			composingRef.current = false;
			// Some browsers fire the last input before compositionend, so pick
			// up the committed text here.
			handleInput();
		};

		// Paste as plain text: rich HTML would add markup that getPlainText
		// flattens, losing line breaks. Files and pictures (an image's data URL
		// or base64 too) go to the parent as attachments.
		const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
			const el = divRef.current;
			if (!el) return;
			// Never the browser's paste: a picture would land as an <img> that
			// getPlainText drops.
			e.preventDefault();
			const files = onPasteFiles ? pastedFiles(e.clipboardData) : [];
			if (files.length > 0) {
				onPasteFiles?.(files);
				return;
			}
			const pasted = e.clipboardData.getData("text/plain");
			if (!pasted) return;

			const inserted = pasted.replace(/\r\n?/g, "\n");
			const current = getPlainText(el);
			const { start, end } = getSelectionOffsets(el);
			commitText(
				el,
				current.slice(0, start) + inserted + current.slice(end),
				start + inserted.length,
			);
		};

		const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
			// Keys during composition belong to the IME: Enter picks a candidate
			// instead of sending. Safari reports that Enter after compositionend
			// with keyCode 229.
			if (
				composingRef.current ||
				e.nativeEvent.isComposing ||
				e.keyCode === 229
			) {
				return;
			}

			// Let parent handle first (e.g. mention popup navigation/selection)
			onKeyDown?.(e);
			if (e.defaultPrevented) return;

			// Enter (without Shift) submits; Shift+Enter inserts newline via browser default
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				const form = divRef.current?.closest("form");
				if (form) form.requestSubmit();
			}
		};

		return (
			// eslint-disable-next-line jsx-a11y/no-static-element-interactions
			<div
				ref={divRef}
				contentEditable={!disabled}
				suppressContentEditableWarning
				role="textbox"
				aria-multiline="true"
				aria-placeholder={placeholder}
				data-placeholder={placeholder}
				onInput={handleInput}
				onCompositionStart={() => {
					composingRef.current = true;
				}}
				onCompositionEnd={handleCompositionEnd}
				onPaste={handlePaste}
				onKeyDown={handleKeyDown}
				className={cn(
					"w-full resize-none rounded-none border-none p-3 shadow-none outline-none ring-0",
					"overflow-y-auto whitespace-pre-wrap break-words text-sm leading-normal",
					"focus-visible:ring-0 bg-transparent",
					// Placeholder via CSS :empty
					"empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground empty:before:pointer-events-none",
					disabled && "cursor-not-allowed opacity-50",
					className,
				)}
				style={{ minHeight, maxHeight }}
			/>
		);
	},
);

MentionRichTextarea.displayName = "MentionRichTextarea";
