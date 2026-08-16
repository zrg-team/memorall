import React from "react";
import { useTranslation } from "react-i18next";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { marked } from "marked";
import TurndownService from "turndown";
import {
	useAgentConfigStore,
	getDefaultSystemPromptForGraph,
} from "@/main/stores/agent-config";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Singleton — never recreated across renders
// ---------------------------------------------------------------------------
const td = new TurndownService({ headingStyle: "atx", bulletListMarker: "-" });

// ---------------------------------------------------------------------------
// Typography for the rendered markdown nodes. Scoped to this editor on purpose:
// the app registers no typography plugin, so `prose` is a no-op and Preflight
// would otherwise flatten headings and strip list markers.
// ---------------------------------------------------------------------------
const MARKDOWN_NODE_STYLES = [
	"[&_.ProseMirror_h1]:mt-4 [&_.ProseMirror_h1]:mb-2 [&_.ProseMirror_h1]:text-lg [&_.ProseMirror_h1]:font-semibold",
	"[&_.ProseMirror_h2]:mt-4 [&_.ProseMirror_h2]:mb-2 [&_.ProseMirror_h2]:text-base [&_.ProseMirror_h2]:font-semibold",
	"[&_.ProseMirror_h3]:mt-3 [&_.ProseMirror_h3]:mb-1.5 [&_.ProseMirror_h3]:text-sm [&_.ProseMirror_h3]:font-semibold",
	"[&_.ProseMirror_h4]:mt-3 [&_.ProseMirror_h4]:mb-1.5 [&_.ProseMirror_h4]:text-sm [&_.ProseMirror_h4]:font-medium",
	"[&_.ProseMirror_:is(h1,h2,h3,h4):first-child]:mt-0",
	"[&_.ProseMirror_p]:my-2 [&_.ProseMirror_p]:leading-relaxed",
	"[&_.ProseMirror_ul]:my-2 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6",
	"[&_.ProseMirror_ol]:my-2 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6",
	"[&_.ProseMirror_li]:my-0.5 [&_.ProseMirror_li_p]:my-0",
	"[&_.ProseMirror_strong]:font-semibold [&_.ProseMirror_em]:italic",
	"[&_.ProseMirror_a]:underline [&_.ProseMirror_a]:underline-offset-2",
	"[&_.ProseMirror_code]:rounded [&_.ProseMirror_code]:bg-muted [&_.ProseMirror_code]:px-1 [&_.ProseMirror_code]:py-0.5 [&_.ProseMirror_code]:font-mono [&_.ProseMirror_code]:text-[0.85em]",
	"[&_.ProseMirror_pre]:my-2 [&_.ProseMirror_pre]:overflow-x-auto [&_.ProseMirror_pre]:rounded-md [&_.ProseMirror_pre]:bg-muted [&_.ProseMirror_pre]:p-3",
	"[&_.ProseMirror_pre_code]:bg-transparent [&_.ProseMirror_pre_code]:p-0",
	"[&_.ProseMirror_blockquote]:my-2 [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-border [&_.ProseMirror_blockquote]:pl-3 [&_.ProseMirror_blockquote]:text-muted-foreground",
	"[&_.ProseMirror_hr]:my-4 [&_.ProseMirror_hr]:border-t [&_.ProseMirror_hr]:border-border",
].join(" ");

// ---------------------------------------------------------------------------
// Inner WYSIWYG editor — pure presentational, no store awareness
// Typing "## " at line start immediately renders as H2, etc.
// ---------------------------------------------------------------------------
const PromptEditorContent = React.memo<{
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
}>(({ value, onChange, placeholder }) => {
	// Tracks last markdown we produced to skip no-op external syncs
	const currentMdRef = React.useRef(value);

	const editor = useEditor({
		extensions: [StarterKit, Placeholder.configure({ placeholder })],
		content: marked.parse(value || "") as string,
		onUpdate: ({ editor }) => {
			const md = td.turndown(editor.getHTML());
			currentMdRef.current = md;
			onChange(md);
		},
	});

	// Sync when value changes externally (preset switch, reset, revert…)
	React.useEffect(() => {
		if (!editor || currentMdRef.current === value) return;
		currentMdRef.current = value;
		editor.commands.setContent(marked.parse(value || "") as string, {
			emitUpdate: false,
		});
	}, [editor, value]);

	return (
		<EditorContent
			editor={editor}
			className={cn(
				"max-w-none",
				"[&_.ProseMirror]:min-h-[300px] [&_.ProseMirror]:outline-none [&_.ProseMirror]:cursor-text [&_.ProseMirror]:text-sm",
				MARKDOWN_NODE_STYLES,
				"[&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none",
				"[&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left",
				"[&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0",
				"[&_.ProseMirror_p.is-editor-empty:first-child::before]:text-muted-foreground",
				"[&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
			)}
		/>
	);
});
PromptEditorContent.displayName = "PromptEditorContent";

// ---------------------------------------------------------------------------
// Smart wrapper — reads store, owns local state, renders section label
// ---------------------------------------------------------------------------
export const SystemPromptEditor: React.FC = () => {
	const { t } = useTranslation("agents");
	const { draftConfig, currentGraphType, updateField } = useAgentConfigStore();

	const defaultPrompt = React.useMemo(
		() => getDefaultSystemPromptForGraph(currentGraphType),
		[currentGraphType],
	);

	const [value, setValue] = React.useState(
		draftConfig.systemPrompt || defaultPrompt,
	);

	// Keep in sync when the preset changes externally
	React.useEffect(() => {
		setValue(draftConfig.systemPrompt || defaultPrompt);
	}, [defaultPrompt, draftConfig.systemPrompt]);

	const handleChange = (next: string) => {
		setValue(next);
		updateField("systemPrompt", next === defaultPrompt ? "" : next);
	};

	return (
		<div className="space-y-3">
			<span className="text-sm text-muted-foreground">
				{t("instructions.label")}
			</span>
			<PromptEditorContent
				value={value}
				onChange={handleChange}
				placeholder={t("instructions.placeholder")}
			/>
		</div>
	);
};
