import React, { useCallback, useRef, useState } from "react";

export const useConversationAutoScroll = () => {
	const conversationRef = useRef<HTMLDivElement>(null);
	const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

	const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
		if (conversationRef.current) {
			conversationRef.current.scrollTo({
				top: conversationRef.current.scrollHeight,
				behavior,
			});
		}
	}, []);

	const checkIfNearBottom = useCallback(() => {
		if (!conversationRef.current) {
			return false;
		}

		const { scrollTop, scrollHeight, clientHeight } = conversationRef.current;
		const threshold = 100;
		return scrollHeight - scrollTop - clientHeight < threshold;
	}, []);

	const handleScroll = useCallback(() => {
		setShouldAutoScroll(checkIfNearBottom());
	}, [checkIfNearBottom]);

	/**
	 * Keeps a wheel at the scroll boundary from also reaching the rest of the
	 * embedded panel.
	 *
	 * Scroll chaining into the host page is prevented by `overscroll-contain` on
	 * the conversation, not from here. This used to call `preventDefault` as well,
	 * which never did anything: React attaches `wheel` to its root container as a
	 * passive listener, so the call was ignored and Chrome logged "Unable to
	 * preventDefault inside passive event listener invocation" on every wheel
	 * event at the top or bottom of the conversation — on whatever page the user
	 * had the panel open on.
	 */
	const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
		const element = conversationRef.current;
		if (!element) {
			return;
		}

		const { scrollTop, scrollHeight, clientHeight } = element;
		const isScrollingDown = event.deltaY > 0;
		const isScrollingUp = event.deltaY < 0;
		const atTop = scrollTop === 0;
		const atBottom = scrollTop + clientHeight >= scrollHeight - 1;

		if ((atTop && isScrollingUp) || (atBottom && isScrollingDown)) {
			event.stopPropagation();
		}
	}, []);

	return {
		conversationRef,
		shouldAutoScroll,
		scrollToBottom,
		handleScroll,
		handleWheel,
		setShouldAutoScroll,
	};
};
