import React, { useEffect, useRef, useState } from "react";

/**
 * Mounts its children only while near the viewport. When the wrapper scrolls far
 * outside the buffer it unmounts the children and leaves a same-height spacer, so
 * long conversations don't keep dozens of live artifact iframes / OpenUI trees
 * mounted at once. Remounts when scrolled back into range.
 *
 * `enabled={false}` disables the behaviour entirely (children always mounted) —
 * used for the actively streaming message, which must never be torn down.
 */
export const DeferredMount: React.FC<{
	children: React.ReactNode;
	enabled?: boolean;
	className?: string;
	minHeight?: number;
}> = ({ children, enabled = true, className, minHeight = 48 }) => {
	const ref = useRef<HTMLDivElement | null>(null);
	const [visible, setVisible] = useState(true);
	const [placeholderHeight, setPlaceholderHeight] = useState(minHeight);

	useEffect(() => {
		if (!enabled) {
			setVisible(true);
			return;
		}
		const el = ref.current;
		if (!el || typeof IntersectionObserver === "undefined") return;

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						setVisible(true);
					} else {
						// Capture the rendered height before unmounting so the spacer keeps
						// scroll position stable.
						const height = el.getBoundingClientRect().height;
						if (height > 0) setPlaceholderHeight(height);
						setVisible(false);
					}
				}
			},
			// ~1.5 viewports of buffer above and below: only embeds well off-screen unmount.
			{ rootMargin: "150% 0px 150% 0px", threshold: 0 },
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, [enabled]);

	const mounted = !enabled || visible;

	return (
		<div
			ref={ref}
			className={className}
			style={mounted ? undefined : { height: placeholderHeight }}
		>
			{mounted ? children : null}
		</div>
	);
};
