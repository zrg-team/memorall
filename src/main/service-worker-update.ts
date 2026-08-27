import { logError, logInfo } from "@/utils/logger";

/**
 * Tracks the deployed service worker so the UI can tell people when a new
 * version of the Web app is on its way and let them take it.
 *
 * The worker deliberately does not call `skipWaiting()` on install: a build
 * swapped underneath a running session would pair a new shell with chunks the
 * old one already imported. It waits instead, this module reports that as
 * "ready", and the reload only happens when someone asks for it.
 *
 * Surfaces without a service worker (extension, desktop) never register, so the
 * status stays `idle` and the notice never renders.
 */

export type AppUpdateStatus = "idle" | "downloading" | "ready";

const UPDATE_POLL_INTERVAL_MS = 30 * 60 * 1000;
// If `controllerchange` never arrives, reload anyway rather than leaving the
// button looking stuck.
const CONTROLLER_HANDOVER_TIMEOUT_MS = 3000;
const WARM_CACHE_DEBOUNCE_MS = 2000;

let registration: ServiceWorkerRegistration | null = null;
let status: AppUpdateStatus = "idle";
let awaitingReload = false;
const listeners = new Set<() => void>();
const watchedWorkers = new WeakSet<ServiceWorker>();

function setStatus(next: AppUpdateStatus): void {
	if (next === status) return;
	status = next;
	for (const listener of listeners) listener();
}

export function getAppUpdateStatus(): AppUpdateStatus {
	return status;
}

export function subscribeToAppUpdate(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function evaluate(current: ServiceWorkerRegistration): void {
	// Without a controller this is the very first install, not an update.
	if (!navigator.serviceWorker.controller) {
		setStatus("idle");
		return;
	}
	if (current.waiting) {
		setStatus("ready");
		return;
	}
	const pending = current.installing;
	if (!pending) {
		setStatus("idle");
		return;
	}
	setStatus("downloading");
	if (watchedWorkers.has(pending)) return;
	watchedWorkers.add(pending);
	pending.addEventListener("statechange", () => evaluate(current));
}

/**
 * Reports every same-origin resource the page loads to the worker so it can
 * cache them. Without this the first visit would be only partly available
 * offline: the worker starts controlling the page part way through boot, and
 * everything imported before that never reaches its fetch handler.
 */
function startCacheWarming(): void {
	if (typeof PerformanceObserver === "undefined") return;
	const pending = new Set<string>();
	let flushTimer = 0;

	const flush = () => {
		flushTimer = 0;
		if (pending.size === 0) return;
		const controller = navigator.serviceWorker.controller;
		if (!controller) {
			// Not controlling this page yet; keep the list and try again.
			schedule();
			return;
		}
		controller.postMessage({
			type: "MEMORALL_WARM_CACHE",
			urls: [...pending],
		});
		pending.clear();
	};

	const schedule = () => {
		if (flushTimer) return;
		flushTimer = window.setTimeout(flush, WARM_CACHE_DEBOUNCE_MS);
	};

	const collect = (names: string[]) => {
		for (const name of names) {
			if (name.startsWith(`${window.location.origin}/`)) pending.add(name);
		}
		schedule();
	};

	// The default resource-timing buffer is 250 entries; boot loads more than
	// that, and anything dropped before the observer starts is never reported.
	performance.setResourceTimingBufferSize?.(2000);
	collect(performance.getEntriesByType("resource").map((entry) => entry.name));
	new PerformanceObserver((list) => {
		collect(list.getEntries().map((entry) => entry.name));
	}).observe({ type: "resource", buffered: false });
}

export async function registerAppServiceWorker(
	scriptUrl: string,
	scope: string,
): Promise<void> {
	if (!("serviceWorker" in navigator)) return;

	navigator.serviceWorker.addEventListener("controllerchange", () => {
		if (!awaitingReload) return;
		awaitingReload = false;
		window.location.reload();
	});

	try {
		const current = await navigator.serviceWorker.register(scriptUrl, {
			scope,
		});
		registration = current;
		current.addEventListener("updatefound", () => evaluate(current));
		evaluate(current);

		const checkForUpdate = () => {
			void current.update().catch(() => undefined);
		};
		window.setInterval(checkForUpdate, UPDATE_POLL_INTERVAL_MS);
		window.addEventListener("online", checkForUpdate);
		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "visible") checkForUpdate();
		});
		startCacheWarming();
		logInfo("[SW] Registered application shell worker", { scope });
	} catch (error) {
		logError("[SW] Application shell worker registration failed", error);
	}
}

export function applyAppUpdate(): void {
	const waiting = registration?.waiting;
	if (!waiting) {
		window.location.reload();
		return;
	}
	awaitingReload = true;
	waiting.postMessage({ type: "MEMORALL_SKIP_WAITING" });
	window.setTimeout(() => {
		if (!awaitingReload) return;
		awaitingReload = false;
		window.location.reload();
	}, CONTROLLER_HANDOVER_TIMEOUT_MS);
}
