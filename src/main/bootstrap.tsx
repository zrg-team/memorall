import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import type { AppSurface } from "@/platform";
import { platform } from "@/platform/current";
import { connectLogRecording } from "@/utils/logger";
import App from "./App";
import "../globals.css";

export interface MountMemorallAppOptions {
	surface: AppSurface;
	container?: HTMLElement | null;
}

export function mountMemorallApp({
	surface,
	container = document.getElementById("root"),
}: MountMemorallAppOptions): void {
	if (!container) {
		throw new Error(`Root element not found for ${surface} surface`);
	}

	document.documentElement.dataset.uiSurface = surface;
	void platform.lifecycle.onSurfaceOpened(surface);
	// Logs are recorded when the Logs page's switch, kept here, says so.
	connectLogRecording(platform.persistentStore);

	const heightClass = surface === "popup" ? "h-full" : "h-screen";
	createRoot(container).render(
		<div className={`${heightClass} w-full overflow-hidden bg-app`}>
			<App />
		</div>,
	);
}
