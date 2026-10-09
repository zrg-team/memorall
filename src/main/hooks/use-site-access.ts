import { useCallback, useEffect, useState } from "react";
import { platform } from "@/platform/current";
import { ALL_SITES_ORIGINS } from "@/services/web-browser/site-access";

export interface SiteAccess {
	/**
	 * The browser is keeping Memorall off some sites ("On click" or "On
	 * specific sites"). False while unknown and on platforms without the gate.
	 */
	withheld: boolean;
	/**
	 * Ask for every site. Call it straight from a click handler: the browser
	 * only shows its prompt inside a user gesture.
	 */
	requestAllSites: () => Promise<boolean>;
}

/**
 * Site access is the extension's alone: the web app has no content script to
 * withhold, and the desktop drives a browser it owns.
 */
export const siteAccessApplies = (): boolean =>
	platform.environment === "extension" && Boolean(platform.hostAccess);

/**
 * Whether web tools can read pages, kept current as the user changes site
 * access here or from the browser's extension menu.
 */
export const useSiteAccess = (): SiteAccess => {
	const [withheld, setWithheld] = useState(false);

	useEffect(() => {
		const hostAccess = platform.hostAccess;
		if (!hostAccess || !siteAccessApplies()) return;
		let cancelled = false;
		const check = () => {
			void hostAccess.has(ALL_SITES_ORIGINS).then((granted) => {
				if (!cancelled) setWithheld(!granted);
			});
		};
		check();
		const unsubscribe = hostAccess.onChange?.(check);
		return () => {
			cancelled = true;
			unsubscribe?.();
		};
	}, []);

	const requestAllSites = useCallback(async () => {
		const hostAccess = platform.hostAccess;
		if (!hostAccess || !siteAccessApplies()) return true;
		const granted = await hostAccess.request(ALL_SITES_ORIGINS);
		if (granted) setWithheld(false);
		return granted;
	}, []);

	return { withheld, requestAllSites };
};
