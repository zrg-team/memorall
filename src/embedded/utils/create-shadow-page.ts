import { createRoot } from "react-dom/client";

const createStylesheet = (
	href: string,
	parent: ShadowRoot,
	fallbackHref?: string,
): void => {
	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.href = chrome.runtime.getURL(href);

	if (fallbackHref) {
		link.onerror = () => {
			link.remove();
			createStylesheet(fallbackHref, parent);
		};
	}

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

	// Inject Tailwind CSS with fallback. The toolbar action no longer builds a
	// popup entry (it opens the standalone page), so the standalone build's CSS
	// is the primary source; keep the old action path as a fallback.
	createStylesheet("options/index.css", shadowRoot, "action/index.css");

	shadowRoot.appendChild(shadowContainer);

	// Create root and render inside shadow DOM
	const root = createRoot(shadowContainer);
	return {
		root,
		container,
	};
};
