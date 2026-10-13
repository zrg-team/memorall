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

export interface FrameCoalescer<T> {
	/** The value with every update applied, published or not. */
	latest: () => T;
	/** Applies an update, publishing at most once per animation frame. */
	setCoalesced: (action: SetStateAction<T>) => void;
	/** Applies an update and publishes it now, dropping the queued frame. */
	setImmediate: (action: SetStateAction<T>) => void;
	/** Drops the queued frame, if any. */
	cancel: () => void;
}

/**
 * Keeps the latest value at hand while handing it to `publish` at most once
 * per animation frame: updates that arrive faster than the screen can show
 * them (streamed tokens) are merged into one.
 */
export const createFrameCoalescer = <T>(
	initialValue: T,
	publish: (value: T) => void,
): FrameCoalescer<T> => {
	let latest = initialValue;
	let pending: PendingFrame | null = null;

	const cancel = () => {
		if (!pending) return;
		if (pending.type === "animation") {
			window.cancelAnimationFrame(pending.id);
		} else {
			window.clearTimeout(pending.id);
		}
		pending = null;
	};

	const publishLatest = () => {
		pending = null;
		publish(latest);
	};

	return {
		latest: () => latest,
		setCoalesced: (action) => {
			latest = resolveStateAction(action, latest);
			if (pending) return;

			if (typeof window.requestAnimationFrame === "function") {
				pending = {
					type: "animation",
					id: window.requestAnimationFrame(publishLatest),
				};
				return;
			}

			pending = {
				type: "timeout",
				id: window.setTimeout(publishLatest, 16),
			};
		},
		setImmediate: (action) => {
			cancel();
			latest = resolveStateAction(action, latest);
			publish(latest);
		},
		cancel,
	};
};

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
	const [coalescer] = useState(() =>
		createFrameCoalescer(initialValue, setValue),
	);

	const setCoalesced = useCallback(
		(action: SetStateAction<T>) => {
			coalescer.setCoalesced(action);
			latestRef.current = coalescer.latest();
		},
		[coalescer],
	);

	const setImmediate = useCallback(
		(action: SetStateAction<T>) => {
			coalescer.setImmediate(action);
			latestRef.current = coalescer.latest();
		},
		[coalescer],
	);

	useEffect(() => coalescer.cancel, [coalescer]);

	return { value, latestRef, setCoalesced, setImmediate };
};
