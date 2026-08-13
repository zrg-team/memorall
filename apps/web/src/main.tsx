import { mountMemorallApp } from "@/main/bootstrap";
import { connectWebRuntime } from "./runtime-client";

mountMemorallApp({ surface: "web" });

const runtimeConnection = connectWebRuntime();
void runtimeConnection.transport
	.request("health", {})
	.catch((error) => console.error("Web runtime worker health check failed", error));
window.addEventListener("pagehide", () => void runtimeConnection.close(), {
	once: true,
});

if ("serviceWorker" in navigator && import.meta.env.PROD) {
	window.addEventListener("load", () => {
		void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
			scope: import.meta.env.BASE_URL,
		});
	});
}
