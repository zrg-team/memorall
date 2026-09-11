export const coAgentAnchorStyles = `
	.memorall-co-agent-anchor-trigger {
		all: initial;
		position: fixed;
		z-index: 2147483647;
		min-width: 66px;
		height: 34px;
		border: 0;
		border-radius: 999px;
		background: hsl(var(--popover));
		color: hsl(var(--foreground));
		box-shadow: 0 10px 26px rgb(15 23 42 / 0.22);
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		padding: 0 9px;
		font: 700 12px/1 Inter, ui-sans-serif, system-ui, sans-serif;
		cursor: pointer;
		pointer-events: auto;
		animation: memorall-co-agent-pop 150ms ease-out;
		transition: transform 140ms ease;
	}
	.memorall-co-agent-anchor-trigger:hover {
		transform: translateY(-1px) scale(1.03);
	}
	.memorall-co-agent-anchor-trigger span {
		white-space: nowrap;
	}
	.memorall-co-agent-anchor-prompt {
		all: initial;
		position: fixed;
		z-index: 2147483647;
		width: min(340px, calc(100vw - 24px));
		display: grid;
		grid-template-columns: minmax(0, 1fr) 34px;
		align-items: center;
		gap: 6px;
		border: 1px solid hsl(var(--border) / 0.94);
		border-radius: 12px;
		background: hsl(var(--popover) / 0.94);
		box-shadow: 0 16px 42px rgb(15 23 42 / 0.24);
		backdrop-filter: blur(14px);
		padding: 7px;
		pointer-events: auto;
		animation: memorall-co-agent-pop 150ms ease-out;
	}
	.memorall-co-agent-anchor-prompt textarea {
		min-width: 0;
		max-height: 92px;
		height: 32px;
		resize: none;
		border: 0;
		outline: none;
		background: transparent;
		color: hsl(var(--foreground));
		font: 500 13px/1.35 Inter, ui-sans-serif, system-ui, sans-serif;
		padding: 7px 7px 5px;
		overflow: auto;
	}
	.memorall-co-agent-anchor-prompt textarea::placeholder {
		color: hsl(var(--muted-foreground));
	}
	.memorall-co-agent-anchor-prompt button {
		width: 34px;
		height: 32px;
		border: 0;
		border-radius: 8px;
		background: hsl(var(--primary));
		color: hsl(var(--primary-foreground));
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}
	.memorall-co-agent-anchor-prompt button:disabled {
		cursor: not-allowed;
		opacity: 0.42;
	}
	@keyframes memorall-co-agent-pop {
		from {
			opacity: 0;
			transform: translateY(4px) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	/*
	 * One segmented control, not two floating pills: the actions are alternatives
	 * for the same element, so they share a shell and a divider rather than a gap.
	 */
	.memorall-co-agent-anchor-trigger-group {
		all: initial;
		position: fixed;
		z-index: 2147483647;
		display: inline-flex;
		align-items: stretch;
		overflow: hidden;
		border-radius: 999px;
		border: 1px solid hsl(var(--border) / 0.92);
		background: hsl(var(--popover));
		color: hsl(var(--foreground));
		box-shadow: 0 10px 26px rgb(15 23 42 / 0.28);
		pointer-events: auto;
		animation: memorall-co-agent-pop 150ms ease-out;
	}
	.memorall-co-agent-anchor-trigger-group .memorall-co-agent-anchor-trigger {
		position: static;
		border-radius: 0;
		box-shadow: none;
		animation: none;
		transition: background 140ms ease;
	}
	.memorall-co-agent-anchor-trigger-group
		.memorall-co-agent-anchor-trigger:hover {
		transform: none;
		background: hsl(var(--accent));
	}
	.memorall-co-agent-anchor-trigger--plain {
		min-width: 0;
		border-left: 1px solid hsl(var(--border) / 0.92);
	}
	/* Icon-only segments: the label is the tooltip, so they must not keep the
	   text segments' minimum width. */
	.memorall-co-agent-anchor-trigger--icon {
		min-width: 0;
		padding: 0 10px;
		color: hsl(var(--muted-foreground));
		border-left: 1px solid hsl(var(--border) / 0.92);
	}
	.memorall-co-agent-anchor-trigger-group
		.memorall-co-agent-anchor-trigger--icon[data-active="true"] {
		background: hsl(var(--foreground));
		color: hsl(var(--background));
	}
	.memorall-co-agent-attachment {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		gap: 5px;
		min-width: 0;
		margin-bottom: 6px;
		padding: 3px 4px 3px 8px;
		border: 1px solid hsl(var(--border) / 0.95);
		border-radius: 999px;
		background: hsl(var(--muted) / 0.9);
		color: hsl(var(--foreground));
		font: 650 11px/1.5 Inter, ui-sans-serif, system-ui, sans-serif;
	}
	.memorall-co-agent-attachment-text {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.memorall-co-agent-attachment .memorall-co-agent-attachment-remove {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 16px;
		height: 16px;
		padding: 0;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: hsl(var(--muted-foreground));
		cursor: pointer;
	}
	.memorall-co-agent-attachment .memorall-co-agent-attachment-remove:hover {
		background: hsl(var(--foreground) / 0.12);
		color: hsl(var(--foreground));
	}

	@media (prefers-reduced-motion: reduce) {
		.memorall-co-agent-anchor-trigger-group,
		.memorall-co-agent-anchor-trigger {
			animation: none;
		}
	}
`;
