import { resolvePath } from "./command-line";
import {
	BINARY_WARNING,
	CURL_USER_AGENT,
	curlWarning,
	formatWriteOut,
	HELP_ALL_TEXT,
	HELP_TEXT,
	looksBinary,
	progressMeter,
	VERSION_TEXT,
} from "./curl/format";
import {
	type CurlHttpResponse,
	CurlTransferError,
	defaultPort,
} from "./curl/http";
import {
	CURL_TRY_HELP,
	type CurlOptions,
	CurlUsageError,
	expandGlob,
	type OutputSpec,
	parseCurlArgs,
} from "./curl/options";
import type { HostCommand, HostCommandContext } from "./types";

/**
 * `curl`, as curl behaves: its options, its output (-i, -I, -v, -w, -D, the
 * progress meter when writing to a file), its exit codes and messages.
 * Requests to localhost reach the servers running in this computer; others go
 * out through the browser.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** curl's percent-encoding: everything but A-Z a-z 0-9 - . _ ~ */
const curlEscape = (text: string): string =>
	encodeURIComponent(text).replace(
		/[!'()*]/g,
		(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
	);

const concat = (chunks: Uint8Array[]): Uint8Array => {
	const out = new Uint8Array(
		chunks.reduce((sum, chunk) => sum + chunk.length, 0),
	);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
};

const MIME_BY_EXTENSION: Record<string, string> = {
	gif: "image/gif",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	svg: "image/svg+xml",
	txt: "text/plain",
	htm: "text/html",
	html: "text/html",
	pdf: "application/pdf",
	xml: "application/xml",
	json: "application/json",
};

interface Transfer {
	url: string;
	/** Text each glob matched, for #1, #2 in output names. */
	matches: string[];
	output?: OutputSpec;
}

class Output {
	stdout: Uint8Array[] = [];
	stderr = "";
	writeStdout(data: Uint8Array | string) {
		this.stdout.push(typeof data === "string" ? encoder.encode(data) : data);
	}
}

const headerBlock = (response: CurlHttpResponse): string =>
	[
		`HTTP/${response.httpVersion} ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
		...response.headers.map(([name, value]) => `${name}: ${value}`),
		"",
		"",
	].join("\r\n");

const headerValue = (headers: Array<[string, string]>, name: string) =>
	headers.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];

/** "example.com/x" is http://example.com/x, as curl guesses. */
const parseUrl = (raw: string): URL => {
	const text = raw.trim();
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text)
		? text
		: `http://${text}`;
	let url: URL;
	try {
		url = new URL(withScheme);
	} catch {
		throw new CurlTransferError(
			3,
			"URL rejected: Malformed input to a URL function",
		);
	}
	const scheme = url.protocol.slice(0, -1).toLowerCase();
	if (!["http", "https", "file"].includes(scheme)) {
		throw new CurlTransferError(1, `Protocol "${scheme}" not supported`);
	}
	return url;
};

const readLocal = async (
	context: HostCommandContext,
	name: string,
): Promise<Uint8Array | null> => {
	if (name === "-") return context.stdin ?? new Uint8Array(0);
	const path = resolvePath(context.cwd, name);
	try {
		if (!(await context.files.exists(path))) return null;
		return await context.files.read(path);
	} catch {
		return null;
	}
};

/** -d/--data* and --json, joined as curl joins them. */
const buildData = async (
	options: CurlOptions,
	context: HostCommandContext,
	output: Output,
): Promise<{ body: Uint8Array | null; json: boolean }> => {
	if (!options.data.length) return { body: null, json: false };
	const pieces: Uint8Array[] = [];
	const json = options.data.some((part) => part.kind === "json");
	for (const [index, part] of options.data.entries()) {
		let piece: Uint8Array;
		const fromFile = async (name: string, strip: boolean) => {
			const bytes = await readLocal(context, name);
			if (!bytes) {
				output.stderr += curlWarning(
					`Couldn't read data from file "${name}", this makes an empty POST.`,
				);
				return new Uint8Array(0);
			}
			return strip
				? encoder.encode(decoder.decode(bytes).replace(/[\r\n]/g, ""))
				: bytes;
		};
		switch (part.kind) {
			case "raw":
				piece = encoder.encode(part.value);
				break;
			case "ascii":
				piece = part.value.startsWith("@")
					? await fromFile(part.value.slice(1), true)
					: encoder.encode(part.value);
				break;
			case "binary":
			case "json":
				piece = part.value.startsWith("@")
					? await fromFile(part.value.slice(1), false)
					: encoder.encode(part.value);
				break;
			case "urlencode": {
				const value = part.value;
				const at = value.indexOf("@");
				const eq = value.indexOf("=");
				if (eq >= 0 && (at < 0 || eq < at)) {
					const name = value.slice(0, eq);
					const content = curlEscape(value.slice(eq + 1));
					piece = encoder.encode(name ? `${name}=${content}` : content);
				} else if (at >= 0) {
					const name = value.slice(0, at);
					const bytes = await fromFile(value.slice(at + 1), false);
					const content = curlEscape(decoder.decode(bytes));
					piece = encoder.encode(name ? `${name}=${content}` : content);
				} else {
					piece = encoder.encode(curlEscape(value));
				}
				break;
			}
		}
		// JSON parts are concatenated as they are; the rest join with "&".
		if (index > 0 && !(json && part.kind === "json"))
			pieces.push(encoder.encode("&"));
		pieces.push(piece);
	}
	return { body: concat(pieces), json };
};

/** -F / --form-string as multipart/form-data. */
const buildForm = async (
	options: CurlOptions,
	context: HostCommandContext,
): Promise<{ body: Uint8Array; boundary: string }> => {
	const boundary = `------------------------${Array.from(
		crypto.getRandomValues(new Uint8Array(8)),
		(byte) => byte.toString(16).padStart(2, "0"),
	).join("")}`;
	const chunks: Uint8Array[] = [];
	for (const part of options.form) {
		const eq = part.spec.indexOf("=");
		if (eq <= 0) {
			throw new CurlUsageError(
				`Warning: Illegally formatted input field!\ncurl: option -F: is badly used here\n${CURL_TRY_HELP}`,
			);
		}
		const name = part.spec.slice(0, eq);
		let rest = part.spec.slice(eq + 1);
		let type: string | undefined;
		let filename: string | undefined;
		let content: Uint8Array;
		if (!part.literal && (rest.startsWith("@") || rest.startsWith("<"))) {
			const asFile = rest.startsWith("@");
			const params = rest.slice(1).split(";");
			const source = params.shift() as string;
			for (const param of params) {
				const [key, value] = param.split("=") as [string, string?];
				if (key.trim() === "type") type = value?.trim();
				if (key.trim() === "filename")
					filename = value?.trim().replace(/^"|"$/g, "");
			}
			const bytes = await readLocal(context, source);
			if (!bytes) {
				throw new CurlTransferError(
					26,
					`Failed to open/read local data from file/application`,
				);
			}
			content = bytes;
			if (asFile) {
				filename ??= source === "-" ? "-" : (source.split("/").pop() ?? source);
				type ??=
					MIME_BY_EXTENSION[filename.split(".").pop()?.toLowerCase() ?? ""] ??
					"application/octet-stream";
			}
		} else {
			if (!part.literal) {
				const semicolon = rest.indexOf(";type=");
				if (semicolon >= 0) {
					type = rest.slice(semicolon + 6);
					rest = rest.slice(0, semicolon);
				}
			}
			content = encoder.encode(rest);
		}
		chunks.push(
			encoder.encode(
				`--${boundary}\r\nContent-Disposition: form-data; name="${name}"${filename !== undefined ? `; filename="${filename}"` : ""}\r\n${type ? `Content-Type: ${type}\r\n` : ""}\r\n`,
			),
			content,
			encoder.encode("\r\n"),
		);
	}
	chunks.push(encoder.encode(`--${boundary}--\r\n`));
	return { body: concat(chunks), boundary };
};

/** The request headers curl sends, in curl's order, with -H applied. */
const buildHeaders = async (
	options: CurlOptions,
	context: HostCommandContext,
	url: URL,
	extra: Array<[string, string]>,
): Promise<Array<[string, string]>> => {
	const headers: Array<[string, string]> = [
		["Host", url.port ? `${url.hostname}:${url.port}` : url.hostname],
	];
	if (options.range) headers.push(["Range", `bytes=${options.range}`]);
	const user =
		options.user ??
		(url.username
			? `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`
			: undefined);
	if (user !== undefined) {
		const credentials = user.includes(":") ? user : `${user}:`;
		headers.push([
			"Authorization",
			`Basic ${btoa(String.fromCharCode(...encoder.encode(credentials)))}`,
		]);
	}
	headers.push(["User-Agent", options.userAgent ?? CURL_USER_AGENT]);
	headers.push(["Accept", "*/*"]);
	if (options.compressed) {
		headers.push(["Accept-Encoding", "deflate, gzip, br, zstd"]);
	}
	if (options.referer) {
		headers.push(["Referer", options.referer.replace(/;auto$/, "")]);
	}
	const cookies: string[] = [];
	for (const cookie of options.cookies) {
		if (cookie.includes("=")) {
			cookies.push(cookie);
			continue;
		}
		const bytes = await readLocal(context, cookie);
		if (!bytes) continue;
		for (const line of decoder.decode(bytes).split("\n")) {
			if (!line.trim() || line.startsWith("#")) continue;
			const fields = line.split("\t");
			if (fields.length < 7) continue;
			const domain = (fields[0] as string)
				.replace(/^#HttpOnly_/, "")
				.replace(/^\./, "");
			if (url.hostname === domain || url.hostname.endsWith(`.${domain}`)) {
				cookies.push(`${fields[5]}=${fields[6]?.trim() ?? ""}`);
			}
		}
	}
	if (cookies.length) headers.push(["Cookie", cookies.join("; ")]);
	headers.push(...extra);

	const custom: string[] = [];
	for (const header of options.headers) {
		if (header.startsWith("@")) {
			const bytes = await readLocal(context, header.slice(1));
			if (bytes) {
				custom.push(
					...decoder
						.decode(bytes)
						.split(/\r?\n/)
						.filter((line) => line.trim()),
				);
			}
			continue;
		}
		custom.push(header);
	}
	for (const header of custom) {
		const colon = header.indexOf(":");
		const semicolon = header.indexOf(";");
		if (
			semicolon > 0 &&
			(colon < 0 || semicolon < colon) &&
			!header.slice(semicolon + 1).trim()
		) {
			// "Name;" sends the header with an empty value.
			headers.push([header.slice(0, semicolon).trim(), ""]);
			continue;
		}
		if (colon <= 0) continue;
		const name = header.slice(0, colon).trim();
		const value = header.slice(colon + 1).trim();
		const existing = headers.findIndex(
			([key]) => key.toLowerCase() === name.toLowerCase(),
		);
		if (!value) {
			// "Name:" removes a header curl would send.
			if (existing >= 0) headers.splice(existing, 1);
			continue;
		}
		if (existing >= 0) headers[existing] = [name, value];
		else headers.push([name, value]);
	}
	return headers;
};

const remoteName = (url: URL): string => {
	const last = url.pathname.split("/").pop() ?? "";
	return decodeURIComponent(last);
};

const writeCookieJar = async (
	context: HostCommandContext,
	path: string,
	jar: Array<{ host: string; name: string; value: string; path: string }>,
) => {
	const lines = [
		"# Netscape HTTP Cookie File",
		"# https://curl.se/docs/http-cookies.html",
		"# This file was generated by libcurl! Edit at your own risk.",
		"",
		...jar.map(
			(cookie) =>
				`${cookie.host}\tFALSE\t${cookie.path}\tFALSE\t0\t${cookie.name}\t${cookie.value}`,
		),
		"",
	];
	await context.files.write(resolvePath(context.cwd, path), lines.join("\n"));
	context.filesChanged();
};

const transientStatus = (status: number) =>
	[408, 429, 500, 502, 503, 504].includes(status);

export const runCurl: HostCommand = async (argv, context) => {
	const output = new Output();
	let options: CurlOptions;
	try {
		options = parseCurlArgs(argv.slice(1));
	} catch (error) {
		if (error instanceof CurlUsageError) {
			return {
				stdout: "",
				stderr: `${error.message}\n`,
				exitCode: error.exitCode,
			};
		}
		throw error;
	}
	if (options.help !== undefined) {
		return {
			stdout: options.help === "all" ? HELP_ALL_TEXT : HELP_TEXT,
			stderr: "",
			exitCode: 0,
		};
	}
	if (options.version) return { stdout: VERSION_TEXT, stderr: "", exitCode: 0 };
	if (!options.urls.length) {
		return {
			stdout: "",
			stderr: `curl: no URL specified\n${CURL_TRY_HELP}\n`,
			exitCode: 2,
		};
	}
	if (!context.http) {
		return {
			stdout: "",
			stderr: "curl: (7) networking is not available in this sandbox\n",
			exitCode: 7,
		};
	}

	// Each URL (after globbing) is one transfer; the nth -o/-O is the nth URL's.
	const transfers: Transfer[] = [];
	try {
		options.urls.forEach((raw, index) => {
			const output =
				options.outputs[index] ??
				(options.remoteNameAll ? ({ kind: "remote" } as const) : undefined);
			const expanded = options.globoff
				? [{ url: raw, matches: [] }]
				: expandGlob(raw);
			for (const item of expanded) transfers.push({ ...item, output });
		});
	} catch (error) {
		if (error instanceof CurlUsageError) {
			return {
				stdout: "",
				stderr: `${error.message}\n`,
				exitCode: error.exitCode,
			};
		}
		throw error;
	}

	const showErrors = !options.silent || options.showError;
	const toTerminal = !context.stdoutRedirected;
	let exitCode = 0;
	const jar: Array<{
		host: string;
		name: string;
		value: string;
		path: string;
	}> = [];
	const dumpHeaders: string[] = [];

	const fail = (code: number, message: string, note?: string) => {
		exitCode = code;
		if (showErrors) {
			output.stderr += `curl: (${code}) ${message}\n`;
			if (note) output.stderr += `${note}\n`;
		}
	};

	for (const transfer of transfers) {
		const startedAt = Date.now();
		let url: URL;
		try {
			url = parseUrl(transfer.url);
		} catch (error) {
			if (error instanceof CurlTransferError) {
				fail(error.code, error.message);
				if (options.failEarly) break;
				continue;
			}
			throw error;
		}

		// Where the body goes; /dev/null drops it, /dev/stdout is the terminal.
		let outputPath: string | null = null;
		const discard =
			transfer.output?.kind === "file" && transfer.output.path === "/dev/null";
		if (
			transfer.output?.kind === "file" &&
			!discard &&
			transfer.output.path !== "-" &&
			transfer.output.path !== "/dev/stdout"
		) {
			outputPath = transfer.output.path.replace(
				/#(\d)/g,
				(match, digit: string) => transfer.matches[Number(digit) - 1] ?? match,
			);
		} else if (transfer.output?.kind === "remote") {
			const name = remoteName(url);
			if (!name) {
				exitCode = 23;
				if (showErrors)
					output.stderr += "curl: Remote file name has no length!\n";
				output.stderr += `${CURL_TRY_HELP}\n`;
				continue;
			}
			outputPath = name;
		}
		if (outputPath && options.outputDir) {
			outputPath = `${options.outputDir.replace(/\/$/, "")}/${outputPath}`;
		}

		// file:// reads this computer's files.
		if (url.protocol === "file:") {
			const bytes = await readLocal(context, decodeURIComponent(url.pathname));
			if (!bytes) {
				fail(37, `Couldn't open file ${decodeURIComponent(url.pathname)}`);
				continue;
			}
			if (outputPath) {
				await context.files.write(resolvePath(context.cwd, outputPath), bytes);
				context.filesChanged();
			} else {
				output.writeStdout(bytes);
			}
			continue;
		}

		// The request.
		let method = options.head ? "HEAD" : "GET";
		let body: Uint8Array | undefined;
		const extra: Array<[string, string]> = [];
		try {
			const data = await buildData(options, context, output);
			if (options.urlQuery.length) {
				url.search += `${url.search ? "&" : "?"}${options.urlQuery
					.map((part) => {
						const eq = part.indexOf("=");
						return eq >= 0
							? `${part.slice(0, eq)}=${curlEscape(part.slice(eq + 1))}`
							: curlEscape(part);
					})
					.join("&")}`.replace(/^\?/, "");
			}
			if (data.body && options.get) {
				url.search += `${url.search ? "&" : ""}${decoder.decode(data.body)}`;
			} else if (data.body) {
				method = options.head ? "HEAD" : "POST";
				body = data.body;
				extra.push(["Content-Length", String(body.length)]);
				extra.push([
					"Content-Type",
					data.json ? "application/json" : "application/x-www-form-urlencoded",
				]);
				if (data.json) extra.push(["Accept", "application/json"]);
			} else if (options.form.length) {
				const form = await buildForm(options, context);
				method = "POST";
				body = form.body;
				extra.push(["Content-Length", String(body.length)]);
				extra.push([
					"Content-Type",
					`multipart/form-data; boundary=${form.boundary}`,
				]);
			} else if (options.uploadFile) {
				const bytes = await readLocal(context, options.uploadFile);
				if (!bytes) {
					output.stderr += `curl: Can't open '${options.uploadFile}'!\n${CURL_TRY_HELP}\n`;
					fail(26, "Failed to open/read local data from file/application");
					continue;
				}
				method = "PUT";
				body = bytes;
				if (url.pathname.endsWith("/") && options.uploadFile !== "-") {
					url.pathname += options.uploadFile.split("/").pop();
				}
				extra.push(["Content-Length", String(body.length)]);
			}
		} catch (error) {
			if (error instanceof CurlTransferError) {
				fail(error.code, error.message);
				continue;
			}
			if (error instanceof CurlUsageError) {
				return {
					stdout: "",
					stderr: `${output.stderr}${error.message}\n`,
					exitCode: error.exitCode,
				};
			}
			throw error;
		}
		if (options.method) method = options.method;

		const timeoutMs =
			options.maxTime !== undefined
				? Math.max(1, Math.round(options.maxTime * 1000))
				: options.connectTimeout !== undefined
					? Math.max(1, Math.round(options.connectTimeout * 1000))
					: context.timeoutMs;

		// The exchange, following redirects as curl does with -L.
		let current = url;
		let currentMethod = method;
		let currentBody = body;
		let redirects = 0;
		let response: CurlHttpResponse | null = null;
		let headerBytes = 0;
		let lastHeaders: Array<[string, string]> = [];
		let failure: CurlTransferError | null = null;
		const verboseRequest = (headers: Array<[string, string]>, target: URL) => {
			if (!options.verbose) return;
			const port = defaultPort(target);
			output.stderr += `* Host ${target.hostname}:${port} was resolved.\n*   Trying ${target.hostname}:${port}...\n* Connected to ${target.hostname} port ${port}\n`;
			output.stderr += `> ${currentMethod} ${target.pathname || "/"}${target.search} HTTP/1.1\n`;
			for (const [name, value] of headers)
				output.stderr += `> ${name}: ${value}\n`;
			output.stderr += ">\n";
		};

		for (;;) {
			const headers = await buildHeaders(
				options,
				context,
				current,
				currentBody
					? extra
					: extra.filter(([name]) => !/^content-/i.test(name)),
			);
			verboseRequest(headers, current);
			let attempt = 0;
			for (;;) {
				try {
					response = await context.http.request({
						url: current,
						method: currentMethod,
						headers,
						body: currentBody,
						follow: options.location,
						timeoutMs,
					});
					failure = null;
				} catch (error) {
					if (!(error instanceof CurlTransferError)) throw error;
					failure = error;
					response = null;
				}
				const retryable = failure
					? failure.code === 28 || failure.code === 7
					: response !== null && transientStatus(response.status);
				if (!retryable || attempt >= options.retry) break;
				attempt += 1;
				const delay = options.retryDelay ?? 2 ** (attempt - 1);
				output.stderr += curlWarning(
					`Problem : ${failure ? (failure.code === 28 ? "timeout" : "connection refused") : "HTTP error"}. Will retry in ${delay} seconds. ${options.retry - attempt + 1} retries left.`,
				);
				await new Promise((resolve) => setTimeout(resolve, delay * 1000));
			}
			if (!response) break;

			const block = headerBlock(response);
			headerBytes += encoder.encode(block).length;
			lastHeaders = response.headers;
			if (options.verbose) {
				output.stderr += `< ${block.trimEnd().split("\r\n").join("\n< ")}\n<\n`;
			}
			if (options.include || options.head) output.writeStdout(block);
			if (options.dumpHeader) dumpHeaders.push(block);
			for (const [name, value] of response.headers) {
				if (name.toLowerCase() !== "set-cookie") continue;
				const [pair = "", ...attributes] = value.split(";");
				const eq = pair.indexOf("=");
				if (eq <= 0) continue;
				const pathAttribute = attributes
					.map((attribute) => attribute.trim())
					.find((attribute) => attribute.toLowerCase().startsWith("path="));
				jar.push({
					host: current.hostname,
					name: pair.slice(0, eq).trim(),
					value: pair.slice(eq + 1).trim(),
					path: pathAttribute?.slice(5) || "/",
				});
			}

			redirects += response.followed;
			const location = headerValue(response.headers, "location");
			if (
				options.location &&
				location &&
				response.status >= 300 &&
				response.status < 400
			) {
				if (redirects >= options.maxRedirs) {
					failure = new CurlTransferError(
						47,
						`Maximum (${options.maxRedirs}) redirects followed`,
					);
					break;
				}
				redirects += 1;
				const next = new URL(location, current);
				if (options.verbose) {
					output.stderr += `* Connection #0 to host ${current.hostname} left intact\n* Issue another request to this URL: '${next.href}'\n`;
				}
				// 303, and 301/302 after a POST, become GET without a body.
				if (
					response.status === 303 ||
					((response.status === 301 || response.status === 302) &&
						currentMethod === "POST")
				) {
					if (currentMethod !== "HEAD")
						currentMethod =
							options.method && response.status !== 303
								? options.method
								: "GET";
					currentBody = undefined;
				}
				current = next;
				continue;
			}
			break;
		}

		const elapsedMs = Date.now() - startedAt;
		if (failure) {
			fail(failure.code, failure.message, failure.note);
			if (options.verbose) output.stderr += "* Closing connection\n";
			if (options.writeOut) {
				const written = formatWriteOut(options.writeOut, {
					httpCode: response?.status ?? 0,
					httpVersion: response?.httpVersion ?? "0",
					method: currentMethod,
					urlEffective: current.href,
					url: url.href,
					contentType: "",
					sizeDownload: 0,
					sizeHeader: headerBytes,
					sizeRequest: 0,
					sizeUpload: currentBody?.length ?? 0,
					timeTotal: elapsedMs / 1000,
					numRedirects: redirects,
					redirectUrl: "",
					remoteIp: "",
					remotePort: defaultPort(current),
					exitCode: failure.code,
					errorMessage: failure.message,
					filenameEffective: outputPath ?? "",
					headers: [],
					scheme: current.protocol.slice(0, -1),
				});
				output.writeStdout(written.stdout);
				output.stderr += written.stderr;
			}
			if (options.failEarly) break;
			continue;
		}
		if (!response) continue;

		if (options.verbose) {
			output.stderr += `* Connection #0 to host ${current.hostname} left intact\n`;
		}

		const httpError = response.status >= 400;
		let transferExit = 0;
		if (httpError && (options.fail || options.failWithBody)) {
			transferExit = 22;
		}
		const writeBody =
			!options.head && (transferExit === 0 || options.failWithBody);
		let downloaded = 0;
		if (writeBody) {
			downloaded = response.body.length;
			if (discard) {
				// Read and dropped, as with curl -o /dev/null.
			} else if (outputPath) {
				const path = resolvePath(context.cwd, outputPath);
				const parent = path.replace(/\/[^/]+$/, "") || "/";
				if (!options.createDirs && !(await context.files.isDirectory(parent))) {
					if (showErrors) {
						output.stderr += curlWarning(
							`Failed to open the file ${outputPath}: No such file or directory`,
						);
					}
					fail(
						23,
						`Failure writing output to destination, passed ${response.body.length} returned 0`,
					);
					if (options.failEarly) break;
					continue;
				}
				await context.files.write(path, response.body);
				context.filesChanged();
			} else if (
				toTerminal &&
				transfer.output?.kind !== "file" &&
				looksBinary(response.body)
			) {
				output.stderr += BINARY_WARNING;
				exitCode = 23;
				continue;
			} else {
				output.writeStdout(response.body);
			}
		}

		// The meter goes to stderr whenever the body is not on a terminal.
		if (
			!options.silent &&
			!options.noProgressMeter &&
			(outputPath !== null || discard || !toTerminal)
		) {
			output.stderr += progressMeter(downloaded, body?.length ?? 0, elapsedMs);
		}

		if (transferExit === 22) {
			fail(22, `The requested URL returned error: ${response.status}`);
		}

		if (options.writeOut) {
			const location = headerValue(response.headers, "location");
			const written = formatWriteOut(options.writeOut, {
				httpCode: response.status,
				httpVersion: response.httpVersion,
				method: currentMethod,
				urlEffective: response.url || current.href,
				url: url.href,
				contentType: headerValue(response.headers, "content-type") ?? "",
				sizeDownload: downloaded,
				sizeHeader: headerBytes,
				sizeRequest: 0,
				sizeUpload: body?.length ?? 0,
				timeTotal: elapsedMs / 1000,
				numRedirects: redirects,
				redirectUrl:
					!options.location && location ? new URL(location, current).href : "",
				remoteIp: response.remoteIp ?? "",
				remotePort: response.remotePort,
				exitCode: transferExit,
				errorMessage:
					transferExit === 22
						? `The requested URL returned error: ${response.status}`
						: "",
				filenameEffective: outputPath ?? "",
				headers: lastHeaders,
				scheme: current.protocol.slice(0, -1),
			});
			output.writeStdout(written.stdout);
			output.stderr += written.stderr;
		}
		if (transferExit && options.failEarly) break;
	}

	if (options.dumpHeader && options.dumpHeader !== "/dev/null") {
		const text = dumpHeaders.join("");
		if (options.dumpHeader === "-" || options.dumpHeader === "/dev/stdout") {
			output.stdout.unshift(encoder.encode(text));
		} else {
			await context.files.write(
				resolvePath(context.cwd, options.dumpHeader),
				text,
			);
			context.filesChanged();
		}
	}
	if (options.cookieJar && options.cookieJar !== "/dev/null") {
		await writeCookieJar(context, options.cookieJar, jar);
	}

	const stdoutBytes = concat(output.stdout);
	let stderr = output.stderr;
	if (options.stderrFile === "/dev/null") {
		stderr = "";
	} else if (
		options.stderrFile &&
		options.stderrFile !== "-" &&
		options.stderrFile !== "/dev/stderr"
	) {
		await context.files.write(
			resolvePath(context.cwd, options.stderrFile),
			stderr,
		);
		context.filesChanged();
		stderr = "";
	}
	return {
		stdout: decoder.decode(stdoutBytes),
		stdoutBytes,
		stderr,
		exitCode,
	};
};
