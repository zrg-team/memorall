import React from "react";
import {
	HostedAppFrame,
	type HostedAppFrameHandle,
} from "@/main/modules/files/components/HostedAppFrame";
import type { HostedAppId } from "@/services/memon/apps/hosted/catalog";
import type { MemonHostedAppState } from "@/services/memon/types";
import type { MemonSend } from "../types";

/** One "edited and saved" note per file this often, not one per autosave. */
const SAVE_NOTE_INTERVAL_MS = 5_000;

/**
 * A hosted app on the computer: the app's own page, opened with the file the
 * machine says (or the app's home). The user works in it directly; saves are
 * told to the machine so the agent knows, and the agent's changes to the
 * file reopen it here.
 */
const HostedAppWindowView = React.forwardRef<
	HostedAppFrameHandle,
	{
		app: HostedAppId;
		machineKey: string;
		state: MemonHostedAppState | undefined;
		home: string;
		send: MemonSend;
		/** The agent using the computer: the app's AI is charged to it. */
		agentId?: string | null;
	}
>(function HostedAppWindow(
	{ app, machineKey, state, home, send, agentId },
	ref,
) {
	// The file the window was opened with. A file the user opens inside the
	// app does not reopen the window; the machine opening another file does.
	const opened = state?.opened;
	const launch = React.useRef<{ opened?: number; path: string | null }>({
		opened,
		path: state?.path ?? null,
	});
	if (launch.current.opened !== opened) {
		launch.current = { opened, path: state?.path ?? null };
	}
	const lastNotes = React.useRef(new Map<string, number>());
	const onWrite = React.useCallback(
		(path: string) => {
			const now = Date.now();
			if (now - (lastNotes.current.get(path) ?? 0) < SAVE_NOTE_INTERVAL_MS)
				return;
			lastNotes.current.set(path, now);
			void send("hosted.saved", { key: machineKey, app, path });
		},
		[send, machineKey, app],
	);
	return (
		<HostedAppFrame
			key={`${opened ?? 0}`}
			ref={ref}
			app={app}
			path={launch.current.path}
			home={home}
			onWrite={onWrite}
			agentId={agentId}
		/>
	);
});

/** Renders only when its slice of the machine changes: the store keeps unchanged slices by reference. */
export const HostedAppWindow = React.memo(HostedAppWindowView);
