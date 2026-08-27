import { mountMemorallApp } from "@/main/bootstrap";
import { registerAppServiceWorker } from "@/main/service-worker-update";
import { connectWebRuntime } from "./runtime-client";

mountMemorallApp({ surface: "web" });

const runtimeConnection = connectWebRuntime();
void runtimeConnection.transport
	.request("health", {})
	.catch((error) =>
		console.error("Web runtime worker health check failed", error),
	);
window.addEventListener("pagehide", () => void runtimeConnection.close(), {
	once: true,
});

// Registered as early as possible rather than on `load`: the worker also
// records which assets boot pulls in, so that it can serve them offline, and
// most of them are requested before the window has finished loading.
if (import.meta.env.PROD) {
	void registerAppServiceWorker(
		`${import.meta.env.BASE_URL}sw.js`,
		import.meta.env.BASE_URL,
	);
}
