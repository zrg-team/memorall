import { createRoot } from "react-dom/client";

/**
 * The packaged options-page stylesheet is the canonical source of design tokens
 * and Tailwind utilities for every embedded surface.
 *
 * It stays a <link> rather than an adopted CSSStyleSheet on purpose: the compiled
 * bundle references its font files with root-relative `url(/assets/...)`, which a
 * <link> resolves against the extension origin but `CSSStyleSheet.replace()`
 * would resolve against the host page, 404ing every brand font.
 */
const appendAppStylesheet = (parent: ShadowRoot): void => {
	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.href = chrome.runtime.getURL("options/index.css");

	parent.appendChild(link);
};

/**
 * Copilot-owned CSS is appended *after* the app stylesheet so it wins ties by
 * document order. Appending it first is what forced the rules in customStyles to
 * carry `!important` just to beat the sheet loaded after them.
 */
const appendCopilotStyles = (parent: ShadowRoot, css: string): void => {
	const style = document.createElement("style");
	style.textContent = css;

	parent.appendChild(style);
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

	appendAppStylesheet(shadowRoot);
	appendCopilotStyles(shadowRoot, customStyles);

	shadowRoot.appendChild(shadowContainer);

	// Create root and render inside shadow DOM
	const root = createRoot(shadowContainer);
	return {
		root,
		container,
		// The element inside the shadow tree that carries the theme class and the
		// design tokens. Callers pass it to EmbeddedRoot so the injected UI themes
		// itself without touching the host page's <html>.
		shadowContainer,
		shadowRoot,
	};
};
