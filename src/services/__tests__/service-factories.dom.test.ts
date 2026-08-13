import { describe, expect, it, vi } from "vitest";

vi.mock("../flows-service", () => ({ FlowsService: class {} }));
vi.mock("../flow-builder-service", () => ({ FlowBuilderService: class {} }));

import { ServiceManager } from "../service-manager";

describe("service factories", () => {
	it("creates isolated ServiceManager instances while retaining the singleton", () => {
		const first = ServiceManager.create();
		const second = ServiceManager.create();
		expect(first).not.toBe(second);
		expect(ServiceManager.getInstance()).toBe(ServiceManager.getInstance());
		expect(first.isInitialized()).toBe(false);
		expect(second.isInitialized()).toBe(false);
	});
});
