import { describe, expect, it, vi } from "vitest";
import { runCurl } from "../curl-command";
import {
	type CurlHttpRequest,
	type CurlHttpResponse,
	CurlTransferError,
} from "../curl/http";
import { expandGlob, parseCurlArgs } from "../curl/options";
import type { HostCommandContext } from "../types";

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array | string | undefined) =>
	typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes);

type Route = (request: CurlHttpRequest) => Partial<CurlHttpResponse> | Error;

const response = (
	request: CurlHttpRequest,
	partial: Partial<CurlHttpResponse>,
): CurlHttpResponse => ({
	status: 200,
	statusText: "OK",
	httpVersion: "1.1",
	headers: [["Content-Type", "text/plain"]],
	body: encode(""),
	url: request.url.href,
	followed: 0,
	remoteIp: "127.0.0.1",
	remotePort: Number(request.url.port) || 80,
	...partial,
});

const createContext = (
	route: Route,
	existing: Record<string, string | Uint8Array> = {},
	extra: Partial<HostCommandContext> = {},
) => {
	const files = new Map<string, Uint8Array | string>(Object.entries(existing));
	const requests: CurlHttpRequest[] = [];
	const context: HostCommandContext = {
		cwd: "/work",
		env: {},
		files: {
			isDirectory: async (path) =>
				path === "/" ||
				path === "/work" ||
				[...files.keys()].some((file) => file.startsWith(`${path}/`)),
			exists: async (path) => files.has(path),
			walk: async () => ({ files: [], truncated: false }),
			read: async (path) => {
				const data = files.get(path);
				return typeof data === "string"
					? encode(data)
					: (data ?? new Uint8Array());
			},
			write: async (path, data) => {
				files.set(path, data);
			},
			append: async (path, data) => {
				files.set(path, decode(files.get(path)) + data);
			},
			remove: async (path) => {
				files.delete(path);
			},
		},
		runPython: vi.fn(),
		filesChanged: vi.fn(),
		http: {
			request: async (request) => {
				requests.push(request);
				const result = route(request);
				if (result instanceof Error) throw result;
				return response(request, result);
			},
		},
		...extra,
	};
	return { context, files, requests };
};

const curl = (line: string[], ...rest: Parameters<typeof createContext>) => {
	const setup = createContext(...rest);
	return runCurl(["curl", ...line], setup.context).then((result) => ({
		...result,
		...setup,
	}));
};

describe("curl options", () => {
	it("parses combined short options, attached values and -- like curl", () => {
		const options = parseCurlArgs([
			"-sSLXPOST",
			"-HX-A: 1",
			"-o",
			"out.json",
			"--max-time",
			"2.5",
			"--no-location",
			"--",
			"-not-an-option",
		]);
		expect(options).toMatchObject({
			silent: true,
			showError: true,
			location: false,
			method: "POST",
			headers: ["X-A: 1"],
			outputs: [{ kind: "file", path: "out.json" }],
			maxTime: 2.5,
			urls: ["-not-an-option"],
		});
	});

	it("fails the way curl does on bad command lines", async () => {
		expect((await curl(["--frobnicate", "x"], () => ({}))).stderr).toBe(
			"curl: option --frobnicate: is unknown\ncurl: try 'curl --help' or 'curl --manual' for more information\n",
		);
		expect((await curl(["--max-time=5", "x"], () => ({}))).exitCode).toBe(2);
		const missing = await curl(["-o"], () => ({}));
		expect(missing.stderr).toContain("curl: option -o: requires parameter");
		const noUrl = await curl(["-s"], () => ({}));
		expect(noUrl).toMatchObject({ exitCode: 2 });
		expect(noUrl.stderr).toContain("curl: no URL specified");
		expect((await curl(["-m", "soon", "x"], () => ({}))).stderr).toContain(
			"curl: option -m: expected a proper numerical parameter",
		);
	});

	it("expands {} and [] globs, zero padding and steps included", () => {
		expect(
			expandGlob("http://h/{a,b}/[01-03:2].txt").map((item) => item.url),
		).toEqual([
			"http://h/a/01.txt",
			"http://h/a/03.txt",
			"http://h/b/01.txt",
			"http://h/b/03.txt",
		]);
		expect(expandGlob("http://[::1]:3000/").map((item) => item.url)).toEqual([
			"http://[::1]:3000/",
		]);
	});
});

describe("curl", () => {
	it("prints the body, and with -i the status line and headers first", async () => {
		const plain = await curl(["localhost:3000/hi"], () => ({
			body: encode("hello\n"),
		}));
		expect(plain).toMatchObject({ stdout: "hello\n", stderr: "", exitCode: 0 });
		expect(plain.requests[0]?.url.href).toBe("http://localhost:3000/hi");
		expect(plain.requests[0]?.headers).toEqual([
			["Host", "localhost:3000"],
			["User-Agent", "curl/8.7.1"],
			["Accept", "*/*"],
		]);

		const included = await curl(["-i", "localhost:3000/"], () => ({
			body: encode("hi"),
			headers: [
				["Content-Type", "text/plain"],
				["X-Id", "7"],
			],
		}));
		expect(included.stdout).toBe(
			"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nX-Id: 7\r\n\r\nhi",
		);

		const head = await curl(["-I", "localhost:3000/"], () => ({
			body: encode("x"),
		}));
		expect(head.requests[0]?.method).toBe("HEAD");
		expect(head.stdout).toBe(
			"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\n",
		);
	});

	it("sends -d, --data-urlencode, --json and -F bodies as curl builds them", async () => {
		const form = await curl(
			["-d", "a=1", "--data-urlencode", "q=hello world&x", "localhost:3000/"],
			() => ({}),
		);
		const request = form.requests[0] as CurlHttpRequest;
		expect(request.method).toBe("POST");
		expect(decode(request.body)).toBe("a=1&q=hello%20world%26x");
		expect(request.headers).toContainEqual([
			"Content-Type",
			"application/x-www-form-urlencoded",
		]);
		expect(request.headers).toContainEqual(["Content-Length", "23"]);

		const json = await curl(
			["--json", "@body.json", "localhost:3000/"],
			() => ({}),
			{
				"/work/body.json": '{"a":1}',
			},
		);
		expect(decode(json.requests[0]?.body)).toBe('{"a":1}');
		expect(json.requests[0]?.headers).toContainEqual([
			"Content-Type",
			"application/json",
		]);
		expect(json.requests[0]?.headers).toContainEqual([
			"Accept",
			"application/json",
		]);

		const multipart = await curl(
			["-F", "name=Ann", "-F", "photo=@cat.png", "localhost:3000/up"],
			() => ({}),
			{ "/work/cat.png": new Uint8Array([137, 80, 78, 71]) },
		);
		const body = decode(multipart.requests[0]?.body);
		expect(body).toContain(
			'Content-Disposition: form-data; name="name"\r\n\r\nAnn\r\n',
		);
		expect(body).toContain(
			'Content-Disposition: form-data; name="photo"; filename="cat.png"\r\nContent-Type: image/png\r\n',
		);
		expect(
			multipart.requests[0]?.headers.find(
				([name]) => name === "Content-Type",
			)?.[1],
		).toMatch(/^multipart\/form-data; boundary=-{24}[0-9a-f]{16}$/);

		const get = await curl(
			["-G", "-d", "q=1", "localhost:3000/s?x=2"],
			() => ({}),
		);
		expect(get.requests[0]?.method).toBe("GET");
		expect(get.requests[0]?.url.search).toBe("?x=2&q=1");
	});

	it("applies -H, -u, -A, -b and removes headers given as Name:", async () => {
		const { requests } = await curl(
			[
				"-u",
				"ann:secret",
				"-A",
				"bot/1",
				"-b",
				"sid=9",
				"-H",
				"Accept:",
				"-H",
				"X-Empty;",
				"-H",
				"X-Trace: on",
				"localhost:3000/",
			],
			() => ({}),
		);
		expect(requests[0]?.headers).toEqual([
			["Host", "localhost:3000"],
			["Authorization", `Basic ${btoa("ann:secret")}`],
			["User-Agent", "bot/1"],
			["Cookie", "sid=9"],
			["X-Empty", ""],
			["X-Trace", "on"],
		]);
	});

	it("shows a redirect without -L and follows it with -L, POST becoming GET", async () => {
		const route: Route = (request) =>
			request.url.pathname === "/old"
				? { status: 302, statusText: "Found", headers: [["Location", "/new"]] }
				: { body: encode(`${request.method} new`) };
		const without = await curl(
			["-i", "-d", "x=1", "localhost:3000/old"],
			route,
		);
		expect(without.stdout).toBe("HTTP/1.1 302 Found\r\nLocation: /new\r\n\r\n");
		expect(without.requests).toHaveLength(1);

		const followed = await curl(
			[
				"-sL",
				"-d",
				"x=1",
				"-w",
				"%{http_code} %{num_redirects} %{url_effective}",
				"localhost:3000/old",
			],
			route,
		);
		expect(followed.stdout).toBe("GET new200 1 http://localhost:3000/new");
		expect(followed.requests[1]?.body).toBeUndefined();

		const loop = await curl(
			["-L", "--max-redirs", "2", "localhost:3000/old"],
			() => ({
				status: 301,
				statusText: "Moved Permanently",
				headers: [["Location", "/old"]],
			}),
		);
		expect(loop.exitCode).toBe(47);
		expect(loop.stderr).toBe("curl: (47) Maximum (2) redirects followed\n");
	});

	it("fails with -f, keeps the body with --fail-with-body, and is quiet with -s", async () => {
		const notFound: Route = () => ({
			status: 404,
			statusText: "Not Found",
			body: encode("nope"),
		});
		const failed = await curl(["-f", "localhost:3000/x"], notFound);
		expect(failed).toMatchObject({ stdout: "", exitCode: 22 });
		expect(failed.stderr).toBe(
			"curl: (22) The requested URL returned error: 404\n",
		);
		expect((await curl(["-sf", "localhost:3000/x"], notFound)).stderr).toBe("");
		expect(
			(await curl(["-sSf", "localhost:3000/x"], notFound)).stderr,
		).toContain("(22)");
		const withBody = await curl(
			["--fail-with-body", "localhost:3000/x"],
			notFound,
		);
		expect(withBody).toMatchObject({ stdout: "nope", exitCode: 22 });
		const plain = await curl(["localhost:3000/x"], notFound);
		expect(plain).toMatchObject({ stdout: "nope", exitCode: 0 });
	});

	it("reports connection failures and timeouts with curl's codes", async () => {
		const refused = await curl(
			["localhost:4999/"],
			() =>
				new CurlTransferError(
					7,
					"Failed to connect to localhost port 4999 after 0 ms: Couldn't connect to server",
				),
		);
		expect(refused).toMatchObject({ exitCode: 7 });
		expect(refused.stderr).toBe(
			"curl: (7) Failed to connect to localhost port 4999 after 0 ms: Couldn't connect to server\n",
		);
		const slow = await curl(["-m", "1", "localhost:3000/"], (request) => {
			expect(request.timeoutMs).toBe(1000);
			return new CurlTransferError(
				28,
				"Operation timed out after 1001 milliseconds with 0 bytes received",
			);
		});
		expect(slow.exitCode).toBe(28);
		expect((await curl(["ftp://x/y"], () => ({}))).stderr).toBe(
			'curl: (1) Protocol "ftp" not supported\n',
		);
	});

	it("writes -o and -O files byte for byte, with the meter on stderr", async () => {
		const png = new Uint8Array([137, 80, 78, 71, 0, 1]);
		const saved = await curl(
			["-o", "img/cat.png", "--create-dirs", "localhost:3000/cat.png"],
			() => ({ body: png }),
		);
		expect(saved.files.get("/work/img/cat.png")).toEqual(png);
		expect(saved.stdout).toBe("");
		expect(saved.stderr).toContain(
			"  % Total    % Received % Xferd  Average Speed",
		);
		expect(saved.stderr).toContain("\n100     6  100     6    0     0 ");

		const remote = await curl(
			["-sO", "localhost:3000/files/report.csv"],
			() => ({ body: encode("a,b") }),
		);
		expect(decode(remote.files.get("/work/report.csv"))).toBe("a,b");
		expect(remote.stderr).toBe("");

		const noDir = await curl(
			["-o", "missing/x.txt", "localhost:3000/"],
			() => ({ body: encode("x") }),
		);
		expect(noDir.exitCode).toBe(23);

		const binary = await curl(["localhost:3000/cat.png"], () => ({
			body: png,
		}));
		expect(binary).toMatchObject({ stdout: "", exitCode: 23 });
		expect(binary.stderr).toContain(
			'Warning: Binary output can mess up your terminal. Use "--output -" to tell',
		);
		const forced = await curl(["-o", "-", "localhost:3000/cat.png"], () => ({
			body: png,
		}));
		expect(forced.stdoutBytes).toEqual(png);
	});

	it("drops the body into -o /dev/null and still writes -w", async () => {
		const result = await curl(
			[
				"-s",
				"-o",
				"/dev/null",
				"-w",
				"%{http_code} %{size_download}",
				"localhost:3000/",
			],
			() => ({ body: encode("12345") }),
		);
		expect(result).toMatchObject({ stdout: "200 5", stderr: "", exitCode: 0 });
		expect(result.files.has("/dev/null")).toBe(false);
	});

	it("speaks -v and -w the way curl does", async () => {
		const result = await curl(
			[
				"-v",
				"-s",
				"-w",
				"\\n%{http_code} %{content_type} %header{x-id} %{size_download}\\n",
				"localhost:3000/a?b=1",
			],
			() => ({
				body: encode("ok"),
				headers: [
					["Content-Type", "text/plain"],
					["X-Id", "7"],
				],
			}),
		);
		expect(result.stdout).toBe("ok\n200 text/plain 7 2\n");
		expect(result.stderr).toContain(
			"*   Trying localhost:3000...\n* Connected to localhost port 3000\n",
		);
		expect(result.stderr).toContain(
			"> GET /a?b=1 HTTP/1.1\n> Host: localhost:3000\n> User-Agent: curl/8.7.1\n> Accept: */*\n>\n",
		);
		expect(result.stderr).toContain(
			"< HTTP/1.1 200 OK\n< Content-Type: text/plain\n< X-Id: 7\n<\n",
		);
	});

	it("reads -d @- and -T - from a pipe and globs several URLs", async () => {
		const piped = await curl(
			["-d", "@-", "localhost:3000/"],
			() => ({}),
			{},
			{
				stdin: encode("from\npipe"),
			},
		);
		expect(decode(piped.requests[0]?.body)).toBe("frompipe");

		const many = await curl(["-s", "localhost:3000/{a,b}"], (request) => ({
			body: encode(request.url.pathname),
		}));
		expect(many.stdout).toBe("/a/b");

		const help = await curl(["--help"], () => ({}));
		expect(help.stdout).toContain("Usage: curl [options...] <url>");
		expect((await curl(["-V"], () => ({}))).stdout).toMatch(/^curl 8\.7\.1 /);
	});
});
