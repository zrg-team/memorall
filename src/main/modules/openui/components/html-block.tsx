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

const MIN_HEIGHT = 80;
const MAX_HEIGHT = 900;
const DEFAULT_HEIGHT = 320;

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
		const height = Math.min(
			MAX_HEIGHT,
			Math.max(MIN_HEIGHT, props.height ?? DEFAULT_HEIGHT),
		);

		return (
			<figure className="my-2 overflow-hidden rounded-md border border-border">
				{props.title ? (
					<figcaption className="border-b border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
						{props.title}
					</figcaption>
				) : null}
				<iframe
					srcDoc={props.html}
					sandbox="allow-scripts"
					referrerPolicy="no-referrer"
					loading="lazy"
					className="w-full bg-white"
					style={{ height, border: "none", display: "block" }}
					title={props.title ?? "Rendered HTML"}
				/>
			</figure>
		);
	},
});
