import { platform } from "@/platform/current";

/**
 * Opens the standalone page using the preferred Chrome extension API.
 * Uses openOptionsPage() first; falls back to focusing an existing tab or
 * creating a new one (mirrors the context-menu handler logic).
 */
export const openStandalonePage = async (): Promise<void> => {
	await platform.externalLinks.openStandalone();
};
