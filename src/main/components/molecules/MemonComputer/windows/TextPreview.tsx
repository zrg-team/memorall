import React from "react";
import { useTranslation } from "react-i18next";
import { MarkdownMessageBody } from "@/main/modules/chat/components/message/MarkdownMessageBody";
import { type MemonTextPreviewKind, parseDelimited } from "../text-preview";

/** Rows drawn at once; the agent still reads the whole file as text. */
const MAX_TABLE_ROWS = 500;

const TablePreview: React.FC<{ text: string; delimiter: string }> = ({
	text,
	delimiter,
}) => {
	const { t } = useTranslation("common");
	const rows = React.useMemo(
		() => parseDelimited(text, delimiter),
		[text, delimiter],
	);
	if (!rows.length) {
		return (
			<p className="p-3 text-xs text-muted-foreground">
				{t("memonComputer.preview.empty")}
			</p>
		);
	}
	const [header, ...body] = rows;
	const shown = body.slice(0, MAX_TABLE_ROWS);
	return (
		<div className="min-h-0 flex-1 overflow-auto">
			<table className="w-max min-w-full border-collapse text-xs">
				<thead className="sticky top-0 bg-muted">
					<tr>
						{header.map((cell, index) => (
							<th
								// biome-ignore lint/suspicious/noArrayIndexKey: columns have no ids
								key={index}
								className="border border-border/60 px-2 py-1 text-left font-semibold"
							>
								{cell}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{shown.map((row, rowIndex) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: rows have no ids
						<tr key={rowIndex} className="even:bg-muted/30">
							{header.map((_, index) => (
								<td
									// biome-ignore lint/suspicious/noArrayIndexKey: columns have no ids
									key={index}
									className="max-w-[24rem] truncate border border-border/60 px-2 py-1"
									title={row[index]}
								>
									{row[index] ?? ""}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
			{body.length > shown.length ? (
				<p className="px-2 py-1.5 text-[11px] text-muted-foreground">
					{t("memonComputer.preview.moreRows", {
						count: body.length - shown.length,
					})}
				</p>
			) : null}
		</div>
	);
};

/**
 * A text file drawn for the user: Markdown rendered like chat, HTML in a
 * sandbox with scripts off, CSV and TSV as a table. The agent reads the same
 * file as text.
 */
export const TextPreview: React.FC<{
	kind: MemonTextPreviewKind;
	text: string;
	title: string;
}> = ({ kind, text, title }) => {
	switch (kind) {
		case "markdown":
			return (
				<div className="min-h-0 flex-1 overflow-auto px-4 py-3">
					<MarkdownMessageBody className="text-sm" showCodeBlockSave={false}>
						{text}
					</MarkdownMessageBody>
				</div>
			);
		case "html":
			return (
				<div className="flex min-h-0 flex-1 p-2">
					<iframe
						srcDoc={text}
						sandbox=""
						title={title}
						className="h-full w-full rounded-lg border bg-white"
					/>
				</div>
			);
		case "csv":
			return <TablePreview text={text} delimiter="," />;
		case "tsv":
			return <TablePreview text={text} delimiter={"\t"} />;
	}
};
