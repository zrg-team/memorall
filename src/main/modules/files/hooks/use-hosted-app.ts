import { useEffect, useState } from "react";
import {
	type HostedAppId,
	hostedAppForPath,
} from "@/services/memon/apps/hosted/catalog";
import { isHostedAppAvailable } from "@/services/memon/apps/hosted/engines";

/** Answers already known, so a file opened again draws its app at once. */
const known = new Map<HostedAppId, boolean>();

/**
 * Whether this build has the app: true, false, or undefined while asking
 * (a build without the hosted apps keeps the built-in viewers).
 */
export const useHostedAppAvailable = (
	app: HostedAppId | null,
): boolean | undefined => {
	const [available, setAvailable] = useState<boolean | undefined>(() =>
		app ? known.get(app) : false,
	);
	useEffect(() => {
		if (!app) {
			setAvailable(false);
			return;
		}
		if (known.has(app)) {
			setAvailable(known.get(app));
			return;
		}
		setAvailable(undefined);
		let live = true;
		void isHostedAppAvailable(app).then((value) => {
			known.set(app, value);
			if (live) setAvailable(value);
		});
		return () => {
			live = false;
		};
	}, [app]);
	return available;
};

/** The app that opens a file, and whether it is here. */
export const useHostedAppFor = (name: string | null) => {
	const app = name ? hostedAppForPath(name) : null;
	const available = useHostedAppAvailable(app);
	return { app, available };
};
