/**
 * Hook for managing modal selector state (PDF pages, Excel sheets, etc.)
 */

import { useState } from "react";

export interface ModalSelectorState {
	showSelector: boolean;
	setShowSelector: (show: boolean) => void;
	openSelector: () => void;
	closeSelector: () => void;
}

export const useModalSelector = (): ModalSelectorState => {
	const [showSelector, setShowSelector] = useState(false);

	const openSelector = () => setShowSelector(true);
	const closeSelector = () => setShowSelector(false);

	return {
		showSelector,
		setShowSelector,
		openSelector,
		closeSelector,
	};
};
