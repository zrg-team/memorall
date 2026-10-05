import { Eye, PencilLine, Save } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Badge } from "@/main/components/ui/badge";
import { FileConflictBanner } from "@/main/modules/files/components/FileConflictBanner";
import type { MemonEditorState } from "@/services/memon/types";
import { textPreviewKind } from "../text-preview";
import type { MemonSend } from "../types";
import { TextPreview } from "./TextPreview";

export const EditorWindow: React.FC<{
	machineKey: string;
	editor: MemonEditorState;
	send: MemonSend;
}> = ({ machineKey, editor, send }) => {
	const { t } = useTranslation("common");
	const [draft, setDraft] = React.useState(editor.content);
	const [editing, setEditing] = React.useState(false);
	// The machine's content when the user started editing: what the draft is
	// based on.
	const [editBase, setEditBase] = React.useState<string | null>(null);
	// Markdown, HTML and CSV open rendered for the user; the agent reads text.
	const previewKind = textPreviewKind(editor.path);
	const [view, setView] = React.useState<"preview" | "edit">("preview");

	// Follow the machine (the agent typing) unless the user has unsaved edits.
	React.useEffect(() => {
		if (!editing) setDraft(editor.content);
	}, [editor.content, editing]);

	// Another file opens rendered again, and the draft of the last one must not
	// be saved into it.
	React.useEffect(() => {
		if (editor.path !== undefined) setView("preview");
		setEditing(false);
		setEditBase(null);
	}, [editor.path]);

	const stopEditing = () => {
		setEditing(false);
		setEditBase(null);
	};

	const save = (options: { overwrite?: boolean } = {}) =>
		send("editor.save", {
			key: machineKey,
			content: draft,
			...(options.overwrite
				? { overwrite: true }
				: editBase !== null
					? { base: editBase }
					: {}),
		})
			.then(stopEditing)
			// Refused: the file changed under the draft; the banner says so.
			.catch(() => undefined);

	// The file changed on disk under unsaved edits, or the agent changed the
	// content while the user was editing a draft of it.
	const conflict =
		editor.conflict !== undefined
			? { base: editBase ?? editor.content, disk: editor.conflict }
			: editing && editBase !== null && editor.content !== editBase
				? { base: editBase, disk: editor.content }
				: null;

	const reload = () => {
		if (editor.conflict !== undefined) {
			void send("editor.reload", { key: machineKey }).then(stopEditing);
		} else {
			stopEditing();
		}
	};
	const showPreview = previewKind !== null && view === "preview";
	const viewButton = (next: "preview" | "edit") => (
		<button
			type="button"
			aria-pressed={view === next}
			onClick={() => setView(next)}
			className={cn(
				"inline-flex h-6 items-center gap-1 px-2 text-[11px] font-medium transition-colors",
				view === next
					? "bg-accent text-foreground"
					: "text-muted-foreground hover:bg-accent/60",
			)}
		>
			{next === "preview" ? <Eye size={12} /> : <PencilLine size={12} />}
			{t(`memonComputer.preview.${next}`)}
		</button>
	);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
				<span className="min-w-0 flex-1 truncate font-mono text-[11px]">
					{editor.path ?? t("memonComputer.untitled")}
				</span>
				{previewKind ? (
					<div className="flex shrink-0 overflow-hidden rounded-md border border-input">
						{viewButton("preview")}
						{viewButton("edit")}
					</div>
				) : null}
				<Badge variant="outline" className="text-[10px] text-muted-foreground">
					{editor.saved && !editing
						? t("memonComputer.saved")
						: t("memonComputer.unsaved")}
				</Badge>
				<button
					type="button"
					data-memon-ref="e2"
					onClick={() => void save()}
					className="inline-flex h-6 items-center gap-1 rounded-md border border-input bg-background px-2 text-[11px] font-medium hover:bg-accent"
				>
					<Save size={12} />
					{t("memonComputer.save")}
				</button>
			</div>
			{conflict ? (
				<FileConflictBanner
					base={conflict.base}
					disk={conflict.disk}
					onReload={reload}
					onKeepMine={() => save({ overwrite: true })}
				/>
			) : null}
			{showPreview && previewKind ? (
				<div data-memon-ref="e1" className="flex min-h-0 flex-1 flex-col">
					<TextPreview
						kind={previewKind}
						text={draft}
						title={editor.path ?? t("memonComputer.untitled")}
						path={editor.path ?? undefined}
					/>
				</div>
			) : (
				<div className="flex min-h-0 flex-1 p-2">
					<textarea
						data-memon-ref="e1"
						value={draft}
						spellCheck={false}
						aria-label={editor.path ?? t("memonComputer.untitled")}
						onChange={(event) => {
							if (!editing) setEditBase(editor.content);
							setDraft(event.target.value);
							setEditing(true);
						}}
						onKeyDown={(event) => {
							if (
								(event.ctrlKey || event.metaKey) &&
								event.key.toLowerCase() === "s"
							) {
								event.preventDefault();
								void save();
							}
						}}
						className="min-w-0 flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed outline-none"
					/>
				</div>
			)}
		</div>
	);
};
