/** curl's own text: meter, -w variables, help, version and warnings. */

export const CURL_VERSION = "8.7.1";
export const CURL_USER_AGENT = `curl/${CURL_VERSION}`;

export const VERSION_TEXT = `curl ${CURL_VERSION} (memorall) libcurl/${CURL_VERSION} (browser fetch)
Release-Date: 2024-03-27
Protocols: file http https
Features: alt-svc AsynchDNS brotli HTTP2 IPv6 Largefile libz threadsafe UnixSockets zstd
`;

export const HELP_TEXT = `Usage: curl [options...] <url>
 -d, --data <data>           HTTP POST data
 -f, --fail                  Fail fast with no output on HTTP errors
 -h, --help <category>       Get help for commands
 -i, --include               Include response headers in output
 -o, --output <file>         Write to file instead of stdout
 -O, --remote-name           Write output to file named as remote file
 -s, --silent                Silent mode
 -T, --upload-file <file>    Transfer local FILE to destination
 -u, --user <user:password>  Server user and password
 -A, --user-agent <name>     Send User-Agent <name> to server
 -v, --verbose               Make the operation more talkative
 -V, --version               Show version number and quit

This is not the full help; this menu is split into categories.
Use "--help category" to get an overview of all categories, which are:
auth, connection, curl, dns, file, global, http, output, post, timeout, tls, upload, verbose.
For all options use the manual or "--help all".
`;

export const HELP_ALL_TEXT = `Usage: curl [options...] <url>
     --compressed              Request compressed response
     --connect-timeout <sec>   Maximum time allowed to connect
 -b, --cookie <data|filename>  Send cookies from string/load from file
 -c, --cookie-jar <filename>   Save cookies to <filename> after operation
     --create-dirs             Create necessary local directory hierarchy
 -d, --data <data>             HTTP POST data
     --data-ascii <data>       HTTP POST ASCII data
     --data-binary <data>      HTTP POST binary data
     --data-raw <data>         HTTP POST data, '@' allowed
     --data-urlencode <data>   HTTP POST data URL encoded
 -D, --dump-header <filename>  Write the received headers to <filename>
 -f, --fail                    Fail fast with no output on HTTP errors
     --fail-early              Fail on first transfer error
     --fail-with-body          Fail on HTTP errors but save the body
 -F, --form <name=content>     Specify multipart MIME data
     --form-string <name=string>  Specify multipart MIME data
 -G, --get                     Put the post data in the URL and use GET
 -g, --globoff                 Disable URL globbing with {} and []
 -I, --head                    Show document info only
 -H, --header <header/@file>   Pass custom header(s) to server
 -h, --help <subject>          Get help for commands
 -i, --include                 Include protocol response headers in the output
 -k, --insecure                Allow insecure server connections
     --json <data>             HTTP POST JSON
 -L, --location                Follow redirects
     --max-redirs <num>        Maximum number of redirects allowed
 -m, --max-time <fractional seconds>  Maximum time allowed for transfer
     --no-progress-meter       Do not show the progress meter
 -o, --output <file>           Write to file instead of stdout
     --output-dir <dir>        Directory to save files in
 -r, --range <range>           Retrieve only the bytes within RANGE
 -e, --referer <URL>           Referrer URL
 -O, --remote-name             Write output to a file named as the remote file
     --remote-name-all         Use the remote file name for all URLs
 -X, --request <method>        Specify request method to use
     --retry <num>             Retry request if transient problems occur
     --retry-delay <seconds>   Wait time between retries
 -S, --show-error              Show error even when -s is used
 -s, --silent                  Silent mode
     --stderr <file>           Where to redirect stderr
 -T, --upload-file <file>      Transfer local FILE to destination
     --url <url>               URL to work with
     --url-query <data>        Add a URL query part
 -u, --user <user:password>    Server user and password
 -A, --user-agent <name>       Send User-Agent <name> to server
 -v, --verbose                 Make the operation more talkative
 -V, --version                 Show version number and quit
 -w, --write-out <format>      Use output FORMAT after completion
`;

/** curl wraps its warnings at 79 columns, each line starting "Warning: ". */
export const curlWarning = (text: string): string => {
	const width = 79 - "Warning: ".length;
	const lines: string[] = [];
	let line = "";
	for (const word of text.split(" ")) {
		if (line && line.length + 1 + word.length > width) {
			lines.push(`${line} `);
			line = word;
		} else {
			line = line ? `${line} ${word}` : word;
		}
	}
	if (line) lines.push(line);
	return lines.map((part) => `Warning: ${part}\n`).join("");
};

export const BINARY_WARNING = curlWarning(
	'Binary output can mess up your terminal. Use "--output -" to tell curl to output it to your terminal anyway, or consider "--output <FILE>" to save to a file.',
);

/** Whether bytes would garble a terminal: curl looks for a zero byte. */
export const looksBinary = (body: Uint8Array): boolean =>
	body.subarray(0, 2000).includes(0);

/** curl's 5-character sizes in the meter: 1256, 12345, 1206k, 11.7M. */
const size5 = (bytes: number): string => {
	if (bytes < 100_000) return String(bytes).padStart(5);
	if (bytes < 10_000 * 1024) return `${Math.floor(bytes / 1024)}k`.padStart(5);
	if (bytes < 100 * 1024 * 1024) {
		const mb = bytes / (1024 * 1024);
		return `${mb.toFixed(mb < 10 ? 1 : 0)}M`.padStart(5);
	}
	return `${Math.floor(bytes / (1024 * 1024 * 1024))}G`.padStart(5);
};

const clock = (seconds: number): string =>
	seconds < 1
		? "--:--:--"
		: `${String(Math.floor(seconds / 3600)).padStart(2)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** The meter curl prints on stderr when its output is not a terminal. */
export const progressMeter = (
	downloaded: number,
	uploaded: number,
	elapsedMs: number,
): string => {
	const seconds = elapsedMs / 1000;
	const speed = (bytes: number) =>
		size5(Math.round(bytes / Math.max(seconds, 0.001)));
	const percent = (done: number) => (done > 0 ? "100" : "  0");
	return [
		"  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current",
		"                                 Dload  Upload   Total   Spent    Left  Speed",
		`${percent(downloaded)} ${size5(downloaded)}  ${percent(downloaded)} ${size5(downloaded)}  ${percent(uploaded)} ${size5(uploaded)}  ${speed(downloaded)}  ${uploaded ? speed(uploaded) : "    0"} ${clock(seconds)} ${clock(seconds)} --:--:-- ${speed(downloaded)}`,
		"",
	].join("\n");
};

export interface WriteOutValues {
	httpCode: number;
	httpVersion: string;
	method: string;
	urlEffective: string;
	url: string;
	contentType: string;
	sizeDownload: number;
	sizeHeader: number;
	sizeRequest: number;
	sizeUpload: number;
	timeTotal: number;
	numRedirects: number;
	redirectUrl: string;
	remoteIp: string;
	remotePort: number;
	exitCode: number;
	errorMessage: string;
	filenameEffective: string;
	headers: Array<[string, string]>;
	scheme: string;
}

const seconds6 = (value: number) => value.toFixed(6);

/** Expands a -w format: %{var}, %header{name}, %{header_json}, \n escapes. */
export const formatWriteOut = (
	format: string,
	values: WriteOutValues,
): { stdout: string; stderr: string } => {
	let stdout = "";
	let stderr = "";
	let target: "stdout" | "stderr" = "stdout";
	const write = (text: string) => {
		if (target === "stdout") stdout += text;
		else stderr += text;
	};
	const header = (name: string) =>
		values.headers
			.filter(([key]) => key.toLowerCase() === name.toLowerCase())
			.map(([, value]) => value)
			.join(", ");
	const variable = (name: string): string | null => {
		switch (name) {
			case "http_code":
			case "response_code":
				return String(values.httpCode).padStart(3, "0");
			case "http_version":
				return values.httpVersion;
			case "method":
				return values.method;
			case "url_effective":
				return values.urlEffective;
			case "url":
				return values.url;
			case "content_type":
				return values.contentType;
			case "size_download":
				return String(values.sizeDownload);
			case "size_header":
				return String(values.sizeHeader);
			case "size_request":
				return String(values.sizeRequest);
			case "size_upload":
				return String(values.sizeUpload);
			case "speed_download":
				return String(
					Math.round(
						values.sizeDownload / Math.max(values.timeTotal, 0.000001),
					),
				);
			case "speed_upload":
				return String(
					Math.round(values.sizeUpload / Math.max(values.timeTotal, 0.000001)),
				);
			case "time_total":
			case "time_starttransfer":
				return seconds6(values.timeTotal);
			case "time_namelookup":
			case "time_connect":
			case "time_appconnect":
			case "time_pretransfer":
			case "time_redirect":
				return seconds6(0);
			case "num_redirects":
				return String(values.numRedirects);
			case "num_connects":
				return "1";
			case "redirect_url":
				return values.redirectUrl;
			case "remote_ip":
				return values.remoteIp;
			case "remote_port":
				return String(values.remotePort);
			case "local_ip":
				return "127.0.0.1";
			case "local_port":
				return "0";
			case "scheme":
				return values.scheme;
			case "exitcode":
				return String(values.exitCode);
			case "errormsg":
				return values.errorMessage;
			case "filename_effective":
				return values.filenameEffective;
			case "ssl_verify_result":
			case "proxy_ssl_verify_result":
				return "0";
			case "header_json":
				return JSON.stringify(
					Object.fromEntries(
						values.headers.map(([key]) => [
							key.toLowerCase(),
							values.headers
								.filter(([other]) => other.toLowerCase() === key.toLowerCase())
								.map(([, value]) => value),
						]),
					),
				);
			case "json":
				return JSON.stringify({
					content_type: values.contentType,
					errormsg: values.errorMessage || null,
					exitcode: values.exitCode,
					filename_effective: values.filenameEffective || null,
					http_code: values.httpCode,
					http_version: values.httpVersion,
					method: values.method,
					num_redirects: values.numRedirects,
					redirect_url: values.redirectUrl || null,
					remote_ip: values.remoteIp,
					remote_port: values.remotePort,
					scheme: values.scheme,
					size_download: values.sizeDownload,
					size_header: values.sizeHeader,
					size_request: values.sizeRequest,
					size_upload: values.sizeUpload,
					time_total: values.timeTotal,
					url: values.url,
					url_effective: values.urlEffective,
				});
			default:
				return null;
		}
	};

	for (let at = 0; at < format.length; at += 1) {
		const char = format[at] as string;
		if (char === "\\" && at + 1 < format.length) {
			const next = format[at + 1];
			const escaped =
				next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "\r" : null;
			if (escaped !== null) {
				write(escaped);
				at += 1;
				continue;
			}
			write(char);
			continue;
		}
		if (char !== "%") {
			write(char);
			continue;
		}
		if (format[at + 1] === "%") {
			write("%");
			at += 1;
			continue;
		}
		const headerMatch = /^%header\{([^}]*)\}/.exec(format.slice(at));
		if (headerMatch) {
			write(header(headerMatch[1] as string));
			at += headerMatch[0].length - 1;
			continue;
		}
		const match = /^%\{([^}]*)\}/.exec(format.slice(at));
		if (match) {
			const name = match[1] as string;
			at += match[0].length - 1;
			if (name === "stdout") {
				target = "stdout";
				continue;
			}
			if (name === "stderr") {
				target = "stderr";
				continue;
			}
			const value = variable(name);
			if (value === null) {
				stderr += `curl: unknown --write-out variable: '${name}'\n`;
				continue;
			}
			write(value);
			continue;
		}
		write(char);
	}
	return { stdout, stderr };
};
