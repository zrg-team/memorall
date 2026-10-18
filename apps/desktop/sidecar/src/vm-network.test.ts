import { request } from "node:http";
import { describe, expect, it } from "vitest";
import {
	isPublicAddress,
	publicDestination,
	VmEgressProxy,
} from "./vm-network";

describe("VM outbound network boundary", () => {
	it.each([
		"127.0.0.1",
		"10.0.0.1",
		"172.16.1.1",
		"192.168.1.1",
		"169.254.169.254",
		"100.64.0.1",
		"0.0.0.0",
		"::1",
		"fc00::1",
		"fe80::1",
		"::ffff:127.0.0.1",
		"64:ff9b::a00:1",
		"not-an-ip",
		"::192.168.1.1",
		"fec0::1",
		"2002:7f00:1::",
		"2001::1",
		"3fff::1",
	])("denies %s", (address) => expect(isPublicAddress(address)).toBe(false));
	it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])(
		"allows public address %s",
		(address) => expect(isPublicAddress(address)).toBe(true),
	);
	it("refuses private IP literals before opening a socket", async () => {
		await expect(publicDestination("127.0.0.1")).rejects.toThrow(
			"policy blocks",
		);
	});
	it("enforces the boundary on the actual HTTP proxy", async () => {
		const proxy = new VmEgressProxy();
		const port = await proxy.start();
		try {
			const status = await new Promise((resolve, reject) => {
				const req = request(
					{
						host: "127.0.0.1",
						port,
						path: "http://169.254.169.254/latest/meta-data/",
					},
					(response) => {
						response.resume();
						resolve(response.statusCode);
					},
				);
				req.on("error", reject);
				req.end();
			});
			expect(status).toBe(403);
		} finally {
			await proxy.stop();
		}
	});
});
