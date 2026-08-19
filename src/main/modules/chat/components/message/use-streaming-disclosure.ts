import { useEffect, useRef, useState } from "react";

/**
 * Disclosure state for a run-details panel: open while the agent is working,
 * collapsed once it finishes.
 *
 * Watching the steps arrive is the point of these panels — a collapsed one
 * during a long run leaves the user with no idea what is happening — but the
 * finished list is noise above the answer, so it folds itself away.
 *
 * A manual toggle sticks: the effect only fires when `isStreaming` changes, so
 * collapsing mid-run is not immediately undone.
 */
export function useStreamingDisclosure(isStreaming: boolean) {
	const [isOpen, setIsOpen] = useState(isStreaming);
	const wasStreaming = useRef(isStreaming);

	useEffect(() => {
		if (isStreaming) {
			setIsOpen(true);
		} else if (wasStreaming.current) {
			// Only auto-collapse on the streaming→idle edge, never on a panel the
			// user opened themselves after the run finished.
			setIsOpen(false);
		}
		wasStreaming.current = isStreaming;
	}, [isStreaming]);

	return [isOpen, setIsOpen] as const;
}
