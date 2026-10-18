import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("waits for PTY output before completion and can stop descendants after their shell exits", () => {
	// Execute the guest functions without importing its Linux-only service or
	// launching host processes. A child exit before PTY EOF is deterministic here.
	const script = String.raw`
import ast, pathlib, signal, sys, threading, time
tree = ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in {"command_result", "stop"}]
scope = {"time": time, "signal": signal}
exec(compile(ast.Module(body=functions, type_ignores=[]), "guest-functions", "exec"), scope)
class Child:
    pid = 123
    def poll(self): return 0
record = {"id": "command", "child": Child(), "condition": threading.Condition(), "finished": False,
          "chunks": [{"stdout": "Bot.md", "stderr": ""}], "next": 1, "base": 0,
          "command": "ls", "cwd": "/", "started": 0}
first = scope["command_result"](record)
assert first["status"] == "running" and first["exitCode"] is None and not first["completed"], first
record["chunks"].append({"stdout": " Memory.md\n", "stderr": ""})
record.update(next=2, finished=True)
last = scope["command_result"](record, 1)
assert last["status"] == "completed" and last["exitCode"] == 0 and last["stdout"] == " Memory.md\n", last
record["finished"] = False
killed = []
class Os:
    @staticmethod
    def killpg(pid, sig):
        killed.append((pid, sig))
        record["finished"] = True
scope["os"] = Os
scope["stop"](record)
assert killed == [(123, signal.SIGTERM)], killed
`;
	const result = spawnSync(
		process.platform === "win32" ? "python" : "python3",
		[
			"-c",
			script,
			fileURLToPath(new URL("../guest/guest.py", import.meta.url)),
		],
		{ encoding: "utf8", timeout: 10000, windowsHide: true },
	);
	expect(result.error, result.stderr).toBeUndefined();
	expect(result.status, result.stderr).toBe(0);
});
