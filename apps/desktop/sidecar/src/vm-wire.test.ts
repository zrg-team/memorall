import { Duplex } from "node:stream";
import { describe, expect, it } from "vitest";
import { VmRpc } from "./vm-wire";

class Wire extends Duplex {
	frames: any[] = [];
	_read() {}
	_write(chunk: Buffer, _encoding: string, done: () => void) {
		this.frames.push(JSON.parse(chunk.toString()));
		done();
	}
	reply(value: unknown) {
		this.push(JSON.stringify(value) + "\n");
	}
}
describe("VM RPC", () => {
	it("allows the provisioning restart before declaring the guest ready", async () => {
		const stream = new Wire();
		const rpc = new VmRpc(stream, true);
		stream.reply({ event: { kind: "runtime.ready", instanceId: "early" } });
		const early = rpc.request("health");
		stream.reply({
			event: { kind: "runtime.ready", instanceId: "provisioned" },
		});
		await expect(early).rejects.toThrow("service restarted");
		const ready = rpc.request("health");
		stream.reply({ id: 2, ok: true, result: { provisioned: true } });
		await expect(ready).resolves.toEqual({ provisioned: true });
		rpc.completeBootstrap();
		rpc.close();
	});
	it("fails pending work promptly when the guest service restarts on the same virtio stream", async () => {
		const stream = new Wire();
		const rpc = new VmRpc(stream);
		stream.reply({ event: { kind: "runtime.ready", instanceId: "first" } });
		const work = rpc.request("runtime.executeCommand");
		stream.reply({
			event: { kind: "runtime.ready", instanceId: "replacement" },
		});
		await expect(work).rejects.toThrow("service restarted");
		rpc.close();
	});
	it("correlates concurrent replies and handles split frames", async () => {
		const stream = new Wire();
		const rpc = new VmRpc(stream);
		const first = rpc.request("first");
		const second = rpc.request("second");
		stream.push('{"id":2,"ok":true,"result":"sec');
		stream.push('ond"}\n');
		stream.reply({ id: 1, ok: true, result: { value: "λ" } });
		await expect(second).resolves.toBe("second");
		await expect(first).resolves.toEqual({ value: "λ" });
		rpc.close();
	});
	it("cancels the guest operation when the caller aborts", async () => {
		const stream = new Wire();
		const rpc = new VmRpc(stream);
		const abort = new AbortController();
		const pending = rpc.request("runtime.executeCode", {}, 10000, abort.signal);
		abort.abort();
		await expect(pending).rejects.toThrow("cancelled");
		expect(stream.frames[1]).toMatchObject({
			operation: "runtime.cancel",
			payload: { requestId: 1 },
		});
		stream.reply({ id: 2, ok: true, result: {} });
		rpc.close();
	});
	it("rejects pending work on disconnect", async () => {
		const stream = new Wire();
		const rpc = new VmRpc(stream);
		const pending = rpc.request("health");
		rpc.close();
		await expect(pending).rejects.toThrow("stopped");
		await expect(rpc.request("health")).rejects.toThrow("stopped");
	});
});
