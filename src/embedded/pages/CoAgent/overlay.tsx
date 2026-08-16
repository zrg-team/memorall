import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { CoAgentOverlay } from "@/embedded/components/co-agents/CoAgentOverlay";
import { coAgentStyles } from "@/embedded/components/co-agents/styles";
import { CO_AGENT_CONTAINER_ID } from "./constants";

let overlayRoot: Root | null = null;
let overlayContainer: HTMLDivElement | null = null;

const createStylesheet = (href: string, parent: ShadowRoot): void => {
	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.href = chrome.runtime.getURL(href);
	parent.appendChild(link);
};

export const createCoAgentOverlay = (): void => {
	if (overlayRoot && overlayContainer?.isConnected) {
		return;
	}

	destroyCoAgentOverlay();

	const container = document.createElement("div");
	container.id = CO_AGENT_CONTAINER_ID;
	container.style.cssText =
		"position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
	const shadowRoot = container.attachShadow({ mode: "open" });

	const customPropsStyle = document.createElement("style");
	customPropsStyle.textContent = coAgentStyles;
	shadowRoot.appendChild(customPropsStyle);
	createStylesheet("options/index.css", shadowRoot);

	const mount = document.createElement("div");
	shadowRoot.appendChild(mount);
	document.body.appendChild(container);

	overlayRoot = createRoot(mount);
	overlayContainer = container;
	overlayRoot.render(
		<CoAgentOverlay
			portalRoot={shadowRoot}
			onDestroy={destroyCoAgentOverlay}
		/>,
	);
};

export const destroyCoAgentOverlay = (): void => {
	if (overlayRoot) {
		overlayRoot.unmount();
		overlayRoot = null;
	}
	overlayContainer?.remove();
	overlayContainer = null;
};
