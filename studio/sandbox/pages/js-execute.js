const safeSerialize = (value) => {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (value === null) return "null";
	if (value === undefined) return "undefined";
	try {
		return JSON.stringify(value);
	} catch {
		try {
			return String(value);
		} catch {
			return "[unserializable]";
		}
	}
};

const createMemoryStorage = () => {
	const store = new Map();
	return {
		get length() {
			return store.size;
		},
		clear() {
			store.clear();
		},
		getItem(key) {
			return store.has(key) ? store.get(key) ?? null : null;
		},
		key(index) {
			return Array.from(store.keys())[index] ?? null;
		},
		removeItem(key) {
			store.delete(key);
		},
		setItem(key, value) {
			store.set(String(key), String(value));
		},
	};
};

const createCookieStore = () => {
	const store = new Map();
	return {
		getAll() {
			return Array.from(store.entries())
				.map(([k, v]) => `${k}=${v}`)
				.join("; ");
		},
		get(name) {
			return store.get(name) ?? "";
		},
		set(name, value) {
			store.set(String(name), String(value));
		},
		clear() {
			store.clear();
		},
	};
};

const sanitizeHeaders = (headers) => {
	if (!headers) return undefined;
	const map = new Headers(headers);
	map.delete("cookie");
	map.delete("authorization");
	map.delete("proxy-authorization");
	return map;
};

const createSafeFetch = () => {
	return async (input, init = {}) => {
		if (init.credentials && init.credentials !== "omit") {
			throw new Error("fetch credentials are not allowed in sandbox");
		}
		const safeInit = {
			...init,
			credentials: "omit",
			headers: sanitizeHeaders(init.headers),
		};
		return fetch(input, safeInit);
	};
};

class SafeXMLHttpRequest {
	constructor() {
		this.onreadystatechange = null;
		this.onload = null;
		this.onerror = null;
		this.readyState = 0;
		this.status = 0;
		this.statusText = "";
		this.responseText = "";
		this.withCredentials = false;
		this.method = "GET";
		this.url = "";
		this.headers = new Map();
	}
	open(method, url) {
		this.method = method;
		this.url = url;
		this.readyState = 1;
		if (this.onreadystatechange) this.onreadystatechange();
	}
	setRequestHeader(name, value) {
		this.headers.set(String(name).toLowerCase(), String(value));
	}
	async send(body) {
		if (this.withCredentials) {
			this.fail("XMLHttpRequest credentials are not allowed in sandbox");
			return;
		}
		try {
			const headers = new Headers();
			for (const [key, value] of this.headers.entries()) {
				if (
					key === "cookie" ||
					key === "authorization" ||
					key === "proxy-authorization"
				) {
					continue;
				}
				headers.set(key, value);
			}
			const response = await fetch(this.url, {
				method: this.method,
				body,
				credentials: "omit",
				headers,
			});
			this.status = response.status;
			this.statusText = response.statusText;
			this.responseText = await response.text();
			this.readyState = 4;
			if (this.onreadystatechange) this.onreadystatechange();
			if (this.onload) this.onload();
		} catch (error) {
			this.fail(
				error instanceof Error ? error.message : "XMLHttpRequest failed",
			);
		}
	}
	fail(message) {
		this.status = 0;
		this.statusText = message;
		this.responseText = "";
		this.readyState = 4;
		if (this.onreadystatechange) this.onreadystatechange();
		if (this.onerror) this.onerror();
	}
}

const FORBIDDEN_GLOBALS = new Set([
	"window",
	"document",
	"indexedDB",
	"caches",
	"location",
	"history",
	"navigator",
	"chrome",
	"browser",
	"WebSocket",
]);

const pushLog = (logs, maxLogEntries, onTruncate, entry) => {
	if (logs.length >= maxLogEntries) {
		logs.shift();
		onTruncate();
	}
	logs.push(entry);
};

const buildContext = (logs, maxLogEntries, onTruncate) => ({
	console: {
		log: (...args) => {
			pushLog(logs, maxLogEntries, onTruncate, {
				level: "log",
				message: args.map(safeSerialize).join(" "),
			});
		},
		info: (...args) => {
			pushLog(logs, maxLogEntries, onTruncate, {
				level: "info",
				message: args.map(safeSerialize).join(" "),
			});
		},
		warn: (...args) => {
			pushLog(logs, maxLogEntries, onTruncate, {
				level: "warn",
				message: args.map(safeSerialize).join(" "),
			});
		},
		error: (...args) => {
			pushLog(logs, maxLogEntries, onTruncate, {
				level: "error",
				message: args.map(safeSerialize).join(" "),
			});
		},
		debug: (...args) => {
			pushLog(logs, maxLogEntries, onTruncate, {
				level: "debug",
				message: args.map(safeSerialize).join(" "),
			});
		},
	},
	Math,
	Number,
	String,
	Boolean,
	Array,
	Object,
	Date,
	JSON,
	RegExp,
	Promise,
	cookie: createCookieStore(),
	localStorage: createMemoryStorage(),
	sessionStorage: createMemoryStorage(),
	fetch: createSafeFetch(),
	XMLHttpRequest: SafeXMLHttpRequest,
});

const execute = async ({ code, timeoutMs = 1000, maxLogEntries = 20 }) => {
	const logs = [];
	let truncatedLogs = 0;
	const startedAt = Date.now();
	const onTruncate = () => {
		truncatedLogs += 1;
	};

	try {
		const context = buildContext(logs, maxLogEntries, onTruncate);
		const proxy = new Proxy(context, {
			has: () => true,
			get: (target, prop) => {
				if (typeof prop === "string" && FORBIDDEN_GLOBALS.has(prop)) {
					throw new Error(`Access to '${prop}' is not allowed`);
				}
				return target[prop];
			},
			set: (target, prop, value) => {
				target[prop] = value;
				return true;
			},
		});

		const runner = new Function(
			"context",
			`with (context) { return (async () => { ${code}\n })(); }`,
		);

		const result = await Promise.race([
			Promise.resolve(runner(proxy)),
			new Promise((resolve) =>
				setTimeout(() => resolve("__timeout"), timeoutMs),
			),
		]);

		const durationMs = Date.now() - startedAt;
		if (result === "__timeout") {
			return { status: "timeout", durationMs, logs, truncatedLogs };
		}

		let resolved = result;
		if (resolved === undefined && logs.length > 0) {
			resolved = logs[logs.length - 1].message;
		}
		return {
			status: "ok",
			durationMs,
			result: safeSerialize(resolved),
			logs,
			truncatedLogs,
		};
	} catch (error) {
		const durationMs = Date.now() - startedAt;
		return {
			status: "error",
			durationMs,
			error: safeSerialize(error instanceof Error ? error.message : error),
			stack: error instanceof Error ? error.stack : undefined,
			logs,
			truncatedLogs,
		};
	}
};

window.addEventListener("message", async (event) => {
	const data = event.data || {};
	if (!data || data.type !== "run" || !data.id) return;
	const result = await execute(data);
	parent.postMessage({ type: "result", id: data.id, payload: result }, "*");
});
