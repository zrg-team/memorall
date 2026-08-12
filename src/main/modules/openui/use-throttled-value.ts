import { startTransition, useEffect, useRef, useState } from "react";

/**
 * Trailing-throttle a value while `active` is true.
 *
 * Used to limit how often the streaming OpenUI content is fed to the (relatively
 * expensive) DSL parser: while streaming we update at most once per `ms`; the
 * moment streaming ends we return the real value synchronously so the final frame
 * is never stale.
 */
export function useThrottledValue<T>(value: T, active: boolean, ms: number): T {
	const [throttled, setThrottled] = useState(value);
	const lastEmitRef = useRef<number | null>(null);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const valueRef = useRef(value);
	valueRef.current = value;

	useEffect(() => {
		if (!active) {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
			setThrottled(value);
			return;
		}

		const now = Date.now();
		const elapsed =
			lastEmitRef.current === null
				? Number.POSITIVE_INFINITY
				: now - lastEmitRef.current;
		if (elapsed >= ms) {
			lastEmitRef.current = now;
			startTransition(() => setThrottled(value));
			return;
		}
		if (!timerRef.current) {
			timerRef.current = setTimeout(() => {
				timerRef.current = null;
				lastEmitRef.current = Date.now();
				startTransition(() => setThrottled(valueRef.current));
			}, ms - elapsed);
		}
	}, [value, active, ms]);

	useEffect(
		() => () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		},
		[],
	);

	// When not streaming, always render the real value (no stale trailing frame).
	return active ? throttled : value;
}
