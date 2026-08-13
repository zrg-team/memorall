import { mountMemorallApp } from "@/main/bootstrap";
import { connectDesktopWorkerRuntime } from "./runtime-client";

mountMemorallApp({ surface: "desktop" });

const runtimeConnection = connectDesktopWorkerRuntime();
void runtimeConnection.transport
	.request("health", {})
	.catch((error) => console.error("Desktop runtime worker health check failed", error));
window.addEventListener("pagehide", () => void runtimeConnection.close(), {
	once: true,
});
