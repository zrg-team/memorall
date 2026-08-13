import type { ExternalLinkPort } from "../contracts/core";

export class WindowExternalLinkPort implements ExternalLinkPort {
	async open(url: string): Promise<void> {
		const opened = globalThis.open(url, "_blank", "noopener,noreferrer");
		if (!opened) {
			throw new Error("The browser blocked the new window.");
		}
	}

	async openStandalone(): Promise<void> {
		await this.open(globalThis.location?.href ?? "/");
	}
}
