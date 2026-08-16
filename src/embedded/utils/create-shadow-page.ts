import { createRoot } from "react-dom/client";

const createStylesheet = (href: string, parent: ShadowRoot): void => {
	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.href = chrome.runtime.getURL(href);

	parent.appendChild(link);
};

export const createShadowPage = ({
	customStyles,
}: {
	customStyles: string;
}) => {
	// Create container element
	const container = document.createElement("div");
	container.id = "memorall-embedded-chat-modal";

	// Create Shadow DOM for complete CSS isolation
	const shadowRoot = container.attachShadow({ mode: "closed" });

	// Create the actual content container inside shadow DOM
	const shadowContainer = document.createElement("div");
	shadowContainer.className = "memorall-chat-container";

	// Add CSS custom properties for proper theming within Shadow DOM
	const customPropsStyle = document.createElement("style");
	customPropsStyle.textContent = customStyles;
	shadowRoot.appendChild(customPropsStyle);

	// The toolbar action opens the standalone options page, so its packaged CSS
	// is also the canonical stylesheet for embedded shadow-root surfaces.
	createStylesheet("options/index.css", shadowRoot);

	shadowRoot.appendChild(shadowContainer);

	// Create root and render inside shadow DOM
	const root = createRoot(shadowContainer);
	return {
		root,
		container,
	};
};
