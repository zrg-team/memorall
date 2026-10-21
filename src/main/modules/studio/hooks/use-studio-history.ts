import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useStudioStore } from "@/main/stores/studio";
import type { MediaCategory } from "@/services/llm/interfaces/model-category";

/** Load history before consuming an in-page recording's Open thread link. */
export function useStudioHistory(mode: MediaCategory): void {
	const location = useLocation();
	const navigate = useNavigate();
	const loadMode = useStudioStore((store) => store.loadMode);
	const openConversation = useStudioStore((store) => store.openConversation);
	useEffect(() => {
		let cancelled = false;
		void (async () => {
			await loadMode(mode);
			const params = new URLSearchParams(location.search);
			const linkedThread = params.get("transcript");
			if (cancelled || mode !== "speech-to-text" || !linkedThread) return;
			await openConversation(mode, linkedThread);
			if (cancelled) return;
			params.delete("transcript");
			navigate(
				{ pathname: location.pathname, search: params.toString() },
				{ replace: true },
			);
		})();
		return () => {
			cancelled = true;
		};
	}, [
		loadMode,
		mode,
		openConversation,
		navigate,
		location.pathname,
		location.search,
	]);
}
