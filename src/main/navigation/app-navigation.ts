/**
 * Navigation for UI that renders outside the router, such as NiceModal
 * dialogs: `useNavigate` throws there. The router's bridge in App listens and
 * performs the navigation.
 */
export interface AppNavigationRequest {
	path: string;
	state?: unknown;
}

type Listener = (request: AppNavigationRequest) => void;

const listeners = new Set<Listener>();

export const requestAppNavigation = (request: AppNavigationRequest): void => {
	for (const listener of listeners) listener(request);
};

export const subscribeAppNavigation = (listener: Listener): (() => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};
