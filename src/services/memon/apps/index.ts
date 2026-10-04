import type { MemonKitApp } from "../app-kit/types";
import type { MemonWindowApp } from "../constants";
import { connectionsApp } from "./connections-view";
import { schedulerApp } from "./scheduler-view";
import { skillsApp } from "./skills-view";
import { studioApp } from "./studio-view";
import { tasksApp } from "./tasks-view";

/** Computer apps built with the app kit, by window. */
export const MEMON_KIT_APPS = {
	tasks: tasksApp,
	scheduler: schedulerApp,
	studio: studioApp,
	skills: skillsApp,
	connections: connectionsApp,
} satisfies Partial<Record<MemonWindowApp, MemonKitApp>>;

export type MemonKitAppId = keyof typeof MEMON_KIT_APPS;

export const isKitApp = (app: MemonWindowApp): app is MemonKitAppId =>
	app in MEMON_KIT_APPS;

/** The kit app a ref like "s3" belongs to. */
export const kitAppForRef = (
	ref: string,
): [MemonKitAppId, MemonKitApp] | null => {
	for (const [id, app] of Object.entries(MEMON_KIT_APPS) as Array<
		[MemonKitAppId, MemonKitApp]
	>) {
		if (new RegExp(`^${app.refPrefix}\\d+$`).test(ref)) return [id, app];
	}
	return null;
};
