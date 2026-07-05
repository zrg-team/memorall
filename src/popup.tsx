import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BACKGROUND_EVENTS } from "@/constants/events";

import "./globals.css";
import App from "./main/App";

// Popup-specific wrapper component
const PopupApp: React.FC = () => {
	useEffect(() => {
		chrome.runtime.sendMessage({
			type: BACKGROUND_EVENTS.POPUP_OPENED,
		});
	}, []);
	return (
		<div className="h-full w-full overflow-hidden bg-app">
			<App />
		</div>
	);
};

// Initialize popup with initial route detection before first render
const container = document.getElementById("root");
if (container) {
	document.documentElement.dataset.uiSurface = "popup";

	const render = () => {
		const root = createRoot(container);
		root.render(<PopupApp />);
	};

	try {
		const area = chrome.storage?.session ?? chrome.storage?.local;
		if (area?.get) {
			area.get(["navigateTo"], (data: { navigateTo?: string }) => {
				try {
					const target = data?.navigateTo as string | undefined;
					if (target === "knowledge-graph") {
						if (location.pathname !== "/knowledge-graph") {
							history.replaceState({}, "", "/knowledge-graph");
						}
						area?.remove?.("navigateTo");
					} else if (target === "remember") {
						if (location.pathname !== "/remember") {
							history.replaceState({}, "", "/remember");
						}
						area?.remove?.("navigateTo");
					} else if (target === "llm") {
						if (location.pathname !== "/llm") {
							history.replaceState({}, "", "/llm");
						}
						area?.remove?.("navigateTo");
					} else if (target === "topics") {
						if (location.pathname !== "/topics") {
							history.replaceState({}, "", "/topics");
						}
						area?.remove?.("navigateTo");
					} else if (target === "documents") {
						if (location.pathname !== "/files") {
							history.replaceState({}, "", "/files");
						}
						area?.remove?.("navigateTo");
					}
				} catch {}
				render();
			});
		} else {
			render();
		}
	} catch {
		render();
	}
} else {
	console.error("Root element not found in popup");
}
