import { customStyles } from "@/embedded/styles/customStyles";
import { coAgentAnchorStyles } from "./anchorStyles";

// Tokens come from the linked app stylesheet via the .light/.dark class on the
// mount container, so the dock follows the user's theme like every other surface.
export const coAgentStyles = `${customStyles}
	.memorall-co-agent-root {
		all: initial;
		position: fixed;
		right: 18px;
		bottom: 18px;
		z-index: 2147483647;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 8px;
		font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
		pointer-events: none;
	}
	.memorall-co-agent-dock {
		display: flex;
		align-items: center;
		gap: 8px;
		pointer-events: auto;
	}
	.memorall-co-agent-actions {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: flex-end;
		gap: 6px;
		pointer-events: auto;
	}
	.memorall-co-agent-action {
		position: relative;
		width: 34px;
		height: 34px;
		border: 1px solid rgb(226 232 240 / 0.92);
		border-radius: 999px;
		background: rgb(255 255 255 / 0.92);
		color: #0f172a;
		box-shadow: 0 10px 24px rgb(15 23 42 / 0.14);
		backdrop-filter: blur(10px);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		pointer-events: auto;
		padding: 0;
	}
	.memorall-co-agent-action:hover {
		background: #f8fafc;
		transform: translateY(-1px);
	}
	.memorall-co-agent-action--danger {
		color: #b91c1c;
	}
	.memorall-co-agent-action--danger:hover {
		background: #fef2f2;
		border-color: rgb(248 113 113 / 0.55);
	}
	.memorall-co-agent-action-tooltip {
		position: absolute;
		right: calc(100% + 8px);
		top: 50%;
		transform: translateY(-50%) scale(0.96);
		border: 1px solid rgb(226 232 240 / 0.92);
		border-radius: 7px;
		background: rgb(15 23 42 / 0.92);
		color: #fff;
		box-shadow: 0 10px 24px rgb(15 23 42 / 0.18);
		font: 650 11px/1 Inter, ui-sans-serif, system-ui, sans-serif;
		padding: 7px 8px;
		white-space: nowrap;
		opacity: 0;
		pointer-events: none;
		transition: opacity 120ms ease, transform 120ms ease;
	}
	.memorall-co-agent-action:hover .memorall-co-agent-action-tooltip,
	.memorall-co-agent-action:focus-visible .memorall-co-agent-action-tooltip {
		opacity: 1;
		transform: translateY(-50%) scale(1);
	}
	.memorall-co-agent-dock-prompt {
		width: min(360px, calc(100vw - 36px));
		display: grid;
		grid-template-columns: minmax(0, 1fr) 42px;
		align-items: stretch;
		gap: 8px;
		border: 1px solid rgb(226 232 240 / 0.92);
		border-radius: 14px;
		background: rgb(255 255 255 / 0.96);
		box-shadow: 0 18px 44px rgb(15 23 42 / 0.18);
		backdrop-filter: blur(12px);
		padding: 8px;
		pointer-events: auto;
	}
	.memorall-co-agent-dock-prompt textarea {
		min-width: 0;
		min-height: 38px;
		max-height: 120px;
		border: 0;
		outline: none;
		resize: none;
		background: transparent;
		color: #0f172a;
		font: 650 13px/1.4 Inter, ui-sans-serif, system-ui, sans-serif;
		padding: 9px 6px 7px 8px;
	}
	.memorall-co-agent-dock-prompt textarea::placeholder {
		color: #64748b;
	}
	.memorall-co-agent-dock-prompt button {
		width: 38px;
		height: 38px;
		align-self: center;
		border: 0;
		border-radius: 10px;
		background: #0f172a;
		color: #fff;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}
	.memorall-co-agent-dock-prompt button:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}
	.memorall-co-agent-conversation-button {
		width: 34px;
		height: 34px;
		border: 1px solid rgb(226 232 240 / 0.92);
		border-radius: 999px;
		background: rgb(255 255 255 / 0.9);
		color: #0f172a;
		box-shadow: 0 10px 24px rgb(15 23 42 / 0.16);
		backdrop-filter: blur(10px);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		pointer-events: auto;
	}
	.memorall-co-agent-conversation-button:hover {
		background: #f8fafc;
		transform: translateY(-1px);
	}
	.memorall-co-agent-icon {
		width: 54px;
		height: 54px;
		border: 0;
		padding: 0;
		background: transparent;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: default;
		overflow: visible;
		position: relative;
	}
	.memorall-co-agent-root--collapsed .memorall-co-agent-icon {
		cursor: pointer;
	}
	.memorall-co-agent-root--collapsed .memorall-co-agent-icon:focus-visible,
	.memorall-co-agent-action:focus-visible,
	.memorall-co-agent-conversation-button:focus-visible,
	.memorall-co-agent-bubble-close:focus-visible,
	.memorall-co-agent-anchor-trigger:focus-visible,
	.memorall-co-agent-dock-prompt button:focus-visible,
	.memorall-co-agent-anchor-prompt button:focus-visible {
		outline: 2px solid #2563eb;
		outline-offset: 2px;
	}
	.memorall-co-agent-icon [role="status"] {
		position: absolute;
		z-index: 2147483647;
		left: auto;
		right: -4px;
		bottom: calc(100% + 14px);
		width: max-content;
		max-width: min(460px, calc(100vw - 36px));
		/*
		 * The bubble ships with the centred "top" placement (left-1/2 plus a half-width
		 * shift); the dock re-anchors it to the icon's right edge instead. Both
		 * neutralisers are required: Tailwind v3 shifted via 'transform', v4 shifts via
		 * the separate 'translate' property, so clearing only 'transform' leaves the
		 * bubble half its own width to the left wherever the v4 variable resolves.
		 */
		transform: none;
		translate: none;
		pointer-events: auto;
		white-space: normal;
	}
	.memorall-co-agent-icon [role="status"] > div {
		position: relative;
		display: block;
		overflow: visible;
		border: 1px solid rgb(226 232 240 / 0.92);
		border-radius: 18px;
		background: #fff;
		color: #0f172a;
		box-shadow: 0 18px 44px rgb(15 23 42 / 0.24), 0 2px 0 rgb(15 23 42 / 0.12);
		font: 600 13px/1.5 Inter, ui-sans-serif, system-ui, sans-serif;
		padding: 11px 12px 11px 15px;
		text-align: left;
		overflow-wrap: break-word;
		white-space: normal;
	}
	.memorall-co-agent-icon .agent-speech-bubble-tail {
		display: none;
	}
	.memorall-co-agent-icon .agent-speech-bubble-content {
		display: block;
		max-height: min(320px, calc(100vh - 176px));
		max-width: none;
		overflow: auto;
		white-space: normal;
		scrollbar-width: thin;
		scrollbar-color: rgb(148 163 184 / 0.8) transparent;
	}
	.memorall-co-agent-bubble-content {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 22px;
		align-items: start;
		column-gap: 7px;
		min-width: min(160px, calc(100vw - 96px));
		max-width: min(380px, calc(100vw - 72px));
	}
	.memorall-co-agent-bubble-content .memorall-markdown {
		grid-column: 1;
		grid-row: 1;
		min-width: 0;
	}
	.memorall-co-agent-bubble-close {
		position: relative;
		grid-column: 2;
		grid-row: 1;
		z-index: 2;
		border-radius: 999px;
		width: 22px;
		height: 22px;
		border: 0;
		background: transparent;
		color: #64748b;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		pointer-events: auto;
		margin-top: -1px;
	}
	.memorall-co-agent-bubble-close:hover {
		background: rgb(15 23 42 / 0.14);
		color: #0f172a;
	}
	.memorall-co-agent-icon .memorall-markdown {
		color: inherit;
		font: inherit;
		line-height: inherit;
	}
	.memorall-co-agent-icon .memorall-markdown > *:first-child {
		margin-top: 0;
	}
	.memorall-co-agent-icon .memorall-markdown > *:last-child {
		margin-bottom: 0;
	}
	.memorall-co-agent-icon .memorall-markdown p {
		margin: 0 0 0.65em;
	}
	.memorall-co-agent-icon .memorall-markdown ul,
	.memorall-co-agent-icon .memorall-markdown ol {
		margin: 0.35em 0 0.7em;
		padding-left: 1.25em;
	}
	.memorall-co-agent-icon .memorall-markdown li {
		margin: 0.2em 0;
	}
	.memorall-co-agent-icon .memorall-markdown a {
		color: #2563eb;
		text-decoration: underline;
		text-underline-offset: 2px;
		pointer-events: auto;
	}
	.memorall-co-agent-icon .memorall-markdown-inline-code {
		border-radius: 5px;
		background: rgb(15 23 42 / 0.08);
		color: #0f172a;
		font: 600 0.92em/1.35 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		padding: 0.08em 0.3em;
	}
	.memorall-co-agent-icon .memorall-markdown-codeblock {
		max-width: 100%;
		overflow-x: auto;
		border-radius: 10px;
		background: #0f172a;
		color: #f8fafc;
		font: 500 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		margin: 0.55em 0;
		padding: 10px;
		white-space: pre;
	}
	.memorall-co-agent-icon .memorall-markdown-table-wrap {
		max-width: 100%;
		overflow-x: auto;
		margin: 0.55em 0;
	}
	.memorall-co-agent-icon .memorall-markdown table {
		border-collapse: collapse;
		font-size: 12px;
	}
	.memorall-co-agent-icon .memorall-markdown th,
	.memorall-co-agent-icon .memorall-markdown td {
		border: 1px solid rgb(203 213 225);
		padding: 4px 6px;
		text-align: left;
	}
	.memorall-co-agent-icon [role="status"] > div::before {
		content: "";
		position: absolute;
		left: auto;
		right: 18px;
		top: 100%;
		width: 0;
		height: 0;
		border-left: 10px solid transparent;
		border-right: 10px solid transparent;
		border-top: 12px solid #fff;
		filter: drop-shadow(2px 2px 0 rgb(15 23 42 / 0.16));
	}
	.memorall-co-agent-auth {
		border: 1px solid hsl(var(--border));
		background: hsl(var(--background) / 0.86);
		color: hsl(var(--foreground));
		box-shadow: 0 8px 22px rgb(15 23 42 / 0.14);
		backdrop-filter: blur(10px);
		cursor: pointer;
		pointer-events: auto;
	}
	.memorall-co-agent-auth {
		border-radius: 8px;
		font: 600 12px/1 Inter, ui-sans-serif, system-ui, sans-serif;
		padding: 8px 10px;
	}
	.memorall-co-agent-auth:hover {
		background: hsl(var(--accent));
	}
	.agent-cursor-pointer-layer,
	.agent-cursor-badge-layer {
		position: fixed;
		left: 0;
		top: 0;
		z-index: 2147483647;
		pointer-events: none;
	}
	.agent-cursor-pointer-offset {
		transform: translate(-10px, -10px);
	}
	.agent-cursor-badge-offset {
		transform: translate(16px, 20px);
	}
	.agent-cursor-pointer {
		width: 25px;
		height: 27px;
		color: hsl(var(--primary));
		filter: drop-shadow(0 8px 18px rgb(0 0 0 / 0.18));
	}
	.agent-cursor-mark {
		position: relative;
		display: inline-flex;
		width: 32px;
		height: 34px;
		color: hsl(var(--primary));
	}
	.agent-cursor-mark .agent-cursor-pointer {
		position: absolute;
		left: 0;
		top: 0;
	}
	.agent-cursor-mark-icon {
		position: absolute;
		right: -3px;
		bottom: -2px;
		width: 22px;
		height: 22px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		overflow: visible;
	}
	.agent-cursor-badge {
		display: inline-flex;
		align-items: flex-end;
		gap: 8px;
		max-width: min(260px, calc(100vw - 42px));
		pointer-events: none;
	}
	.agent-cursor-bubble {
		position: relative;
		max-width: 190px;
		border: 1px solid rgb(226 232 240 / 0.9);
		border-radius: 12px;
		background: rgb(255 255 255 / 0.94);
		color: #0f172a;
		box-shadow: 0 10px 26px rgb(15 23 42 / 0.18);
		backdrop-filter: blur(10px);
		font: 650 11px/1.25 Inter, ui-sans-serif, system-ui, sans-serif;
		padding: 6px 9px;
		overflow: hidden;
	}
	.agent-cursor-bubble-text {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		overflow-wrap: break-word;
		white-space: normal;
	}
	.agent-cursor-static {
		color: hsl(var(--primary));
		transform: translate(-10px, -10px);
	}
	.agent-cursor-static-badge {
		margin-top: 4px;
	}
${coAgentAnchorStyles}

	/* Working state inside the dock bubble: present from submit, not just once text streams. */
	.memorall-co-agent-working {
		display: flex;
		align-items: center;
		gap: 7px;
		margin-bottom: 6px;
		color: #475569;
		font: 650 11px/1.5 Inter, ui-sans-serif, system-ui, sans-serif;
	}
	.memorall-co-agent-working-dots {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		flex-shrink: 0;
	}
	.memorall-co-agent-working-dot {
		width: 5px;
		height: 5px;
		border-radius: 999px;
		background: #2563eb;
		animation: memorall-co-agent-working 1200ms ease-in-out infinite;
	}
	.memorall-co-agent-working-dot:nth-child(2) {
		animation-delay: 160ms;
	}
	.memorall-co-agent-working-dot:nth-child(3) {
		animation-delay: 320ms;
	}
	.memorall-co-agent-working-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	@keyframes memorall-co-agent-working {
		0%,
		100% {
			opacity: 0.25;
			transform: translateY(0);
		}
		50% {
			opacity: 1;
			transform: translateY(-2px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.memorall-co-agent-working-dot {
			animation: none;
			opacity: 0.75;
		}
	}

	.memorall-co-agent-agent-select {
		grid-column: 1;
		justify-self: start;
		max-width: 100%;
		margin-top: 2px;
		border: 1px solid rgb(226 232 240 / 0.95);
		border-radius: 8px;
		background: #fff;
		color: #0f172a;
		font: 650 11px/1.4 Inter, ui-sans-serif, system-ui, sans-serif;
		padding: 3px 6px;
		cursor: pointer;
	}
	.memorall-co-agent-agent-select:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
`;
