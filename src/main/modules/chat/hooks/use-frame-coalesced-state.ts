import {
	type MutableRefObject,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

type PendingFrame = {
	id: number;
	type: "animation" | "timeout";
};

const resolveStateAction = <T>(action: SetStateAction<T>, previous: T): T =>
	typeof action === "function" ? (action as (value: T) => T)(previous) : action;

/**
 * Keeps the latest streamed value immediately available in a ref while
 * publishing at most one React state update per animation frame.
 */
export const useFrameCoalescedState = <T>(
	initialValue: T,
): {
	value: T;
	latestRef: MutableRefObject<T>;
	setCoalesced: (action: SetStateAction<T>) => void;
	setImmediate: (action: SetStateAction<T>) => void;
} => {
	const [value, setValue] = useState(initialValue);
	const latestRef = useRef(initialValue);
	const pendingFrameRef = useRef<PendingFrame | null>(null);

	const cancelPendingFrame = useCallback(() => {
		const pending = pendingFrameRef.current;
		if (!pending) return;

		if (pending.type === "animation") {
			window.cancelAnimationFrame(pending.id);
		} else {
			window.clearTimeout(pending.id);
		}
		pendingFrameRef.current = null;
	}, []);

	const publishLatest = useCallback(() => {
		pendingFrameRef.current = null;
		setValue(latestRef.current);
	}, []);

	const setCoalesced = useCallback(
		(action: SetStateAction<T>) => {
			latestRef.current = resolveStateAction(action, latestRef.current);
			if (pendingFrameRef.current) return;

			if (typeof window.requestAnimationFrame === "function") {
				pendingFrameRef.current = {
					type: "animation",
					id: window.requestAnimationFrame(publishLatest),
				};
				return;
			}

			pendingFrameRef.current = {
				type: "timeout",
				id: window.setTimeout(publishLatest, 16),
			};
		},
		[publishLatest],
	);

	const setImmediate = useCallback(
		(action: SetStateAction<T>) => {
			cancelPendingFrame();
			latestRef.current = resolveStateAction(action, latestRef.current);
			setValue(latestRef.current);
		},
		[cancelPendingFrame],
	);

	useEffect(() => cancelPendingFrame, [cancelPendingFrame]);

	return { value, latestRef, setCoalesced, setImmediate };
};
