import { createInterface } from "node:readline";
import { SIDECAR_PROTOCOL_VERSION, parseSidecarRequest, type SidecarResponse } from "./protocol";

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(response: SidecarResponse): void {
	process.stdout.write(`${JSON.stringify(response)}\n`);
}

lines.on("line", (line) => {
	let id = "unknown";
	try {
		const request = parseSidecarRequest(JSON.parse(line));
		id = request.id;
		if (request.method === "health") {
			send({
				protocolVersion: SIDECAR_PROTOCOL_VERSION,
				id,
				ok: true,
				result: { node: process.version, ready: true },
			});
			return;
		}
		if (request.method === "shutdown") {
			send({ protocolVersion: SIDECAR_PROTOCOL_VERSION, id, ok: true });
			process.exitCode = 0;
			lines.close();
			return;
		}
		throw new Error(`Sidecar method is not implemented yet: ${request.method}`);
	} catch (error) {
		send({
			protocolVersion: SIDECAR_PROTOCOL_VERSION,
			id,
			ok: false,
			error: {
				code: "INVALID_REQUEST",
				message: error instanceof Error ? error.message : String(error),
			},
		});
	}
});
