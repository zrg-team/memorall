import { mountMemorallApp } from "@/main/bootstrap";
import { connectDesktopWorkerRuntime } from "./runtime-client";

// The boot splash and the window reveal are owned by `boot.ts`, a separate entry
// that must not be imported from here — see the note at the top of that file.
mountMemorallApp({ surface: "desktop" });

const runtimeConnection = connectDesktopWorkerRuntime();
void runtimeConnection.transport
	.request("health", {})
	.catch((error) => console.error("Desktop runtime worker health check failed", error));
window.addEventListener("pagehide", () => void runtimeConnection.close(), {
	once: true,
});
