import { createRoot, type Root } from "react-dom/client";
import { CoAgentOverlay } from "@/embedded/components/co-agents/CoAgentOverlay";
import { coAgentStyles } from "@/embedded/components/co-agents/styles";
import { EmbeddedRoot } from "@/embedded/components/EmbeddedRoot";
import { CO_AGENT_CONTAINER_ID } from "@/co-agent/constants";

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

	// App stylesheet first, copilot CSS second: document order decides ties, so
	// our rules win without needing !important.
	createStylesheet("options/index.css", shadowRoot);

	const customPropsStyle = document.createElement("style");
	customPropsStyle.textContent = coAgentStyles;
	shadowRoot.appendChild(customPropsStyle);

	// Deliberately no .memorall-chat-container class: that scopes the chat panel's
	// component rules, which the dock is not laid out for. Design tokens reach the
	// dock through the .light/.dark class EmbeddedRoot puts on this element.
	const mount = document.createElement("div");
	shadowRoot.appendChild(mount);
	document.body.appendChild(container);

	overlayRoot = createRoot(mount);
	overlayContainer = container;
	overlayRoot.render(
		<EmbeddedRoot themeTarget={mount}>
			<CoAgentOverlay
				portalRoot={shadowRoot}
				onDestroy={destroyCoAgentOverlay}
			/>
		</EmbeddedRoot>,
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
