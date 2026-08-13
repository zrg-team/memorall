import type {
	CapabilityId,
	CapabilityRegistry,
	CapabilityState,
} from "../contracts/core";

const unavailable = (): CapabilityState => ({
	available: false,
	reason: "This capability is not available in the current environment.",
});

export class MutableCapabilityRegistry implements CapabilityRegistry {
	private readonly states = new Map<CapabilityId, CapabilityState>();
	private readonly listeners = new Set<() => void>();

	constructor(initial: Partial<Record<CapabilityId, CapabilityState>> = {}) {
		for (const [id, state] of Object.entries(initial)) {
			this.states.set(id as CapabilityId, { ...state });
		}
	}

	get(id: CapabilityId): CapabilityState {
		return { ...(this.states.get(id) ?? unavailable()) };
	}

	set(id: CapabilityId, state: CapabilityState): void {
		const current = this.states.get(id);
		if (
			current?.available === state.available &&
			current?.reason === state.reason &&
			current?.requiresAction === state.requiresAction
		) {
			return;
		}

		this.states.set(id, { ...state });
		for (const listener of this.listeners) listener();
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
}
