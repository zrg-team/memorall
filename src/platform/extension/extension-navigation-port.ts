import type { AppNavigationPort, NavigationRequest } from "../contracts/core";

const namedRoutes: Record<string, string> = {
	activities: "/activities",
	"knowledge-graph": "/memory",
	memory: "/memory",
	remember: "/remember",
	llm: "/llm",
	topics: "/topics",
	documents: "/files",
	files: "/files",
};

function routeFor(target: unknown): string | null {
	if (typeof target !== "string") return null;
	return namedRoutes[target] ?? (target.startsWith("/") ? target : null);
}

export class ExtensionNavigationPort implements AppNavigationPort {
	async takePending(): Promise<NavigationRequest | null> {
		const area = chrome.storage.session ?? chrome.storage.local;
		const result = await area.get(["navigateTo", "openDocumentPath"]);
		const path = routeFor(result.navigateTo);
		if (!path) return null;

		await area.remove(["navigateTo", "openDocumentPath"]);
		const openDocumentPath =
			path === "/files" && typeof result.openDocumentPath === "string"
				? result.openDocumentPath
				: undefined;
		return {
			path,
			state: openDocumentPath ? { openDocumentPath } : undefined,
		};
	}

	subscribe(listener: (request: NavigationRequest) => void): () => void {
		const messageHandler = (message: { type?: string }) => {
			if (message?.type === "OPEN_KNOWLEDGE_GRAPH") {
				listener({ path: "/memory" });
			} else if (message?.type === "OPEN_REMEMBER_PAGE") {
				listener({ path: "/remember" });
			}
		};
		const storageHandler = (
			changes: Record<string, chrome.storage.StorageChange>,
			areaName: string,
		) => {
			if (
				areaName === "session" &&
				("navigateTo" in changes || "openDocumentPath" in changes)
			) {
				void this.takePending().then((request) => {
					if (request) listener(request);
				});
			}
		};

		chrome.runtime.onMessage.addListener(messageHandler);
		chrome.storage.onChanged.addListener(storageHandler);
		return () => {
			chrome.runtime.onMessage.removeListener(messageHandler);
			chrome.storage.onChanged.removeListener(storageHandler);
		};
	}
}
