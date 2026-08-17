import React from "react";
import { Link2, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { McpConnection } from "@/services/mcp-connections";

/**
 * Brand marks for connected apps.
 *
 * Every list in this feature — the catalog, a credential's apps, the agent's
 * provider picker, its chips — used to render two grey initials, so "GitHub"
 * and "Google Calendar" were both `GO` and nothing was recognisable at a
 * glance. Composio publishes a square logo per toolkit, and the connection
 * already talks to Composio, so fetching the mark reveals nothing new about
 * the user.
 *
 * The initials tile is kept as the fallback: it is what shows offline, on a
 * slug Composio has no art for, and for connections that are not apps at all.
 */

/**
 * Composio's logo CDN. Every toolkit's own `meta.logo` points here, so a slug
 * is enough for apps recorded before we started storing the URL.
 */
export const composioLogoUrl = (slug: string): string =>
	`https://logos.composio.dev/api/${encodeURIComponent(slug.toLowerCase())}`;

/** Composio is itself a toolkit, so its mark comes from the same place. */
export const COMPOSIO_LOGO_URL = composioLogoUrl("composio");

const initialsOf = (name: string): string => {
	const words = name
		.trim()
		.split(/[\s_-]+/)
		.filter(Boolean);
	if (words.length === 0) return "?";
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
	return `${words[0][0]}${words[1][0]}`.toUpperCase();
};

interface AppIconProps {
	name: string;
	/** Explicit logo URL, e.g. the one Composio returned with the toolkit. */
	src?: string;
	/**
	 * Composio toolkit slug. Only pass this for Composio apps — it derives the
	 * CDN URL, which would be a wrong guess for any other kind of connection.
	 */
	composioSlug?: string;
	/** Pixel size of the square tile. */
	size?: number;
	className?: string;
}

export const AppIcon: React.FC<AppIconProps> = ({
	name,
	src,
	composioSlug,
	size = 24,
	className,
}) => {
	const resolved = src ?? (composioSlug ? composioLogoUrl(composioSlug) : null);
	const [failed, setFailed] = React.useState(false);

	// A different app in the same list position must not inherit the previous
	// one's failure, and re-mounts are exactly how these lists update.
	React.useEffect(() => setFailed(false), [resolved]);

	const box: React.CSSProperties = { width: size, height: size };

	if (!resolved || failed) {
		return (
			<span
				style={box}
				className={cn(
					"grid shrink-0 place-items-center rounded-lg bg-muted font-bold uppercase leading-none text-muted-foreground",
					className,
				)}
				// The tile scales with the icon; two characters have to fit inside it.
				aria-hidden="true"
			>
				<span style={{ fontSize: Math.max(8, Math.round(size * 0.38)) }}>
					{initialsOf(name)}
				</span>
			</span>
		);
	}

	return (
		<img
			src={resolved}
			alt=""
			style={box}
			// White behind the mark: most brand logos are drawn for a light ground
			// and vanish into a dark theme otherwise.
			className={cn(
				"shrink-0 rounded-lg border border-border/40 bg-white object-contain p-0.5",
				className,
			)}
			onError={() => setFailed(true)}
			loading="lazy"
		/>
	);
};

/**
 * The mark for one connection: Composio's logo, or the shape of the endpoint
 * behind it. Used wherever a credential is listed rather than an app.
 */
export const ConnectionIcon: React.FC<{
	kind: McpConnection["kind"];
	size?: number;
	className?: string;
}> = ({ kind, size = 24, className }) => {
	if (kind === "composio") {
		return (
			<AppIcon
				name="Composio"
				src={COMPOSIO_LOGO_URL}
				size={size}
				className={className}
			/>
		);
	}
	return (
		<span
			style={{ width: size, height: size }}
			className={cn(
				"grid shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground",
				className,
			)}
		>
			{kind === "template" ? (
				<Terminal size={Math.round(size * 0.5)} />
			) : (
				<Link2 size={Math.round(size * 0.5)} />
			)}
		</span>
	);
};
