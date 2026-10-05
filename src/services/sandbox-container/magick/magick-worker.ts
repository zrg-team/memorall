import { runMagickCli } from "./magick-cli";
import { initializeMagick } from "./magick-run";

/**
 * The `magick` worker, bundled by tools/copy-bundled-assets.mjs into
 * public/sandbox/vendors/magick/magick-worker.js. The sandbox page starts it
 * with the URLs of ImageMagick's wasm and the fonts set first, then sends one
 * run at a time: the command line and the files it names; it answers with
 * what the run printed and the files it wrote.
 */

interface MagickAssets {
	wasmUrl: string;
	/** Font name → URL. */
	fonts: Record<string, string>;
}

interface MagickWorkerRequest {
	id: number;
	argv: string[];
	cwd: string;
	files: Array<{ path: string; data: Uint8Array }>;
	stdin?: Uint8Array;
}

const scope = self as unknown as {
	MEMORALL_MAGICK_ASSETS?: MagickAssets;
	onmessage: ((event: MessageEvent<MagickWorkerRequest>) => void) | null;
	postMessage(message: unknown, transfer?: Transferable[]): void;
};

const fetchBytes = async (url: string): Promise<Uint8Array> => {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`could not load ${url}`);
	return new Uint8Array(await response.arrayBuffer());
};

let ready: Promise<void> | null = null;

const load = (): Promise<void> => {
	ready ??= (async () => {
		const assets = scope.MEMORALL_MAGICK_ASSETS;
		if (!assets) throw new Error("the worker was started without its assets");
		const names = Object.keys(assets.fonts);
		const [wasm, ...fonts] = await Promise.all([
			fetchBytes(assets.wasmUrl),
			...names.map((name) => fetchBytes(assets.fonts[name] as string)),
		]);
		await initializeMagick(
			wasm as Uint8Array,
			Object.fromEntries(names.map((name, index) => [name, fonts[index]])),
		);
	})().catch((error) => {
		ready = null;
		throw error;
	});
	return ready;
};

scope.onmessage = async (event) => {
	const { id, argv, cwd, files, stdin } = event.data;
	try {
		await load();
		const result = runMagickCli({
			argv,
			cwd,
			files: new Map(files.map((file) => [file.path, file.data])),
			stdin,
		});
		const changed = [...result.written].map(([path, data]) => ({ path, data }));
		const transfer = new Set<Transferable>([
			result.stdout.buffer as ArrayBuffer,
			...changed.map((file) => file.data.buffer as ArrayBuffer),
		]);
		scope.postMessage(
			{
				id,
				exitCode: result.exitCode,
				stdout: result.stdout,
				stderr: result.stderr,
				changed,
			},
			[...transfer],
		);
	} catch (error) {
		scope.postMessage({
			id,
			exitCode: 1,
			stdout: new Uint8Array(),
			stderr: `${argv[0] ?? "magick"}: ${error instanceof Error ? error.message : String(error)}\n`,
			changed: [],
		});
	}
};
