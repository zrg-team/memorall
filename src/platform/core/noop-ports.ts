import type {
	AppLifecyclePort,
	AppNavigationPort,
	NavigationRequest,
} from "../contracts/core";

export class NoopNavigationPort implements AppNavigationPort {
	async takePending(): Promise<NavigationRequest | null> {
		return null;
	}

	subscribe(_listener: (request: NavigationRequest) => void): () => void {
		return () => undefined;
	}
}

export const noopLifecyclePort: AppLifecyclePort = {
	onSurfaceOpened: () => undefined,
};
