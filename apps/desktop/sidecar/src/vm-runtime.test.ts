import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	DesktopVmRuntime,
	qemuArguments,
	safeResource,
	type VmManifest,
} from "./vm-runtime";
import { createSeedIso, seedFiles } from "./vm-seed";

const manifest: VmManifest = {
	schemaVersion: 1,
	architecture: "x64",
	image: "base.qcow2",
	imageSha256: "a".repeat(64),
	qemu: "qemu/bin/qemu",
	qemuImg: "qemu/bin/qemu-img",
};
describe("desktop VM confinement and bootstrap", () => {
	it("does not boot a stopped VM for process and server background polls", async () => {
		const vm = new DesktopVmRuntime(
			resolve("missing-test-runtime"),
			resolve("unused-test-vm"),
		);
		for (const operation of [
			"runtime.listenCommand",
			"runtime.sendCommandInput",
			"runtime.stopCommand",
			"runtime.listCommands",
			"server.list",
			"sync.collect",
		])
			await expect(vm.request(operation, {})).rejects.toThrow(
				"Sandbox is stopped or starting",
			);
		expect(vm.status().state).toBe("stopped");
	});
	it.each([
		["win32", "whpx"],
		["darwin", "hvf"],
		["linux", "kvm"],
	] as const)(
		"requires hardware virtualization on %s",
		(platform, accelerator) => {
			const args = qemuArguments({
				manifest,
				platform,
				runtime: resolve("bundle"),
				disk: resolve("disk.qcow2"),
				seed: resolve("seed.iso"),
				controlPort: 31000,
			});
			expect(args.join(" ")).toContain(`accel=${accelerator}`);
			expect(args.join(" ")).not.toMatch(
				/tcg|hostfwd|virtfs|\/dev\/|physicaldrive/i,
			);
			expect(args.join(" ")).toContain("-nic none");
			expect(args.join(" ")).not.toMatch(/guestfwd|netdev|virtio-net/);
		},
	);
	it("rejects resource traversal and absolute host paths", () => {
		for (const input of [
			"../secret",
			"/etc/passwd",
			"qemu/../../secret",
			"qemu\\..\\secret",
		])
			expect(() => safeResource(resolve("bundle"), input)).toThrow();
		expect(safeResource(resolve("bundle"), "qemu/bin/qemu")).toBe(
			resolve("bundle/qemu/bin/qemu"),
		);
	});
	it("creates a self-contained NoCloud seed with exact source bytes", () => {
		const source = "print('λ boot')\n";
		const files = seedFiles(source, "test-instance");
		const iso = createSeedIso(files);
		expect(iso.toString("ascii", 16 * 2048 + 1, 16 * 2048 + 6)).toBe("CD001");
		expect(iso.toString("ascii", 16 * 2048 + 40, 16 * 2048 + 46)).toBe(
			"cidata",
		);
		expect(files["user-data"]).toContain(
			Buffer.from(source).toString("base64"),
		);
		expect(files["user-data"]).toContain("--no-block");
		// Wait until provisioning ends, but never synchronously wait for this
		// unit from cloud-final itself: that would create a startup deadlock.
		expect(files["user-data"]).toContain("After=cloud-final.service");
		// cloud-final is after multi-user: enabling the guest on multi-user
		// creates an ordering cycle on the next boot and drops its start job.
		expect(files["user-data"]).toContain("WantedBy=cloud-init.target");
		expect(files["user-data"]).not.toContain("WantedBy=multi-user.target");
		// Parse the ISO's root records as a reader would, rather than comparing
		// an implementation snapshot. No seed file may be truncated or overlap.
		let position = 21 * 2048;
		const actual = new Map<string, string>();
		while (iso[position]) {
			const record = iso.subarray(position, position + iso[position]!);
			const name = record.subarray(33, 33 + record[32]!).toString();
			if (record[25] === 0)
				actual.set(
					name.toLowerCase(),
					iso
						.subarray(
							record.readUInt32LE(2) * 2048,
							record.readUInt32LE(2) * 2048 + record.readUInt32LE(10),
						)
						.toString(),
				);
			position += record.length;
		}
		expect(Object.fromEntries(actual)).toEqual(files);
	});
});
