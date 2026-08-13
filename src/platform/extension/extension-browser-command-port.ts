import type { BrowserCommandPort } from "../contracts/core";

export class ExtensionBrowserCommandPort implements BrowserCommandPort {
	async request<T>(request: unknown): Promise<T> {
		return (await chrome.runtime.sendMessage(request)) as T;
	}

	async tabExists(tabId: number): Promise<boolean> {
		try {
			await chrome.tabs.get(tabId);
			return true;
		} catch {
			return false;
		}
	}
}
