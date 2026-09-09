import type React from "react";
import { ThemeProvider } from "@/main/components/molecules/ThemeContext";
import { embeddedThemeStorage } from "@/main/components/molecules/theme-storage";

interface EmbeddedRootProps {
	/**
	 * Element inside the shadow tree that receives the `light`/`dark` class.
	 * Never the document root — this UI is injected into someone else's page.
	 */
	themeTarget: HTMLElement;
	children: React.ReactNode;
}

/**
 * Shared provider shell for every in-page surface mounted into a shadow root.
 *
 * Mounting ThemeProvider here is not only about theming. Components reached from
 * the embedded tree call `useTheme()` from inside error-boundary fallbacks
 * (OpenUIRenderer -> MarkdownMessage), so a missing provider used to throw out of
 * the boundary's own render and unmount the entire copilot.
 */
export const EmbeddedRoot: React.FC<EmbeddedRootProps> = ({
	themeTarget,
	children,
}) => (
	<ThemeProvider
		defaultTheme="system"
		themeTarget={themeTarget}
		storage={embeddedThemeStorage}
	>
		{children}
	</ThemeProvider>
);

export default EmbeddedRoot;
