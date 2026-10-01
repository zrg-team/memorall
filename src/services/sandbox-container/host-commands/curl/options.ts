/**
 * curl's command line, parsed the way curl parses it: short options combine
 * (`-sSL`, `-XPOST`, `-sSo out.txt`), long options never take `=value`,
 * boolean long options accept `--no-` to turn off, and `--` ends options.
 */

export type DataKind = "ascii" | "binary" | "raw" | "urlencode" | "json";

export interface DataPart {
	kind: DataKind;
	value: string;
}

export interface FormPart {
	/** -F (with @file and <file) or --form-string (taken literally). */
	literal: boolean;
	spec: string;
}

export type OutputSpec = { kind: "file"; path: string } | { kind: "remote" };

export interface CurlOptions {
	urls: string[];
	/** The nth -o / -O goes with the nth URL. */
	outputs: OutputSpec[];
	remoteNameAll: boolean;
	method?: string;
	headers: string[];
	data: DataPart[];
	form: FormPart[];
	urlQuery: string[];
	get: boolean;
	head: boolean;
	include: boolean;
	silent: boolean;
	showError: boolean;
	noProgressMeter: boolean;
	location: boolean;
	maxRedirs: number;
	fail: boolean;
	failWithBody: boolean;
	failEarly: boolean;
	verbose: boolean;
	writeOut?: string;
	user?: string;
	userAgent?: string;
	referer?: string;
	cookies: string[];
	cookieJar?: string;
	uploadFile?: string;
	maxTime?: number;
	connectTimeout?: number;
	dumpHeader?: string;
	range?: string;
	createDirs: boolean;
	outputDir?: string;
	retry: number;
	retryDelay?: number;
	compressed: boolean;
	globoff: boolean;
	stderrFile?: string;
	help?: string;
	version: boolean;
}

export const CURL_TRY_HELP =
	"curl: try 'curl --help' or 'curl --manual' for more information";

/** A command line curl refuses, with curl's message and exit code. */
export class CurlUsageError extends Error {
	constructor(
		message: string,
		readonly exitCode = 2,
	) {
		super(message);
	}
}

type Apply = (options: CurlOptions, value: string, name: string) => void;

interface OptionSpec {
	long: string;
	short?: string;
	/** Takes a value. */
	arg?: boolean;
	/** A boolean that `--no-<long>` turns off. */
	bool?: (options: CurlOptions, on: boolean) => void;
	apply?: Apply;
	/** A real curl option this sandbox cannot honour. */
	unsupported?: string;
}

const number = (name: string, value: string, integer = false): number => {
	const parsed = Number(value);
	if (
		!value.trim() ||
		!Number.isFinite(parsed) ||
		parsed < 0 ||
		(integer && !Number.isInteger(parsed))
	) {
		throw new CurlUsageError(
			`curl: option ${name}: expected a proper numerical parameter\n${CURL_TRY_HELP}`,
		);
	}
	return parsed;
};

const accepted = (long: string, short?: string, arg = false): OptionSpec => ({
	long,
	short,
	arg,
	bool: arg ? undefined : () => undefined,
	apply: () => undefined,
});

const unsupported = (
	long: string,
	why: string,
	short?: string,
	arg = true,
): OptionSpec => ({
	long,
	short,
	arg,
	unsupported: why,
});

const NO_PROXY = "proxies are not available here";
const NO_TLS_FILES = "client certificates and CA files are not available here";
const NO_PROTOCOL = "only HTTP, HTTPS and file:// work here";

const SPECS: OptionSpec[] = [
	{ long: "url", arg: true, apply: (o, v) => o.urls.push(v) },
	{ long: "request", short: "X", arg: true, apply: (o, v) => (o.method = v) },
	{ long: "header", short: "H", arg: true, apply: (o, v) => o.headers.push(v) },
	{
		long: "data",
		short: "d",
		arg: true,
		apply: (o, v) => o.data.push({ kind: "ascii", value: v }),
	},
	{
		long: "data-ascii",
		arg: true,
		apply: (o, v) => o.data.push({ kind: "ascii", value: v }),
	},
	{
		long: "data-binary",
		arg: true,
		apply: (o, v) => o.data.push({ kind: "binary", value: v }),
	},
	{
		long: "data-raw",
		arg: true,
		apply: (o, v) => o.data.push({ kind: "raw", value: v }),
	},
	{
		long: "data-urlencode",
		arg: true,
		apply: (o, v) => o.data.push({ kind: "urlencode", value: v }),
	},
	{
		long: "json",
		arg: true,
		apply: (o, v) => o.data.push({ kind: "json", value: v }),
	},
	{
		long: "form",
		short: "F",
		arg: true,
		apply: (o, v) => o.form.push({ literal: false, spec: v }),
	},
	{
		long: "form-string",
		arg: true,
		apply: (o, v) => o.form.push({ literal: true, spec: v }),
	},
	{ long: "url-query", arg: true, apply: (o, v) => o.urlQuery.push(v) },
	{ long: "get", short: "G", bool: (o, on) => (o.get = on) },
	{ long: "head", short: "I", bool: (o, on) => (o.head = on) },
	{ long: "include", short: "i", bool: (o, on) => (o.include = on) },
	{ long: "silent", short: "s", bool: (o, on) => (o.silent = on) },
	{ long: "show-error", short: "S", bool: (o, on) => (o.showError = on) },
	{ long: "no-progress-meter", bool: (o, on) => (o.noProgressMeter = on) },
	{ long: "location", short: "L", bool: (o, on) => (o.location = on) },
	{ long: "location-trusted", bool: (o, on) => (o.location = on) },
	{
		long: "max-redirs",
		arg: true,
		apply: (o, v, n) => (o.maxRedirs = number(n, v, true)),
	},
	{ long: "fail", short: "f", bool: (o, on) => (o.fail = on) },
	{ long: "fail-with-body", bool: (o, on) => (o.failWithBody = on) },
	{ long: "fail-early", bool: (o, on) => (o.failEarly = on) },
	{ long: "verbose", short: "v", bool: (o, on) => (o.verbose = on) },
	{
		long: "write-out",
		short: "w",
		arg: true,
		apply: (o, v) => (o.writeOut = v),
	},
	{ long: "user", short: "u", arg: true, apply: (o, v) => (o.user = v) },
	{
		long: "user-agent",
		short: "A",
		arg: true,
		apply: (o, v) => (o.userAgent = v),
	},
	{ long: "referer", short: "e", arg: true, apply: (o, v) => (o.referer = v) },
	{ long: "cookie", short: "b", arg: true, apply: (o, v) => o.cookies.push(v) },
	{
		long: "cookie-jar",
		short: "c",
		arg: true,
		apply: (o, v) => (o.cookieJar = v),
	},
	{
		long: "upload-file",
		short: "T",
		arg: true,
		apply: (o, v) => (o.uploadFile = v),
	},
	{
		long: "max-time",
		short: "m",
		arg: true,
		apply: (o, v, n) => (o.maxTime = number(n, v)),
	},
	{
		long: "connect-timeout",
		arg: true,
		apply: (o, v, n) => (o.connectTimeout = number(n, v)),
	},
	{
		long: "dump-header",
		short: "D",
		arg: true,
		apply: (o, v) => (o.dumpHeader = v),
	},
	{ long: "range", short: "r", arg: true, apply: (o, v) => (o.range = v) },
	{
		long: "output",
		short: "o",
		arg: true,
		apply: (o, v) => o.outputs.push({ kind: "file", path: v }),
	},
	{
		long: "remote-name",
		short: "O",
		bool: (o, on) => {
			if (on) o.outputs.push({ kind: "remote" });
		},
	},
	{ long: "remote-name-all", bool: (o, on) => (o.remoteNameAll = on) },
	{ long: "create-dirs", bool: (o, on) => (o.createDirs = on) },
	{ long: "output-dir", arg: true, apply: (o, v) => (o.outputDir = v) },
	{
		long: "retry",
		arg: true,
		apply: (o, v, n) => (o.retry = number(n, v, true)),
	},
	{
		long: "retry-delay",
		arg: true,
		apply: (o, v, n) => (o.retryDelay = number(n, v)),
	},
	{ long: "compressed", bool: (o, on) => (o.compressed = on) },
	{ long: "globoff", short: "g", bool: (o, on) => (o.globoff = on) },
	{ long: "stderr", arg: true, apply: (o, v) => (o.stderrFile = v) },
	{ long: "help", short: "h", apply: (o, v) => (o.help = v) },
	{ long: "version", short: "V", bool: (o, on) => (o.version = on) },
	// Accepted and meaningless here: the browser picks TLS, HTTP version,
	// encoding and connection reuse itself.
	accepted("insecure", "k"),
	accepted("progress-bar", "#"),
	accepted("no-buffer", "N"),
	accepted("http1.0", "0"),
	accepted("http1.1"),
	accepted("http2"),
	accepted("http2-prior-knowledge"),
	accepted("http3"),
	accepted("tlsv1", "1"),
	accepted("tlsv1.0"),
	accepted("tlsv1.1"),
	accepted("tlsv1.2"),
	accepted("tlsv1.3"),
	accepted("sslv2", "2"),
	accepted("sslv3", "3"),
	accepted("ipv4", "4"),
	accepted("ipv6", "6"),
	accepted("disable", "q"),
	accepted("parallel", "Z"),
	accepted("path-as-is"),
	accepted("raw"),
	accepted("tr-encoding"),
	accepted("keepalive"),
	accepted("no-keepalive"),
	accepted("no-sessionid"),
	accepted("ssl-no-revoke"),
	accepted("styled-output"),
	accepted("remote-time", "R"),
	accepted("junk-session-cookies", "j"),
	accepted("netrc", "n"),
	accepted("post301"),
	accepted("post302"),
	accepted("post303"),
	accepted("retry-all-errors"),
	accepted("retry-connrefused"),
	accepted("keepalive-time", undefined, true),
	accepted("expect100-timeout", undefined, true),
	accepted("retry-max-time", undefined, true),
	accepted("speed-limit", "Y", true),
	accepted("speed-time", "y", true),
	accepted("limit-rate", undefined, true),
	accepted("cacert", undefined, true),
	accepted("capath", undefined, true),
	accepted("ciphers", undefined, true),
	accepted("proto", undefined, true),
	accepted("proto-redir", undefined, true),
	accepted("resolve", undefined, true),
	accepted("connect-to", undefined, true),
	accepted("interface", undefined, true),
	accepted("dns-servers", undefined, true),
	unsupported("proxy", NO_PROXY, "x"),
	unsupported("proxy-user", NO_PROXY, "U"),
	unsupported("socks5", NO_PROXY),
	unsupported("socks5-hostname", NO_PROXY),
	unsupported("preproxy", NO_PROXY),
	unsupported("cert", NO_TLS_FILES, "E"),
	unsupported("key", NO_TLS_FILES),
	unsupported("unix-socket", "unix sockets are not available here"),
	unsupported("abstract-unix-socket", "unix sockets are not available here"),
	unsupported("config", "config files are not read here", "K"),
	unsupported("continue-at", "resuming a transfer is not available here", "C"),
	unsupported("time-cond", "conditional transfers are not available here", "z"),
	unsupported("trace", "use -v instead"),
	unsupported("trace-ascii", "use -v instead"),
	unsupported("quote", NO_PROTOCOL, "Q"),
	unsupported("ftp-port", NO_PROTOCOL, "P"),
	unsupported("telnet-option", NO_PROTOCOL, "t"),
	unsupported("list-only", NO_PROTOCOL, "l", false),
	unsupported("use-ascii", NO_PROTOCOL, "B", false),
	unsupported("append", NO_PROTOCOL, "a", false),
	unsupported(
		"next",
		"--next is not available here; run curl once per request",
		":",
		false,
	),
	unsupported(
		"manual",
		"the manual is not bundled; see curl --help all",
		"M",
		false,
	),
];

const BY_LONG = new Map(SPECS.map((spec) => [spec.long, spec]));
const BY_SHORT = new Map(
	SPECS.filter((spec) => spec.short).map((spec) => [
		spec.short as string,
		spec,
	]),
);

export const defaultCurlOptions = (): CurlOptions => ({
	urls: [],
	outputs: [],
	remoteNameAll: false,
	headers: [],
	data: [],
	form: [],
	urlQuery: [],
	get: false,
	head: false,
	include: false,
	silent: false,
	showError: false,
	noProgressMeter: false,
	location: false,
	maxRedirs: 50,
	fail: false,
	failWithBody: false,
	failEarly: false,
	verbose: false,
	cookies: [],
	createDirs: false,
	retry: 0,
	compressed: false,
	globoff: false,
	version: false,
});

const use = (
	options: CurlOptions,
	spec: OptionSpec,
	shown: string,
	value: string | undefined,
	on: boolean,
) => {
	if (spec.unsupported) {
		throw new CurlUsageError(
			`curl: option ${shown}: is not supported here: ${spec.unsupported}\n${CURL_TRY_HELP}`,
		);
	}
	if (spec.arg) spec.apply?.(options, value ?? "", shown);
	else if (spec.bool) spec.bool(options, on);
	else spec.apply?.(options, value ?? "", shown);
};

/** Parses argv (without "curl"); throws CurlUsageError as curl would fail. */
export const parseCurlArgs = (args: readonly string[]): CurlOptions => {
	const options = defaultCurlOptions();
	let index = 0;
	const takeValue = (shown: string): string => {
		const value = args[index + 1];
		if (value === undefined) {
			throw new CurlUsageError(
				`curl: option ${shown}: requires parameter\n${CURL_TRY_HELP}`,
			);
		}
		index += 1;
		return value;
	};

	for (; index < args.length; index += 1) {
		const arg = args[index] as string;
		if (arg === "--") {
			options.urls.push(...args.slice(index + 1));
			break;
		}
		if (arg.startsWith("--")) {
			let name = arg.slice(2);
			let spec = BY_LONG.get(name);
			let on = true;
			if (!spec && name.startsWith("no-")) {
				const positive = BY_LONG.get(name.slice(3));
				if (positive?.bool) {
					spec = positive;
					on = false;
					name = name.slice(3);
				}
			}
			if (!spec) {
				throw new CurlUsageError(
					`curl: option ${arg}: is unknown\n${CURL_TRY_HELP}`,
				);
			}
			// --help takes an optional category.
			if (spec.long === "help") {
				const next = args[index + 1];
				options.help = next && !next.startsWith("-") ? next : "";
				if (next && !next.startsWith("-")) index += 1;
				continue;
			}
			use(options, spec, arg, spec.arg ? takeValue(arg) : undefined, on);
			continue;
		}
		if (arg.startsWith("-") && arg.length > 1) {
			// A run of short options; one that takes a value takes the rest of
			// the run, or the next argument.
			for (let at = 1; at < arg.length; at += 1) {
				const letter = arg[at] as string;
				const spec = BY_SHORT.get(letter);
				const shown = `-${letter}`;
				if (!spec) {
					throw new CurlUsageError(
						`curl: option ${shown}: is unknown\n${CURL_TRY_HELP}`,
					);
				}
				if (spec.long === "help") {
					options.help = "";
					continue;
				}
				if (spec.arg) {
					const rest = arg.slice(at + 1);
					use(options, spec, shown, rest || takeValue(shown), true);
					break;
				}
				use(options, spec, shown, undefined, true);
			}
			continue;
		}
		options.urls.push(arg);
	}
	return options;
};

/**
 * curl's URL globbing: `{a,b,c}` alternatives and `[1-10]`, `[01-10]`,
 * `[a-z]`, `[1-10:2]` ranges, each producing one URL. Returns the URLs with
 * the text each glob matched, for `#1` in output names.
 */
export const expandGlob = (
	url: string,
): Array<{ url: string; matches: string[] }> => {
	let literal = "";
	const pieces: Array<string | string[]> = [];
	for (let at = 0; at < url.length; at += 1) {
		const char = url[at] as string;
		if (char === "\\" && at + 1 < url.length) {
			literal += url[at + 1];
			at += 1;
			continue;
		}
		if (char === "{") {
			const end = url.indexOf("}", at);
			if (end < 0)
				throw new CurlUsageError(
					`curl: (3) unmatched brace in URL position ${at + 1}:`,
					3,
				);
			pieces.push(literal);
			literal = "";
			const options = url.slice(at + 1, end).split(",");
			pieces.push(options);
			at = end;
			continue;
		}
		if (char === "[") {
			const end = url.indexOf("]", at);
			const body = end < 0 ? "" : url.slice(at + 1, end);
			const range = /^([a-zA-Z]|\d+)-([a-zA-Z]|\d+)(?::(\d+))?$/.exec(body);
			// An IPv6 literal or anything else that is not a range stays as is.
			if (!range) {
				literal += char;
				continue;
			}
			const [, from, to, stepText] = range as unknown as [
				string,
				string,
				string,
				string?,
			];
			const step = Number(stepText ?? 1) || 1;
			const values: string[] = [];
			if (/^\d+$/.test(from)) {
				const width = from.length > 1 && from.startsWith("0") ? from.length : 0;
				for (let n = Number(from); n <= Number(to); n += step) {
					values.push(width ? String(n).padStart(width, "0") : String(n));
				}
			} else {
				for (
					let code = from.charCodeAt(0);
					code <= to.charCodeAt(0);
					code += step
				) {
					values.push(String.fromCharCode(code));
				}
			}
			pieces.push(literal);
			literal = "";
			pieces.push(values);
			at = end;
			continue;
		}
		literal += char;
	}
	pieces.push(literal);
	let results: Array<{ url: string; matches: string[] }> = [
		{ url: "", matches: [] },
	];
	for (const piece of pieces) {
		if (typeof piece === "string") {
			results = results.map((result) => ({
				...result,
				url: result.url + piece,
			}));
		} else {
			results = results.flatMap((result) =>
				piece.map((value) => ({
					url: result.url + value,
					matches: [...result.matches, value],
				})),
			);
		}
	}
	return results;
};
