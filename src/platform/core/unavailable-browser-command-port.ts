import type { BrowserCommandPort } from "../contracts/core";

export class UnavailableBrowserCommandPort implements BrowserCommandPort {
	async request<T>(_request: unknown): Promise<T> {
		throw new Error(
			"Browser-backed automation is unavailable in this environment.",
		);
	}

	async tabExists(_tabId: number): Promise<boolean> {
		return false;
	}
}
