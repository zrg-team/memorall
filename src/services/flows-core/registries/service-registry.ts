export interface ServiceRegistration {
	id: string;
	name?: string;
	factory?: unknown;
	config?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}

export interface RegisteredService {
	id: string;
	name: string;
	config: Record<string, unknown>;
	metadata: Record<string, unknown>;
}

export type ServiceRegistryPredicate = (entry: RegisteredService) => boolean;

export class ServiceRegistryManager {
	private readonly entries = new Map<string, RegisteredService>();
	private readonly instances = new Map<string, unknown>();
	private finalized = false;

	private assertMutable(action: string): void {
		if (this.finalized) {
			throw new Error(`[ServiceRegistry] Cannot ${action} after finalization`);
		}
	}

	finalize(): this {
		this.finalized = true;
		return this;
	}

	isFinalized(): boolean {
		return this.finalized;
	}

	// ---------------------------------------------------------------------------
	// Schema registration (metadata / discovery)
	// ---------------------------------------------------------------------------

	registerSchema(id: string, options?: Omit<ServiceRegistration, "id">): void {
		this.assertMutable("register schema");
		this.entries.set(id, {
			id,
			name: options?.name ?? id,
			config: options?.config ?? {},
			metadata: options?.metadata ?? {},
		});
	}

	setEntry(entry: RegisteredService): void {
		this.assertMutable("set entry");
		this.entries.set(entry.id, {
			...entry,
			config: { ...entry.config },
			metadata: { ...entry.metadata },
		});
	}

	// ---------------------------------------------------------------------------
	// Instance registration (actual runtime services)
	// ---------------------------------------------------------------------------

	registerInstance<K extends keyof ServiceRegistry>(
		id: K,
		instance: ServiceRegistry[K],
	): void {
		this.assertMutable("register instance");
		this.instances.set(id as string, instance);
	}

	resolve<K extends keyof ServiceRegistry>(
		id: K,
	): ServiceRegistry[K] | undefined {
		return this.instances.get(id as string) as ServiceRegistry[K] | undefined;
	}

	/** Returns all registered instances as a partial AllServices bag. */
	resolveAll(): Partial<ServiceRegistry> {
		return Object.fromEntries(
			this.instances.entries(),
		) as Partial<ServiceRegistry>;
	}

	hasInstance(id: string): boolean {
		return this.instances.has(id);
	}

	setInstance(id: string, instance: unknown): void {
		this.assertMutable("set instance");
		this.instances.set(id, instance);
	}

	// ---------------------------------------------------------------------------
	// Metadata access
	// ---------------------------------------------------------------------------

	get(id: string): RegisteredService | undefined {
		return this.entries.get(id);
	}

	getAll(): RegisteredService[] {
		return Array.from(this.entries.values());
	}

	has(id: string): boolean {
		return this.entries.has(id);
	}

	clear(): void {
		this.assertMutable("clear registry");
		this.entries.clear();
		this.instances.clear();
	}

	fork(predicate?: ServiceRegistryPredicate): ServiceRegistryManager {
		const next = new ServiceRegistryManager();
		const keptIds = new Set<string>();

		for (const entry of this.getAll()) {
			if (!predicate || predicate(entry)) {
				next.setEntry(entry);
				keptIds.add(entry.id);
			}
		}

		for (const [id, instance] of this.instances) {
			if (keptIds.has(id) || (!predicate && !this.entries.has(id))) {
				next.setInstance(id, instance);
			}
		}

		return next;
	}
}

export const serviceRegistry = new ServiceRegistryManager();
