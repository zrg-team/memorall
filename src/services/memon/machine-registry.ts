import { logWarn } from "@/utils/logger";
import { MEMON_MACHINE_TTL_MS } from "./constants";
import {
	DEFAULT_MEMON_FEATURE_CONFIG,
	type MemonFeatureConfig,
} from "./feature-config";
import { MemonMachine, type MemonPorts } from "./memon-machine";
import { publishMemonChange } from "./memon-events";

/** Trailing-edge throttle for bus messages. */
const PUBLISH_THROTTLE_MS = 120;

interface RegistryState {
	machines: Map<string, MemonMachine>;
	idleTimers: Map<string, ReturnType<typeof setTimeout>>;
	publishTimers: Map<string, ReturnType<typeof setTimeout>>;
}

/**
 * Pinned on globalThis so a re-evaluated module (HMR, a second bundle chunk)
 * finds the same machines instead of orphaning open browser windows.
 */
const REGISTRY_KEY = "__memorallMemonMachines";
const getRegistry = (): RegistryState => {
	const scope = globalThis as unknown as Record<
		string,
		RegistryState | undefined
	>;
	scope[REGISTRY_KEY] ??= {
		machines: new Map(),
		idleTimers: new Map(),
		publishTimers: new Map(),
	};
	return scope[REGISTRY_KEY];
};

const schedulePublish = (machine: MemonMachine): void => {
	const { publishTimers } = getRegistry();
	if (publishTimers.has(machine.key)) return;
	publishTimers.set(
		machine.key,
		setTimeout(() => {
			publishTimers.delete(machine.key);
			publishMemonChange(machine.summary());
		}, PUBLISH_THROTTLE_MS),
	);
};

const scheduleIdleDispose = (machine: MemonMachine): void => {
	const { idleTimers } = getRegistry();
	const existing = idleTimers.get(machine.key);
	if (existing) clearTimeout(existing);
	idleTimers.set(
		machine.key,
		setTimeout(() => {
			// Never pull the computer out from under a user who is using it.
			if (machine.currentDriver === "user") {
				scheduleIdleDispose(machine);
				return;
			}
			void disposeMemonMachine(machine.key);
		}, MEMON_MACHINE_TTL_MS),
	);
};

export const findMemonMachine = (key: string): MemonMachine | undefined =>
	getRegistry().machines.get(key);

export const listMemonMachines = (): MemonMachine[] => [
	...getRegistry().machines.values(),
];

export const getMemonMachine = async (
	key: string,
	options: {
		config?: MemonFeatureConfig;
		ports?: Partial<MemonPorts>;
		/** The agent using the computer, for its Scheduler. */
		agentId?: string;
		/** The agent's home, as its run resolved it; resolved here otherwise. */
		home?: string;
	} = {},
): Promise<MemonMachine> => {
	const registry = getRegistry();
	const existing = registry.machines.get(key);
	if (existing) {
		if (options.config) existing.configure(options.config);
		existing.setAgent(options.agentId, options.home);
		return existing;
	}
	// Loaded on first use: the ports pull in the filesystem, sandbox and
	// browser services, which importing a tool must not start.
	const { createMemonPorts } = await import("./ports");
	const ports = createMemonPorts(options.ports);
	const home =
		options.home ??
		(await ports.homes?.resolve(options.agentId ?? null).catch((error) => {
			logWarn("[MEMON] Could not prepare the agent's home:", error);
			return undefined;
		}));
	const machine = new MemonMachine(
		key,
		ports,
		options.config ?? DEFAULT_MEMON_FEATURE_CONFIG,
	);
	machine.setAgent(options.agentId, home);
	if (!options.agentId && home) machine.setHome(home, false);
	registry.machines.set(key, machine);
	machine.subscribe(() => {
		schedulePublish(machine);
		scheduleIdleDispose(machine);
	});
	await machine.terminal.refreshAvailability();
	await machine
		.prepareDesktop()
		.catch((error) => logWarn("[MEMON] Could not prepare the desktop:", error));
	scheduleIdleDispose(machine);
	schedulePublish(machine);
	return machine;
};

export const disposeMemonMachine = async (key: string): Promise<void> => {
	const registry = getRegistry();
	const machine = registry.machines.get(key);
	if (!machine) return;
	registry.machines.delete(key);
	for (const timers of [registry.idleTimers, registry.publishTimers]) {
		const timer = timers.get(key);
		if (timer) clearTimeout(timer);
		timers.delete(key);
	}
	const summary = machine.summary();
	await machine.dispose();
	publishMemonChange({ ...summary, disposed: true, updatedAt: Date.now() });
};

/** Releases every parked tool call (the user pressed Stop). */
export const cancelMemonWaits = (key?: string): void => {
	for (const machine of listMemonMachines()) {
		if (!key || machine.key === key) machine.cancelWaits();
	}
};
