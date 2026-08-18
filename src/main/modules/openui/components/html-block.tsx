import React from "react";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";

/**
 * Model-authored HTML, rendered in a frame that cannot reach the extension.
 *
 * The sandbox is `allow-scripts` and nothing else, which is deliberate. Adding
 * `allow-same-origin` alongside it would give the frame this page's origin, and
 * a same-origin frame can reach `parent` and strip its own sandbox attribute —
 * so scripts written by a model would inherit extension privileges and the
 * user's IndexedDB. With `allow-scripts` alone the frame gets an opaque origin:
 * scripts, timers, canvas and DOM all work, while storage, cookies, the parent
 * document and the extension APIs are unreachable.
 *
 * `referrerPolicy` and the missing `allow-popups`/`allow-forms`/`allow-top-
 * navigation` are part of the same posture: rendered output should not be able
 * to navigate the user somewhere or exfiltrate what it was given.
 */

export const MIN_HTML_HEIGHT = 80;
export const MAX_HTML_HEIGHT = 900;
export const DEFAULT_HTML_HEIGHT = 320;

export const clampHtmlHeight = (height: number | undefined): number =>
	Math.min(
		MAX_HTML_HEIGHT,
		Math.max(MIN_HTML_HEIGHT, height ?? DEFAULT_HTML_HEIGHT),
	);

/**
 * The frame itself, shared so there is exactly one place the sandbox is decided.
 * CodeEditorBlock previews through this too — a second iframe with its own
 * hand-written sandbox string is how the two would quietly diverge.
 */
export const IsolatedHtmlFrame: React.FC<{
	html: string;
	height: number;
	title: string;
}> = ({ html, height, title }) => (
	<iframe
		srcDoc={html}
		sandbox="allow-scripts"
		referrerPolicy="no-referrer"
		loading="lazy"
		className="w-full bg-white"
		style={{ height, border: "none", display: "block" }}
		title={title}
	/>
);

export const HtmlBlock = defineComponent({
	name: "HtmlBlock",
	description:
		"Renders raw HTML in an isolated frame. Scripts run; storage, cookies and the host page are unreachable.",
	props: z.object({
		html: z.string(),
		height: z.number().optional(),
		title: z.string().optional(),
	}),
	component: ({ props }) => {
		// A model asked for 10000 would push every following section off-screen.
		const height = clampHtmlHeight(props.height);

		return (
			<figure className="my-2 overflow-hidden rounded-md border border-border">
				{props.title ? (
					<figcaption className="border-b border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
						{props.title}
					</figcaption>
				) : null}
				<IsolatedHtmlFrame
					html={props.html}
					height={height}
					title={props.title ?? "Rendered HTML"}
				/>
			</figure>
		);
	},
});
