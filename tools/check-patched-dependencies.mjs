import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jsPDF } from "jspdf";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const remotePdfObjectUrl =
	"https://cdnjs.cloudflare.com/ajax/libs/pdfobject/2.1.1/pdfobject.min.js";
const bareNodeDebugRead = "process.env.NODE_DEBUG";

async function read(relativePath) {
	return readFile(path.join(root, relativePath), "utf8");
}

async function javascriptFiles(directory) {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const absolute = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await javascriptFiles(absolute)));
		else if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs"))
			files.push(absolute);
	}
	return files;
}

function reject(source, needle, label) {
	if (source.includes(needle)) {
		throw new Error(`${label} contains forbidden runtime code: ${needle}`);
	}
}

const utilSource = await read("node_modules/util/util.js");
reject(utilSource, bareNodeDebugRead, "patched util browser entry");
if (!utilSource.includes("var debugEnv = '';")) {
	throw new Error(
		"patched util browser entry is missing the inert debug value",
	);
}

for (const entry of [
	"node_modules/jspdf/dist/jspdf.es.min.js",
	"node_modules/jspdf/dist/jspdf.node.min.js",
]) {
	const source = await read(entry);
	reject(source, remotePdfObjectUrl, entry);
	if (!source.includes("data:text/javascript,window.PDFObject=")) {
		throw new Error(`${entry} is missing the local PDFObject fallback`);
	}
}

const document = new jsPDF();
document.text("Memorall dependency upgrade", 10, 10);
const pdf = Buffer.from(document.output("arraybuffer"));
if (pdf.length < 100 || !pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
	throw new Error("jsPDF smoke did not produce a valid PDF byte stream");
}

const requestedDirectories = process.argv.slice(2);
for (const requestedDirectory of requestedDirectories) {
	const directory = path.resolve(root, requestedDirectory);
	let extensionManifest = null;
	try {
		extensionManifest = JSON.parse(
			await readFile(path.join(directory, "manifest.json"), "utf8"),
		);
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
	}
	if (extensionManifest?.manifest_version === 3) {
		for (const relativePath of [
			"vendors/hyperframes/caption-overrides.json",
			"sandbox/pages/caption-overrides.json",
		]) {
			const overrides = JSON.parse(
				await readFile(path.join(directory, relativePath), "utf8"),
			);
			if (!Array.isArray(overrides)) {
				throw new Error(`${relativePath} must contain a JSON array`);
			}
		}
	}
	for (const file of await javascriptFiles(directory)) {
		const source = await readFile(file, "utf8");
		const label = path.relative(root, file).replaceAll(path.sep, "/");
		reject(source, remotePdfObjectUrl, label);
		reject(source, bareNodeDebugRead, label);
	}
}

console.log(
	`Patched dependency regressions passed: util, jsPDF PDF smoke, and ${requestedDirectories.length} artifact root(s).`,
);
