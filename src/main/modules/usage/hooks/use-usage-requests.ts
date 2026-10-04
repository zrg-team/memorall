import React from "react";
import type { UsageRequest } from "../types";
import { loadUsageRequests } from "../services/usage-repository";

interface UsageRequestsState {
	requests: UsageRequest[];
	loading: boolean;
	error: string | null;
}

/**
 * Every model request since `since`. A new window keeps showing the previous
 * requests while it loads, so the page dims instead of flashing empty.
 */
export const useUsageRequests = (since: number) => {
	const [state, setState] = React.useState<UsageRequestsState>({
		requests: [],
		loading: true,
		error: null,
	});
	const [version, setVersion] = React.useState(0);

	React.useEffect(() => {
		let cancelled = false;
		setState((previous) => ({ ...previous, loading: true, error: null }));
		loadUsageRequests(new Date(since))
			.then((requests) => {
				if (!cancelled) setState({ requests, loading: false, error: null });
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setState((previous) => ({
					...previous,
					loading: false,
					error: error instanceof Error ? error.message : String(error),
				}));
			});
		return () => {
			cancelled = true;
		};
		// `version` re-runs the same window on refresh.
	}, [since, version]);

	const reload = React.useCallback(() => setVersion((value) => value + 1), []);
	return { ...state, reload };
};
