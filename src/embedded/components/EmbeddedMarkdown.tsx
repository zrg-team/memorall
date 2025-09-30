import React from "react";

export interface EmbeddedMarkdownProps {
	content: string;
	isStreaming?: boolean;
}

// Enhanced Embedded Markdown Component with comprehensive markdown support
export const EmbeddedMarkdown: React.FC<EmbeddedMarkdownProps> = ({
	content,
	isStreaming = false,
}) => {
	// Helper function to process tables
	const processProcessTables = (text: string) => {
		// Match table patterns with more robust regex
		// This pattern looks for: header row, separator row, then body rows
		const tableRegex =
			/(\|.*?\|)\s*\n(\|[\s\-:]+?\|)\s*\n((?:\|.*?\|\s*\n?)+)/gm;

		return text.replace(
			tableRegex,
			(match, headerRow, separatorRow, bodyRows) => {
				// Process header
				const headers = headerRow
					.split("|")
					.map((h: string) => h.trim())
					.filter((h: string) => h !== ""); // Remove empty cells

				// Process alignment from separator row
				const alignments = separatorRow
					.split("|")
					.map((sep: string) => sep.trim())
					.filter((sep: string) => sep !== "")
					.map((sep: string) => {
						if (sep.startsWith(":") && sep.endsWith(":")) return "center";
						if (sep.endsWith(":")) return "right";
						return "left";
					});

				// Process body rows
				const rows = bodyRows
					.trim()
					.split("\n")
					.filter((row: string) => row.trim())
					.map((row: string) => {
						return row
							.split("|")
							.map((cell: string) => cell.trim())
							.filter((cell: string) => cell !== ""); // Remove empty cells
					})
					.filter((row: string[]) => row.length > 0);

				// Generate table HTML
				const tableStyle = `
				width: 100%;
				border-collapse: collapse;
				font-size: 0.875rem;
				border: 1px solid hsl(var(--border));
				border-radius: 0.375rem;
				overflow: hidden;
			`;

				const headerStyle = `
				background-color: hsl(var(--muted));
				padding: 0.5rem 0.75rem;
				text-align: left;
				font-weight: 600;
				border-bottom: 1px solid hsl(var(--border));
				color: hsl(var(--foreground));
			`;

				const cellStyle = `
				padding: 0.5rem 0.75rem;
				border-bottom: 1px solid hsl(var(--border));
				color: hsl(var(--foreground));
			`;

				let tableHtml = `<div style="overflow-x: auto;"><table style="${tableStyle}">`;

				// Ensure we have valid data
				if (headers.length === 0 || rows.length === 0) {
					return match; // Return original text if table parsing failed
				}

				// Add header
				tableHtml += "<thead><tr>";
				headers.forEach((header: string, i: number) => {
					const align = alignments[i] || "left";
					tableHtml += `<th style="${headerStyle} text-align: ${align};">${header}</th>`;
				});
				tableHtml += "</tr></thead>";

				// Add body
				tableHtml += "<tbody>";
				rows.forEach((row: string[], rowIndex: number) => {
					tableHtml += "<tr>";
					// Ensure each row has the same number of cells as headers
					const maxCells = Math.max(headers.length, row.length);
					for (let i = 0; i < maxCells; i++) {
						const cell = row[i] || ""; // Use empty string if cell is missing
						const align = alignments[i] || "left";
						const isLastRow = rowIndex === rows.length - 1;
						const cellStyleWithBorder = isLastRow
							? cellStyle.replace(
									"border-bottom: 1px solid hsl(var(--border));",
									"",
								)
							: cellStyle;
						tableHtml += `<td style="${cellStyleWithBorder} text-align: ${align};">${cell}</td>`;
					}
					tableHtml += "</tr>";
				});
				tableHtml += "</tbody></table></div>";

				return tableHtml;
			},
		);
	};

	// Enhanced markdown rendering for embedded context
	const renderContent = (text: string) => {
		if (!text) return text;

		// Split by code blocks first to avoid processing them
		const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
		const parts: Array<{
			type: "text" | "code";
			content: string;
			language?: string;
		}> = [];
		let lastIndex = 0;
		let match;

		while ((match = codeBlockRegex.exec(text)) !== null) {
			// Add text before code block
			if (match.index > lastIndex) {
				parts.push({
					type: "text",
					content: text.slice(lastIndex, match.index),
				});
			}
			// Add code block
			parts.push({
				type: "code",
				content: match[2] || "",
				language: match[1] || "text",
			});
			lastIndex = match.index + match[0].length;
		}

		// Add remaining text
		if (lastIndex < text.length) {
			parts.push({ type: "text", content: text.slice(lastIndex) });
		}

		// If no code blocks found, treat entire text as text
		if (parts.length === 0) {
			parts.push({ type: "text", content: text });
		}

		// Process each part
		const processedParts = parts.map((part) => {
			if (part.type === "code") {
				const codeStyle = `
					background-color: hsl(var(--muted));
					border: 1px solid hsl(var(--border));
					border-radius: 0.375rem;
					padding: 0.75rem;
					font-family: "SF Mono", "Monaco", "Inconsolata", "Fira Code", "Fira Mono", "Droid Sans Mono", "Consolas", monospace;
					font-size: 0.875rem;
					line-height: 1.5;
					overflow-x: auto;
					white-space: pre;
					display: block;
				`;
				return `<pre style="${codeStyle}"><code>${escapeHtml(part.content)}</code></pre>`;
			}

			let processedText = part.content;

			// Headers (### ## #)
			processedText = processedText.replace(
				/^### (.*$)/gm,
				'<h3 style="font-size: 1rem; font-weight: 600; color: hsl(var(--foreground));">$1</h3>',
			);
			processedText = processedText.replace(
				/^## (.*$)/gm,
				'<h2 style="font-size: 1.125rem; font-weight: 600; color: hsl(var(--foreground));">$1</h2>',
			);
			processedText = processedText.replace(
				/^# (.*$)/gm,
				'<h1 style="font-size: 1.25rem; font-weight: 700; color: hsl(var(--foreground));">$1</h1>',
			);

			// Lists (handle before other processing)
			// Unordered lists
			processedText = processedText.replace(
				/^[\s]*[-*+] (.*)$/gm,
				'<li style="padding-left: 0.5rem;">$1</li>',
			);
			// Wrap consecutive <li> elements in <ul>
			processedText = processedText.replace(
				/(<li[^>]*>.*?<\/li>(?:\s*<li[^>]*>.*?<\/li>)*)/gs,
				'<ul style="list-style-type: disc; padding-left: 1.5rem;">$1</ul>',
			);

			// Ordered lists
			processedText = processedText.replace(
				/^[\s]*\d+\. (.*)$/gm,
				'<li style="padding-left: 0.5rem;">$1</li>',
			);
			// Note: This is a simplified approach for ordered lists

			// Bold (**text** or __text__)
			processedText = processedText.replace(
				/\*\*(.*?)\*\*/g,
				'<strong style="font-weight: 600;">$1</strong>',
			);
			processedText = processedText.replace(
				/__(.*?)__/g,
				'<strong style="font-weight: 600;">$1</strong>',
			);

			// Italic (*text* or _text_) - be careful not to match inside words
			processedText = processedText.replace(
				/(?<!\w)\*([^*\n]+?)\*(?!\w)/g,
				'<em style="font-style: italic;">$1</em>',
			);
			processedText = processedText.replace(
				/(?<!\w)_([^_\n]+?)_(?!\w)/g,
				'<em style="font-style: italic;">$1</em>',
			);

			// Inline code (`code`)
			processedText = processedText.replace(
				/`([^`]+)`/g,
				'<code style="background-color: hsl(var(--muted)); padding: 0.125rem 0.25rem; border-radius: 0.25rem; font-family: monospace; font-size: 0.875em;">$1</code>',
			);

			// Links [text](url)
			processedText = processedText.replace(
				/\[([^\]]+)\]\(([^)]+)\)/g,
				'<a href="$2" style="color: hsl(var(--primary)); text-decoration: underline;" target="_blank" rel="noopener noreferrer">$1</a>',
			);

			// Blockquotes (> text)
			processedText = processedText.replace(
				/^> (.*)$/gm,
				'<blockquote style="border-left: 4px solid hsl(var(--primary)); padding-left: 1rem; font-style: italic; color: hsl(var(--muted-foreground));">$1</blockquote>',
			);

			// Horizontal rules (--- or ***)
			processedText = processedText.replace(
				/^(?:---|\*\*\*)\s*$/gm,
				'<hr style="border: none; border-top: 1px solid hsl(var(--border));">',
			);

			// Strikethrough (~~text~~)
			processedText = processedText.replace(
				/~~(.*?)~~/g,
				'<del style="text-decoration: line-through; opacity: 0.7;">$1</del>',
			);

			// Tables (GitHub Flavored Markdown style)
			processedText = processProcessTables(processedText);

			// Line breaks (double newlines become paragraph breaks, single newlines become <br>)
			processedText = processedText.replace(/\n\n/g, "</p><p>");
			processedText = processedText.replace(/\n/g, "<br>");

			// Wrap in paragraph if not empty and doesn't start with a block element
			if (
				processedText.trim() &&
				!processedText.match(/^<(?:h[1-6]|ul|ol|blockquote|hr|pre|div)/)
			) {
				processedText = `<p>${processedText}</p>`;
			}

			return processedText;
		});

		return processedParts.join("");
	};

	// Helper function to escape HTML in code blocks
	const escapeHtml = (text: string) => {
		const div = document.createElement("div");
		div.textContent = text;
		return div.innerHTML;
	};

	return (
		<div
			style={{
				fontSize: "14px",
				lineHeight: "1.5",
				color: "hsl(var(--foreground))",
			}}
			dangerouslySetInnerHTML={{
				__html: renderContent(content),
			}}
		/>
	);
};
