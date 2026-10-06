import * as almostnode from "almostnode";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// The runtime loads AlmostNode from the extension's bundle; here, the package.
vi.mock(
	"../../../../public/sandbox/runtime/shared.js",
	async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import("../../../../public/sandbox/runtime/shared.js")
			>();
		return { ...actual, loadAlmostNodeLib: async () => almostnode };
	},
);

import {
	requestServerOperation,
	startServerOperation,
} from "../../../../public/sandbox/runtime/server-ops.js";
import {
	runtimeState,
	stopAllServers,
} from "../../../../public/sandbox/runtime/shared.js";

interface TestContainer {
	vfs: {
		mkdirSync(path: string, options?: { recursive?: boolean }): void;
		writeFileSync(path: string, content: string): void;
	};
}

const createContainer = (
	almostnode as unknown as {
		createContainer: (options: { cwd: string }) => TestContainer;
	}
).createContainer;
const state = runtimeState as unknown as { container: unknown };

// almostnode wraps Node's timers the way a browser has them; put them back.
const nodeTimers = {
	setTimeout: globalThis.setTimeout,
	setInterval: globalThis.setInterval,
	clearTimeout: globalThis.clearTimeout,
	clearInterval: globalThis.clearInterval,
};

const ROOT = "/projects/game";
const PORT = 5199;

describe("the built-in Vite server, for a project in a folder", () => {
	afterEach(async () => {
		await stopAllServers();
		state.container = null;
	});

	afterAll(() => {
		Object.assign(globalThis, nodeTimers);
	});

	it("serves the project's plain JavaScript, data and images, not a 404", async () => {
		const container = createContainer({ cwd: "/" });
		state.container = container;
		const { vfs } = container;
		vfs.mkdirSync(`${ROOT}/src/scenes`, { recursive: true });
		vfs.mkdirSync(`${ROOT}/public`, { recursive: true });
		vfs.writeFileSync(
			`${ROOT}/index.html`,
			'<!doctype html><html><body><script type="module" src="/src/main.js"></script></body></html>',
		);
		vfs.writeFileSync(
			`${ROOT}/src/main.js`,
			'import { PlayScene } from "./scenes/PlayScene.js";\nconsole.log(PlayScene);\n',
		);
		vfs.writeFileSync(
			`${ROOT}/src/scenes/PlayScene.js`,
			"export class PlayScene {}\n",
		);
		vfs.writeFileSync(`${ROOT}/src/levels.json`, '{"levels":3}');

		await startServerOperation({ kind: "vite", rootDir: ROOT, port: PORT });
		const get = (path: string) =>
			requestServerOperation({ port: PORT, path }) as Promise<{
				status: number;
				contentType: string;
				body: string;
			}>;

		await expect(get("/src/main.js")).resolves.toMatchObject({
			status: 200,
			contentType: "application/javascript; charset=utf-8",
			body: expect.stringContaining('from "./scenes/PlayScene.js"'),
		});
		await expect(get("/src/scenes/PlayScene.js?v=12")).resolves.toMatchObject({
			status: 200,
			body: "export class PlayScene {}\n",
		});
		await expect(get("/src/levels.json")).resolves.toMatchObject({
			status: 200,
			contentType: "application/json; charset=utf-8",
		});
		await expect(get("/src/missing.js")).resolves.toMatchObject({
			status: 404,
		});
	});
});
