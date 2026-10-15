/**
 * The Puter SDK as a hosted app sees it, answered by Memorall instead of
 * puter.com. The app runs in a frame of Memorall's (Files, a MemonOS window)
 * and asks for what Puter's desktop gives a launched app: the file it was
 * opened with, reading and writing files, its window's title, its settings.
 * Each request goes to the host as a message; the host answers from the
 * user's files. Nothing here reaches the network.
 *
 * Protocol (kept in step with src/services/memon/apps/hosted/protocol.ts):
 *   frame → host  { channel, version, kind: "hello", app }
 *   host  → frame { channel, version, kind: "init", init }
 *   frame → host  { channel, version, kind: "request", id, method, params }
 *   host  → frame { channel, version, kind: "part", id, part }  (a streamed answer)
 *   host  → frame { channel, version, kind: "response", id, result | error }
 *   host  → frame { channel, version, kind: "event", event, payload }
 *   frame → host  { channel, version, kind: "notify", event, payload }
 */

import { APP, HIDE, SIGNED_IN } from "./config.js";

const CHANNEL = "memorall-hosted-app";
const VERSION = 1;

const host = window.parent !== window ? window.parent : null;
const origin = location.origin;

const post = (message, transfer = []) =>
	host?.postMessage({ channel: CHANNEL, version: VERSION, ...message }, origin, transfer);

let sequence = 0;
const pending = new Map();
/** The host's answer to hello: { launch, home, user, theme }. */
let initState = null;
let resolveReady;
export const ready = new Promise((resolve) => {
	resolveReady = resolve;
});

/** An error the way Puter's SDK rejects: with a code an app can test. */
const sdkError = (error) =>
	Object.assign(new Error(error?.message || "The request failed."), {
		code: error?.code || "unknown",
		error: { code: error?.code || "unknown", message: error?.message },
	});

/** A request and its id; `onPart` takes the parts of a streamed answer. */
const request = (method, params = {}, { transfer = [], onPart } = {}) => {
	const id = ++sequence;
	const promise = new Promise((resolve, reject) => {
		if (!host) {
			reject(sdkError({ code: "no_host", message: "This app runs inside Memorall." }));
			return;
		}
		pending.set(id, { resolve, reject, onPart });
		post({ kind: "request", id, method, params }, transfer);
	});
	return { id, promise };
};

const call = (method, params = {}, transfer = []) => request(method, params, { transfer }).promise;

const hostEventHandlers = new Map();

const openedHandlers = [];
let closeHandler = null;

/**
 * Hands a handler the launch items at once, as Puter's SDK does: apps read
 * what their handler stored on the very next line (Presentation does). The
 * app starts only after the host said which file it opens, so the items are
 * always known by then.
 */
const handOver = (handler, items) => {
	try {
		handler(items);
	} catch (error) {
		console.error("The app could not take the file it was opened with", error);
	}
};

const applyTheme = (theme) => {
	if (theme === "light" || theme === "dark") {
		document.documentElement.dataset.theme = theme;
		document.documentElement.style.colorScheme = theme;
	}
};

window.addEventListener("message", (event) => {
	if (!host || event.source !== host || event.origin !== origin) return;
	const data = event.data;
	if (!data || data.channel !== CHANNEL || data.version !== VERSION) return;
	if (data.kind === "init") {
		initState = data.init;
		applyTheme(initState?.theme);
		resolveReady(initState);
		return;
	}
	if (data.kind === "part") {
		pending.get(data.id)?.onPart?.(data.part);
		return;
	}
	if (data.kind === "response") {
		const entry = pending.get(data.id);
		if (!entry) return;
		pending.delete(data.id);
		if (data.error) entry.reject(sdkError(data.error));
		else entry.resolve(data.result);
		return;
	}
	if (data.kind === "event") {
		if (data.event === "theme") applyTheme(data.payload);
		else if (data.event === "open") {
			const items = data.payload;
			for (const handler of openedHandlers) handler(items);
		} else if (data.event === "close") {
			// The app may save first and then call puter.exit(); without a
			// handler the window can go at once.
			if (closeHandler) closeHandler();
			else post({ kind: "notify", event: "exit" });
		} else {
			for (const handler of hostEventHandlers.get(data.event) ?? []) handler(data.payload);
		}
	}
});

const toBuffer = async (data) => {
	if (data instanceof Blob) return { buffer: await data.arrayBuffer(), type: data.type };
	if (data instanceof ArrayBuffer) return { buffer: data, type: "" };
	if (ArrayBuffer.isView(data)) {
		const copy = new Uint8Array(data.byteLength);
		copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
		return { buffer: copy.buffer, type: "" };
	}
	const blob = new Blob([data ?? ""]);
	return { buffer: await blob.arrayBuffer(), type: "text/plain" };
};

/** Paths may be objects with a path or uid, as the SDK allows. */
const target = (value) =>
	value && typeof value === "object" ? { path: value.path, uid: value.uid } : { path: String(value ?? "") };

const KV_PREFIX = `memorall-hosted:${APP}:`;
const storage = () => {
	try {
		return globalThis.localStorage || null;
	} catch {
		return null;
	}
};

const fs = {
	async read(path) {
		const { bytes, type } = await call("fs.read", target(path));
		return new Blob([bytes], { type: type || "" });
	},
	async write(path, data, options = {}) {
		const { buffer, type } = await toBuffer(data);
		return call(
			"fs.write",
			{
				...target(path),
				bytes: buffer,
				type,
				overwrite: options.overwrite !== false,
				dedupeName: !!options.dedupeName,
				createMissingParents: options.createMissingParents !== false,
			},
			[buffer],
		);
	},
	stat: (path) => call("fs.stat", target(path)),
	readdir: (path) => call("fs.readdir", target(path)),
	mkdir: (path, options = {}) => call("fs.mkdir", { ...target(path), dedupeName: !!options.dedupeName }),
	delete: (path, options = {}) => call("fs.delete", { ...target(path), recursive: options.recursive !== false }),
	rename: (path, name) => call("fs.rename", { ...target(path), name: String(name ?? "") }),
	move: (from, to) => call("fs.move", { ...target(from), to: String(to ?? "") }),
	copy: (from, to) => call("fs.copy", { ...target(from), to: String(to ?? "") }),
	async getReadURL(path) {
		return URL.createObjectURL(await fs.read(path));
	},
};

const ui = {
	onLaunchedWithItems(handler) {
		if (typeof handler !== "function") return;
		if (initState?.launch?.length) handOver(handler, initState.launch);
	},
	/** Like Puter's: replays the launch file, then each file opened later. */
	onItemsOpened(handler) {
		if (typeof handler !== "function") return;
		openedHandlers.push(handler);
		if (initState?.launch?.length) handOver(handler, initState.launch);
	},
	onWindowClose(handler) {
		if (typeof handler === "function") closeHandler = handler;
	},
	setWindowTitle(title) {
		post({ kind: "notify", event: "title", payload: String(title ?? "") });
		return Promise.resolve();
	},
	showOpenFilePicker: (options = {}) => call("ui.showOpenFilePicker", { accept: options.accept ?? "", multiple: !!options.multiple }),
	async showSaveFilePicker(data, suggestedName) {
		const { buffer, type } = await toBuffer(data);
		return call("ui.showSaveFilePicker", { bytes: buffer, type, name: String(suggestedName ?? "") }, [buffer]);
	},
};

/* ---------- AI ---------- */

const isOptions = (value) =>
	!!value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Blob);

const asDataUrl = (blob) =>
	new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});

/** A picture as the model takes it: a data URL, from a file, a URL or a path. */
const imagePart = async (image) => {
	let url;
	if (image instanceof Blob) url = await asDataUrl(image);
	else if (/^data:/i.test(image)) url = image;
	else if (/^(blob:|https?:)/i.test(image)) {
		try {
			url = await asDataUrl(await (await fetch(image)).blob());
		} catch {
			url = image;
		}
	} else url = await asDataUrl(await fs.read(image));
	return { type: "image_url", image_url: { url } };
};

/**
 * Puter's `chat` arguments, in each form it takes: a prompt or a conversation
 * first; then pictures (a URL, a file, a list of them), a test-mode flag,
 * and the options last.
 */
const chatRequest = async (args) => {
	const [first, ...rest] = args;
	const options = rest.length && isOptions(rest[rest.length - 1]) ? rest.pop() : {};
	const images = rest.flat().filter((value) => typeof value === "string" || value instanceof Blob);
	let messages;
	if (Array.isArray(first)) messages = first;
	else if (isOptions(first) && Array.isArray(first.messages)) messages = first.messages;
	else {
		const prompt = String(first ?? "");
		messages = [
			{
				role: "user",
				content: images.length
					? [{ type: "text", text: prompt }, ...(await Promise.all(images.map(imagePart)))]
					: prompt,
			},
		];
	}
	return {
		messages,
		stream: options.stream === true,
		...(options.tools ? { tools: options.tools } : {}),
		...(typeof options.max_tokens === "number" ? { max_tokens: options.max_tokens } : {}),
		...(typeof options.temperature === "number" ? { temperature: options.temperature } : {}),
	};
};

/** A whole answer as Puter's SDK gives one: it reads as its text, too. */
const chatReply = (reply) => {
	const text = reply?.message?.content ?? "";
	return Object.assign(reply, { toString: () => text, valueOf: () => text });
};

/** A streamed answer: its parts as they come; stopping early stops the host. */
async function* streamedReply(params) {
	const queue = [];
	let wake = null;
	let ended = false;
	let failure = null;
	const { id, promise } = request("ai.chat", params, {
		onPart: (part) => {
			queue.push(part);
			wake?.();
		},
	});
	promise.then(
		() => {
			ended = true;
			wake?.();
		},
		(error) => {
			failure = error;
			ended = true;
			wake?.();
		},
	);
	try {
		for (;;) {
			if (queue.length) {
				yield queue.shift();
				continue;
			}
			if (failure) throw failure;
			if (ended) return;
			await new Promise((resolve) => {
				wake = resolve;
			});
			wake = null;
		}
	} finally {
		if (!ended) post({ kind: "notify", event: "cancel", payload: id });
	}
}

/**
 * Puter's AI, answered by the chat model chosen in Memorall. Only chat is
 * here: an app offers its picture and speech features only where the SDK
 * has them.
 */
const ai = {
	async chat(...args) {
		const params = await chatRequest(args);
		if (params.stream) return streamedReply(params);
		return chatReply(await call("ai.chat", params));
	},
};

const user = () => initState?.user ?? { username: "you", uuid: "memorall-local" };

const auth = {
	isSignedIn: () => SIGNED_IN,
	async getUser() {
		await ready;
		return SIGNED_IN ? user() : null;
	},
	async signIn() {
		if (SIGNED_IN) return user();
		// Puter's SDK rejects a closed sign-in window this way; apps treat it
		// as a cancel.
		throw { error: "auth_window_closed", msg: "Signing in is not available here." };
	},
	signOut() {},
	getProfilePicture: async () => null,
};

const kv = {
	async get(key) {
		const raw = storage()?.getItem(KV_PREFIX + key);
		if (raw == null) return null;
		try {
			return JSON.parse(raw);
		} catch {
			return raw;
		}
	},
	async set(key, value) {
		try {
			storage()?.setItem(KV_PREFIX + key, JSON.stringify(value));
			return true;
		} catch {
			return false;
		}
	},
	async del(key) {
		storage()?.removeItem(KV_PREFIX + key);
		return true;
	},
};

/** The app's Puter-cloud controls (signing in, sharing…) are not drawn here. */
const hideCloudControls = () => {
	if (!HIDE.length) return;
	const style = document.createElement("style");
	style.dataset.memorallHost = "";
	style.textContent = `${HIDE.join(",\n")} { display: none !important; }`;
	document.head.append(style);
};

if (host) {
	hideCloudControls();
	const sdk = {
		env: "app",
		appID: `memorall-${APP}`,
		appInstanceID: `${APP}-${Math.random().toString(36).slice(2)}`,
		fs,
		ui,
		auth,
		kv,
		ai,
		print: () => window.print(),
		exit() {
			post({ kind: "notify", event: "exit" });
		},
	};
	// Apps set puter.onAuth to learn about sign-ins the SDK makes by itself;
	// none happen here.
	Object.defineProperty(sdk, "onAuth", { set() {}, get: () => undefined, configurable: true });
	globalThis.puter = sdk;
	post({ kind: "hello", app: APP });
} else {
	resolveReady(null);
}

export const launchItems = () => initState?.launch ?? [];
export const hostCall = call;
export const appId = APP;
/** Tells the host something the app's own code has no SDK call for. */
export const notifyHost = (event, payload) => post({ kind: "notify", event, payload });
/** Hears an event the host sends that the SDK does not handle itself. */
export const onHostEvent = (event, handler) => {
	if (!hostEventHandlers.has(event)) hostEventHandlers.set(event, []);
	hostEventHandlers.get(event).push(handler);
};
