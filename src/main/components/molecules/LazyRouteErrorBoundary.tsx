import React from "react";
import { Button } from "@/main/components/ui/button";

const CHUNK_LOAD_ERROR_PATTERN =
	/(?:ChunkLoadError|Loading chunk \d+ failed|Failed to fetch dynamically imported module)/i;

export const isLazyChunkLoadError = (error: unknown): error is Error =>
	error instanceof Error && CHUNK_LOAD_ERROR_PATTERN.test(error.message);

const getReloadKey = () =>
	`memorall.lazy-route-reload:${window.location.pathname}`;

type LazyRouteErrorBoundaryState = {
	error: Error | null;
};

export class LazyRouteErrorBoundary extends React.Component<
	React.PropsWithChildren,
	LazyRouteErrorBoundaryState
> {
	state: LazyRouteErrorBoundaryState = { error: null };

	static getDerivedStateFromError(error: Error): LazyRouteErrorBoundaryState {
		return { error };
	}

	componentDidCatch(error: Error) {
		if (!isLazyChunkLoadError(error)) return;

		const reloadKey = getReloadKey();
		if (window.sessionStorage.getItem(reloadKey)) return;

		window.sessionStorage.setItem(reloadKey, "1");
		window.location.reload();
	}

	render() {
		if (!this.state.error) return this.props.children;

		const isChunkLoadError = isLazyChunkLoadError(this.state.error);

		return (
			<div className="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center">
				<p className="max-w-sm text-sm text-muted-foreground">
					{isChunkLoadError
						? "The application was updated and this page needs to reload."
						: "This page could not be loaded."}
				</p>
				<Button
					type="button"
					size="sm"
					onClick={() => window.location.reload()}
				>
					Reload page
				</Button>
			</div>
		);
	}
}
