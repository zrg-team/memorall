import React from "react";
import { cn } from "@/lib/utils";
import type { AgentIconScreenMetadata } from "@/services/database/entities/flows";

/**
 * An agent's mark, small enough for a toolbar.
 *
 * `AgentIcon` draws an animated canvas — right for an empty state at 108px,
 * far too heavy for a 14px chip, and illegible at that size besides. The part
 * that actually distinguishes one agent from another is its icon screen: an
 * emoji, or a short label in the agent's colour. This renders just that.
 *
 * An agent with no icon configured falls back to the first character of its
 * name, so the glyph is never blank and never identical between two agents
 * whose names differ — which is the whole point of showing it.
 */

export interface AgentGlyphProps {
	iconScreen?: AgentIconScreenMetadata | null;
	/** Used for the fallback initial when no icon screen is set. */
	name?: string;
	size?: number;
	className?: string;
}

const DEFAULT_COLOR = "#17e7e7";

const initialOf = (name: string | undefined): string =>
	name?.trim().charAt(0).toUpperCase() || "?";

export const AgentGlyph: React.FC<AgentGlyphProps> = ({
	iconScreen,
	name,
	size = 16,
	className,
}) => {
	const isEmoji = iconScreen?.kind === "emoji";
	const label = isEmoji
		? iconScreen.value
		: (iconScreen?.value ?? initialOf(name));
	const color = isEmoji ? undefined : (iconScreen?.color ?? DEFAULT_COLOR);

	return (
		<span
			aria-hidden="true"
			className={cn(
				"inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[4px] leading-none",
				!isEmoji && "font-semibold",
				className,
			)}
			style={{
				width: size,
				height: size,
				// Emoji carry their own colour; a text mark gets the agent's, tinted
				// behind it so a single letter still reads as a mark rather than a word.
				...(isEmoji
					? { fontSize: Math.round(size * 0.82) }
					: {
							fontSize: Math.round(size * 0.6),
							color,
							backgroundColor: `${color}1f`,
						}),
			}}
		>
			{/* A multi-character text screen would overflow a square this small. */}
			{isEmoji ? label : label.slice(0, 2)}
		</span>
	);
};
