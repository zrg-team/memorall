import type { MemonWindowApp } from "@/services/memon/constants";

/**
 * What the computer's dock shows. A few apps stay in it; the rest sit in
 * groups, one dock button each, so the dock does not grow with every app a
 * computer has. A grouped app with a window open joins the dock while it is
 * open, so a minimized window is still one click away.
 */

/** An app the dock can open, and whether it can now. */
export interface MemonDockLauncher {
	id: MemonWindowApp;
	available: boolean;
	/** Why it cannot, when it cannot. */
	reason?: string;
}

export type MemonDockGroupId = "office" | "create" | "agent";

/** Always in the dock: what the user reaches for most. */
export const MEMON_DOCK_PINNED: readonly MemonWindowApp[] = [
	"browser",
	"files",
	"terminal",
	"tasks",
	"pi",
	"fx",
];

/** The other apps, by what they are for. */
export const MEMON_DOCK_GROUPS: ReadonlyArray<{
	id: MemonDockGroupId;
	apps: readonly MemonWindowApp[];
}> = [
	{
		id: "office",
		apps: ["spreadsheet", "documents", "presentation", "whiteboard", "pdf"],
	},
	{ id: "create", apps: ["studio", "visualize", "video"] },
	// The agent's own settings: its schedules, skills and connections.
	{ id: "agent", apps: ["scheduler", "skills", "connections"] },
];

export type MemonDockEntry =
	| { kind: "app"; launcher: MemonDockLauncher }
	| { kind: "group"; id: MemonDockGroupId; launchers: MemonDockLauncher[] };

export interface MemonDockLayout {
	/** Pinned apps and apps in no group, as given, then one entry per group. */
	entries: MemonDockEntry[];
	/** Grouped apps with a window open. */
	running: MemonDockLauncher[];
}

const GROUP_OF = new Map<MemonWindowApp, MemonDockGroupId>(
	MEMON_DOCK_GROUPS.flatMap((group) =>
		group.apps.map((app) => [app, group.id] as const),
	),
);

export const memonDockLayout = (
	launchers: readonly MemonDockLauncher[],
	isOpen: (app: MemonWindowApp) => boolean,
): MemonDockLayout => {
	const entries: MemonDockEntry[] = [];
	const members = new Map<MemonDockGroupId, MemonDockLauncher[]>();
	for (const launcher of launchers) {
		const group = MEMON_DOCK_PINNED.includes(launcher.id)
			? undefined
			: GROUP_OF.get(launcher.id);
		if (!group) entries.push({ kind: "app", launcher });
		else members.set(group, [...(members.get(group) ?? []), launcher]);
	}
	const running: MemonDockLauncher[] = [];
	for (const { id } of MEMON_DOCK_GROUPS) {
		const list = members.get(id) ?? [];
		const [only] = list;
		// A group of one is just its app.
		if (list.length === 1 && only)
			entries.push({ kind: "app", launcher: only });
		else if (list.length > 1) {
			entries.push({ kind: "group", id, launchers: list });
			running.push(...list.filter((launcher) => isOpen(launcher.id)));
		}
	}
	return { entries, running };
};
