import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
await build({
	absWorkingDir: root,
	entryPoints: ["tools/usage-storage-recovery-console.ts"],
	outfile: "artifacts/qa/usage-storage-recovery.js",
	bundle: true,
	format: "iife",
	platform: "browser",
	target: "chrome120",
	banner: {
		js: "// Memorall usage storage recovery. Connecting does not change stored data.",
	},
});
console.info(
	"Built artifacts/qa/usage-storage-recovery.js. See docs/usage-storage-recovery.md.",
);
