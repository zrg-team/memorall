import type React from "react";

import { Skeleton } from "@/main/components/ui/skeleton";
import { useShellLayoutStore } from "@/main/stores/shell-layout";
import { useMediaQuery } from "@/main/hooks/use-viewport";

/**
 * Placeholders for the two gaps that used to render as a bare spinner (or as
 * nothing at all) between "services are ready" and "the page has data":
 *
 * - `AppShellSkeleton` covers `AppShell` waiting on the persisted model lookup.
 * - `WorkspaceContentSkeleton` covers a lazily-imported route chunk arriving.
 *
 * Both mirror the geometry of what replaces them — same panel widths, same rail,
 * same header/row rhythm — so the swap reads as content filling in rather than
 * as another full-screen state change.
 */

const MOBILE_WORKSPACE_QUERY = "(max-width: 640px)";

const RAIL_ITEM_COUNT = 6;
const CHAT_BUBBLE_WIDTHS = ["w-3/5", "w-4/5", "w-2/5", "w-3/4"] as const;
const CONTENT_ROW_WIDTHS = [
	"w-11/12",
	"w-9/12",
	"w-10/12",
	"w-7/12",
	"w-8/12",
	"w-6/12",
] as const;

export const ChatPanelSkeleton: React.FC = () => (
	<div
		className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background"
		aria-busy="true"
		aria-live="polite"
		data-testid="chat-panel-skeleton"
	>
		<div className="flex items-center gap-3 border-b px-4 py-3">
			<Skeleton className="h-8 w-8 rounded-lg" />
			<Skeleton className="h-4 w-40" />
			<Skeleton className="ml-auto h-8 w-8 rounded-lg" />
		</div>

		<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-4 py-6">
			{CHAT_BUBBLE_WIDTHS.map((width, index) => (
				<div
					key={width}
					className={`flex flex-col gap-2 ${index % 2 === 1 ? "items-end" : "items-start"}`}
				>
					<Skeleton className={`h-3 ${width} max-w-[520px]`} />
					<Skeleton className="h-3 w-1/3 max-w-[280px]" />
				</div>
			))}
		</div>

		<div className="border-t px-4 py-3">
			<Skeleton className="h-11 w-full rounded-xl" />
		</div>
	</div>
);

const RailSkeleton: React.FC = () => (
	<div className="flex h-full w-14 flex-col items-center gap-1 border-l bg-app py-2">
		<Skeleton className="h-9 w-9 rounded-md" />
		<div className="mt-2 flex flex-col items-center gap-1">
			{Array.from({ length: RAIL_ITEM_COUNT }, (_, index) => (
				<Skeleton key={index} className="h-9 w-9 rounded-md" />
			))}
		</div>
	</div>
);

export const WorkspaceContentSkeleton: React.FC = () => (
	<div
		className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background"
		aria-busy="true"
		aria-live="polite"
		data-testid="workspace-content-skeleton"
	>
		<div className="flex items-center gap-3 border-b px-5 py-4">
			<Skeleton className="h-5 w-5 rounded" />
			<Skeleton className="h-4 w-44" />
			<Skeleton className="ml-auto h-8 w-24 rounded-lg" />
		</div>

		<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-5">
			{CONTENT_ROW_WIDTHS.map((width) => (
				<div key={width} className="flex items-center gap-3">
					<Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
					<div className="flex min-w-0 flex-1 flex-col gap-2">
						<Skeleton className={`h-3 ${width}`} />
						<Skeleton className="h-2.5 w-4/12" />
					</div>
				</div>
			))}
		</div>
	</div>
);

export const AppShellSkeleton: React.FC = () => {
	const chatShellWidth = useShellLayoutStore((state) => state.chatShellWidth);
	const rightPanelCollapsed = useShellLayoutStore(
		(state) => state.rightPanelCollapsed,
	);
	const isNarrow = useMediaQuery(MOBILE_WORKSPACE_QUERY);

	const chatPanelWidth = isNarrow
		? "100%"
		: rightPanelCollapsed
			? "calc(100vw - 56px)"
			: `${chatShellWidth}vw`;

	return (
		<div
			className="flex h-full min-h-0 w-full overflow-hidden bg-background text-foreground"
			aria-busy="true"
			aria-live="polite"
			data-testid="app-shell-skeleton"
		>
			<section
				className="relative z-20 flex h-full min-h-0 flex-shrink-0 flex-col border-r bg-background max-[640px]:w-full max-[640px]:border-r-0"
				style={{ width: chatPanelWidth, flexBasis: chatPanelWidth }}
			>
				<ChatPanelSkeleton />
			</section>

			{isNarrow ? null : (
				<section
					className="min-h-0 min-w-0 flex-shrink-0 overflow-hidden"
					style={
						rightPanelCollapsed
							? { width: "56px", flexBasis: "56px" }
							: {
									width: `calc(100vw - ${chatShellWidth}vw)`,
									flexBasis: `calc(100vw - ${chatShellWidth}vw)`,
								}
					}
				>
					{rightPanelCollapsed ? (
						<RailSkeleton />
					) : (
						<WorkspaceContentSkeleton />
					)}
				</section>
			)}
		</div>
	);
};
