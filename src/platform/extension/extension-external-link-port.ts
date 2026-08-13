import type { ExternalLinkPort } from "../contracts/core";

export class ExtensionExternalLinkPort implements ExternalLinkPort {
	async open(url: string): Promise<void> {
		await chrome.tabs.create({ url, active: true });
	}

	async openStandalone(): Promise<void> {
		try {
			await chrome.runtime.openOptionsPage();
			return;
		} catch {
			const optionsUrl = chrome.runtime.getURL("standalone.html");
			const existing = await chrome.tabs.query({ url: optionsUrl });
			if (existing.length > 0 && existing[0].id != null) {
				await chrome.tabs.update(existing[0].id, { active: true });
				if (existing[0].windowId != null) {
					await chrome.windows.update(existing[0].windowId, { focused: true });
				}
				return;
			}
			await chrome.tabs.create({ url: optionsUrl, active: true });
		}
	}
}
