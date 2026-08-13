import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const portFlag = process.argv.indexOf("--port");
const port = Number(portFlag >= 0 ? process.argv[portFlag + 1] : 4173);
const root = resolve(process.cwd(), "publish/web");
const projectPrefix = "/memorall";
const mimeTypes = {
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".data": "application/octet-stream",
	".gz": "application/gzip",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".svg": "image/svg+xml",
	".ttf": "font/ttf",
	".wasm": "application/wasm",
	".webmanifest": "application/manifest+json; charset=utf-8",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
	throw new Error(`Invalid port: ${port}`);
}

const server = createServer((request, response) => {
	if (request.method !== "GET" && request.method !== "HEAD") {
		response.writeHead(405, { Allow: "GET, HEAD" }).end();
		return;
	}

	const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
	if (url.pathname !== projectPrefix && !url.pathname.startsWith(`${projectPrefix}/`)) {
		response.writeHead(404).end("Not found");
		return;
	}

	let relativePath;
	try {
		relativePath = decodeURIComponent(url.pathname.slice(projectPrefix.length));
	} catch {
		response.writeHead(400).end("Invalid URL encoding");
		return;
	}
	const normalized = normalize(relativePath).replace(/^[/\\]+/, "");
	let filePath = resolve(join(root, normalized));
	if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
		response.writeHead(403).end("Forbidden");
		return;
	}
	if (existsSync(filePath) && statSync(filePath).isDirectory()) {
		filePath = join(filePath, "index.html");
	}
	if (!existsSync(filePath) || !statSync(filePath).isFile()) {
		response.writeHead(404).end("Not found");
		return;
	}

	response.writeHead(200, {
		"Cache-Control": "no-store",
		"Content-Type": mimeTypes[extname(filePath)] ?? "application/octet-stream",
	});
	if (request.method === "HEAD") {
		response.end();
		return;
	}
	createReadStream(filePath).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
	console.log(`Memorall static web server ready at http://127.0.0.1:${port}/memorall/studio/`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => server.close(() => process.exit(0)));
}
