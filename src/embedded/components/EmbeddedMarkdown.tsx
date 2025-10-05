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
		// Match table patterns - simpler, more permissive regex
		const tableRegex = /\|(.+)\|\s*\n\|[\s\-:]+\|\s*\n((?:\|.+\|\s*\n?)+)/gm;

		return text.replace(tableRegex, (match, headerRow, bodyRows) => {
			// Process header
			const headers = headerRow
				.split("|")
				.map((h: string) => h.trim())
				.filter((h: string) => h.length > 0);

			// Process body rows
			const rows = bodyRows
				.trim()
				.split("\n")
				.filter((row: string) => row.trim() && row.includes("|"))
				.map((row: string) => {
					return row
						.split("|")
						.map((cell: string) => cell.trim())
						.filter((cell: string) => cell.length > 0);
				})
				.filter((row: string[]) => row.length > 0);

			// Detect dark mode
			const isDark = document.documentElement.classList.contains("dark");

			// Border colors
			const borderColor = isDark ? "#d1d5db" : "#374151";
			const headerBg = isDark ? "#1f2937" : "#f3f4f6";

			// Ensure we have valid data
			if (headers.length === 0 || rows.length === 0) {
				return match; // Return original text if table parsing failed
			}

			let tableHtml = '<div style="overflow-x: auto; border-radius: 0.25rem;">';
			tableHtml +=
				'<table style="width: 100%; border-collapse: separate; border-spacing: 0;">';

			// Add header
			tableHtml += "<thead><tr>";
			headers.forEach((header: string, i: number) => {
				const isFirst = i === 0;
				const isLast = i === headers.length - 1;
				const styles = [
					`border: 1px solid ${borderColor}`,
					`background-color: ${headerBg}`,
					"padding: 0.125rem 0.375rem",
					"text-align: left",
					"font-weight: 600",
					"font-size: 0.75rem",
				];
				if (isFirst) styles.push("border-top-left-radius: 0.25rem");
				if (isLast) styles.push("border-top-right-radius: 0.25rem");
				if (!isFirst) styles.push("border-left: none");

				tableHtml += `<th style="${styles.join("; ")};">${header}</th>`;
			});
			tableHtml += "</tr></thead>";

			// Add body
			tableHtml += "<tbody>";
			rows.forEach((row: string[], rowIndex: number) => {
				tableHtml += "<tr>";
				const isLastRow = rowIndex === rows.length - 1;

				for (let i = 0; i < headers.length; i++) {
					const cell = row[i] || "";
					const isFirst = i === 0;
					const isLast = i === headers.length - 1;

					const styles = [
						`border-bottom: 1px solid ${borderColor}`,
						`border-right: 1px solid ${borderColor}`,
						"padding: 0.125rem 0.375rem",
						"font-size: 0.75rem",
					];
					if (isFirst) {
						styles.push(`border-left: 1px solid ${borderColor}`);
						if (isLastRow) styles.push("border-bottom-left-radius: 0.25rem");
					} else {
						styles.push("border-left: none");
					}
					if (isLast && isLastRow) {
						styles.push("border-bottom-right-radius: 0.25rem");
					}

					tableHtml += `<td style="${styles.join("; ")};">${cell}</td>`;
				}
				tableHtml += "</tr>";
			});
			tableHtml += "</tbody></table></div>";

			return tableHtml;
		});
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
				// Code blocks don't need extra styling - SyntaxHighlighter handles it
				return `<pre style="overflow-x: auto;"><code>${escapeHtml(part.content)}</code></pre>`;
			}

			let processedText = part.content;

			// Headers (### ## #) - matching MarkdownMessage
			processedText = processedText.replace(
				/^### (.*$)/gm,
				'<h3 style="font-size: 0.875rem; font-weight: 600;">$1</h3>',
			);
			processedText = processedText.replace(
				/^## (.*$)/gm,
				'<h2 style="font-size: 1rem; font-weight: 600;">$1</h2>',
			);
			processedText = processedText.replace(
				/^# (.*$)/gm,
				'<h1 style="font-size: 1.125rem; font-weight: 700;">$1</h1>',
			);

			// Lists - matching MarkdownMessage
			// Unordered lists
			processedText = processedText.replace(
				/^[\s]*[-*+] (.*)$/gm,
				'<li style="font-size: 0.875rem;">$1</li>',
			);
			// Wrap consecutive <li> elements in <ul>
			processedText = processedText.replace(
				/(<li[^>]*>.*?<\/li>(?:\s*<li[^>]*>.*?<\/li>)*)/gs,
				'<ul style="list-style-type: disc; padding-left: 1.5rem;">$1</ul>',
			);

			// Ordered lists
			processedText = processedText.replace(
				/^[\s]*\d+\. (.*)$/gm,
				'<li style="font-size: 0.875rem;">$1</li>',
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

			// Inline code (`code`) - matching MarkdownMessage
			const isDark = document.documentElement.classList.contains("dark");
			const codeBg = isDark ? "#374151" : "#e5e7eb";
			processedText = processedText.replace(
				/`([^`]+)`/g,
				`<code style="background-color: ${codeBg}; padding: 0 0.125rem; border-radius: 0.25rem; font-family: monospace; font-size: 0.75rem;">$1</code>`,
			);

			// Links [text](url)
			processedText = processedText.replace(
				/\[([^\]]+)\]\(([^)]+)\)/g,
				'<a href="$2" style="color: hsl(var(--primary)); text-decoration: underline;" target="_blank" rel="noopener noreferrer">$1</a>',
			);

			// Blockquotes (> text) - matching MarkdownMessage
			const isDarkBlockquote =
				document.documentElement.classList.contains("dark");
			const blockquoteBorder = isDarkBlockquote ? "#d1d5db" : "#374151";
			processedText = processedText.replace(
				/^> (.*)$/gm,
				`<blockquote style="border-left: 2px solid ${blockquoteBorder}; padding-left: 0.5rem; font-style: italic; opacity: 0.8; font-size: 0.875rem;">$1</blockquote>`,
			);

			// Horizontal rules (--- or ***) - matching MarkdownMessage
			const isDarkHr = document.documentElement.classList.contains("dark");
			const hrBorder = isDarkHr ? "#d1d5db" : "#374151";
			processedText = processedText.replace(
				/^(?:---|\*\*\*)\s*$/gm,
				`<hr style="border: none; border-top: 1px solid ${hrBorder};">`,
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
			// No vertical spacing - matching MarkdownMessage
			if (
				processedText.trim() &&
				!processedText.match(/^<(?:h[1-6]|ul|ol|blockquote|hr|pre|div)/)
			) {
				processedText = `<p style="margin: 0;">${processedText}</p>`;
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
