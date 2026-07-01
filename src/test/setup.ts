import "@testing-library/jest-dom/vitest";
import { beforeEach, vi } from "vitest";

type ObserverEntry = Partial<IntersectionObserverEntry> & {
	target: Element;
};

class TestIntersectionObserver implements IntersectionObserver {
	static instances: TestIntersectionObserver[] = [];

	readonly root: Element | Document | null = null;
	readonly rootMargin: string;
	readonly thresholds: ReadonlyArray<number>;
	private readonly callback: IntersectionObserverCallback;
	private readonly observed = new Set<Element>();

	constructor(
		callback: IntersectionObserverCallback,
		options: IntersectionObserverInit = {},
	) {
		this.callback = callback;
		this.root = options.root ?? null;
		this.rootMargin = options.rootMargin ?? "0px";
		this.thresholds = Array.isArray(options.threshold)
			? options.threshold
			: [options.threshold ?? 0];
		TestIntersectionObserver.instances.push(this);
	}

	disconnect = vi.fn(() => {
		this.observed.clear();
	});

	observe = vi.fn((target: Element) => {
		this.observed.add(target);
	});

	takeRecords = vi.fn((): IntersectionObserverEntry[] => []);

	unobserve = vi.fn((target: Element) => {
		this.observed.delete(target);
	});

	trigger(isIntersecting: boolean, target?: Element) {
		const targets = target ? [target] : Array.from(this.observed);
		const entries = targets.map(
			(item) =>
				({
					boundingClientRect: item.getBoundingClientRect(),
					intersectionRatio: isIntersecting ? 1 : 0,
					intersectionRect: item.getBoundingClientRect(),
					isIntersecting,
					rootBounds: null,
					target: item,
					time: performance.now(),
				}) satisfies ObserverEntry,
		);
		this.callback(entries as IntersectionObserverEntry[], this);
	}
}

class TestResizeObserver implements ResizeObserver {
	disconnect = vi.fn();
	observe = vi.fn();
	unobserve = vi.fn();
}

Object.defineProperty(globalThis, "IntersectionObserver", {
	configurable: true,
	writable: true,
	value: TestIntersectionObserver,
});

Object.defineProperty(globalThis, "ResizeObserver", {
	configurable: true,
	writable: true,
	value: TestResizeObserver,
});

Object.defineProperty(window, "matchMedia", {
	configurable: true,
	writable: true,
	value: vi.fn((query: string): MediaQueryList => {
		const listeners = new Set<(event: MediaQueryListEvent) => void>();
		return {
			matches: false,
			media: query,
			onchange: null,
			addEventListener: vi.fn((_type: string, listener: EventListener) => {
				listeners.add(listener as (event: MediaQueryListEvent) => void);
			}),
			removeEventListener: vi.fn((_type: string, listener: EventListener) => {
				listeners.delete(listener as (event: MediaQueryListEvent) => void);
			}),
			addListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => {
				listeners.add(listener);
			}),
			removeListener: vi.fn(
				(listener: (event: MediaQueryListEvent) => void) => {
					listeners.delete(listener);
				},
			),
			dispatchEvent: vi.fn((event: Event) => {
				for (const listener of listeners) {
					listener(event as MediaQueryListEvent);
				}
				return true;
			}),
		};
	}),
});

beforeEach(() => {
	TestIntersectionObserver.instances = [];
});
