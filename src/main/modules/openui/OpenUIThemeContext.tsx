import React, { createContext, useContext } from "react";
import type { OpenUITheme } from "@/services/flows-core/steps/features/visualize-response";

const OpenUIThemeContext = createContext<OpenUITheme>("shadcn");

export function OpenUIThemeProvider({
	theme,
	children,
}: {
	theme: OpenUITheme;
	children: React.ReactNode;
}) {
	return (
		<OpenUIThemeContext.Provider value={theme}>
			{children}
		</OpenUIThemeContext.Provider>
	);
}

export function useOpenUITheme(): OpenUITheme {
	return useContext(OpenUIThemeContext);
}
