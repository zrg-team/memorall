/**
 * renderer.js — loaded by pages/renderer.html inside the SW-controlled /sandbox/ scope.
 * DEBUG BUILD — verbose console logging at every step.
 */
(async () => {
	const params = new URLSearchParams(location.search);
	const port = params.get('port');
	const path = decodeURIComponent(params.get('path') || '/');
	const FILESYSTEM_CHANGED_EVENT = 'FILESYSTEM_CHANGED';
	let reloadTimer = null;
	const importMapParam = params.get('importMap');
	let rendererImportMap = null;
	if (importMapParam) {
		try {
			const imports = JSON.parse(decodeURIComponent(importMapParam));
			if (imports && typeof imports === 'object' && Object.keys(imports).length > 0) {
				rendererImportMap = imports;
			}
		} catch (err) {
			console.warn('[renderer] failed to parse importMap query param', err);
		}
	}

	console.log('[renderer] start port=' + port + ' path=' + path);

	if (!port) return;

	const scheduleReload = (change) => {
		if (!change || change.scope !== 'workspace') {
			return;
		}
		if (reloadTimer) {
			clearTimeout(reloadTimer);
		}
		reloadTimer = setTimeout(() => {
			console.log('[renderer] reloading after filesystem change', change);
			location.reload();
		}, 120);
	};

	const installFilesystemReloadListener = () => {
		if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) {
			return;
		}
		if (window._memorallFsReloadListener) {
			chrome.runtime.onMessage.removeListener(window._memorallFsReloadListener);
		}
		window._memorallFsReloadListener = (message) => {
			if (message?.type !== FILESYSTEM_CHANGED_EVENT) return;
			scheduleReload(message.change ?? null);
		};
		chrome.runtime.onMessage.addListener(window._memorallFsReloadListener);
	};

	window._memorallScheduleFsReload = scheduleReload;
	window._memorallInstallFsReloadListener = installFilesystemReloadListener;
	installFilesystemReloadListener();

	// ── SW relay init ──────────────────────────────────────────────────────────
	const swController = navigator.serviceWorker?.controller;
	console.log('[renderer] swController=', swController);

	const isEmbeddedRenderer = window.parent !== window;
	if (swController && isEmbeddedRenderer) {
		const channel = new MessageChannel();

		window._swRelayPort = channel.port1;
		window._swRelayFn = (event) => {
			console.log('[renderer] port1.onmessage fired type=' + event.data?.type + ' id=' + event.data?.id);
			if (event.data?.type === 'request') {
				console.log('[renderer] relaying sw-relay-request id=' + event.data.id + ' url=' + event.data.data?.url);
				parent.postMessage({
					type: 'sw-relay-request',
					id: event.data.id,
					portNum: event.data.data.port,
					method: event.data.data.method,
					url: event.data.data.url,
					headers: event.data.data.headers,
					body: event.data.data.body,
				}, '*');
			}
		};
		channel.port1.start();
		channel.port1.onmessage = window._swRelayFn;

		// Parent → renderer → SW (response).
		// NOTE: document.open() removes this listener. renderer-utils.js re-adds it.
		window.addEventListener('message', (e) => {
			if (e.data?.type === 'sw-relay-response') {
				console.log('[renderer] got sw-relay-response id=' + e.data.id + ' error=' + e.data.error);
				if (window._swRelayPort) {
					window._swRelayPort.postMessage({
						type: 'response',
						id: e.data.id,
						data: e.data.data,
						error: e.data.error,
					});
				}
			}
		});

		swController.postMessage({ type: 'init' }, [channel.port2]);
		console.log('[renderer] sent init to SW with port2');

		if (rendererImportMap) {
			swController.postMessage({
				type: 'set-import-map',
				data: { port: Number(port), importMap: rendererImportMap },
			});
			console.log('[renderer] sent import map to controlling SW for port=' + port);
		}

		await new Promise((r) => setTimeout(r, 100));
	} else if (!swController) {
		console.warn('[renderer] NO swController — SW requests will timeout!');
	} else {
		console.log('[renderer] using the existing top-level sandbox relay');
		if (rendererImportMap) {
			swController.postMessage({
				type: 'set-import-map',
				data: { port: Number(port), importMap: rendererImportMap },
			});
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}

	// ── Inline code ───────────────────────────────────────────────────────────
	// An extension page may not run inline code: no <script> without src, no
	// onclick="…". The page's inline scripts become files the service worker
	// serves, and its on* attributes one script that adds the same listeners.
	// The dev servers' own HMR scripts stay out: renderer-utils.js stubs them.
	const JS_TYPES = ['', 'module', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript'];
	const DEV_SERVER_SCRIPT = /__vite_hot_context__|RefreshRuntime|injectIntoGlobalHook/;
	// A body's on* attributes for these are the window's handlers.
	const WINDOW_EVENTS = new Set(['load', 'unload', 'beforeunload', 'pagehide', 'pageshow', 'resize', 'hashchange', 'popstate', 'message', 'online', 'offline', 'storage', 'error', 'focus', 'blur', 'scroll']);

	const handlerScript = (bindings) => {
		const lines = ['(() => {'];
		bindings.forEach((binding) => {
			lines.push('{');
			lines.push('const el = document.querySelector(\'[data-memorall-on="' + binding.id + '"]\');');
			lines.push('if (el) {');
			for (const handler of binding.handlers) {
				const target = handler.onWindow ? 'window' : 'el';
				// As an inline handler: `this` is the element, returning false cancels.
				lines.push(
					target + '.addEventListener(' + JSON.stringify(handler.type) + ', function (event) {\n' +
					'if ((function (event) {\n' + handler.code + '\n}).call(this, event) === false) event.preventDefault();\n' +
					'});',
				);
				if (!handler.onWindow && (handler.type === 'load' || handler.type === 'error')) {
					// An image may have loaded, or failed, before this ran.
					lines.push(
						'if (el.complete && el.getAttribute("src") && (el.naturalWidth > 0) === ' +
						(handler.type === 'load') + ') el.dispatchEvent(new Event(' + JSON.stringify(handler.type) + '));',
					);
				}
			}
			lines.push('}');
			lines.push('}');
		});
		lines.push('})();');
		return lines.join('\n');
	};

	const sendInlineScripts = (scripts) =>
		new Promise((resolve) => {
			const controller = navigator.serviceWorker?.controller;
			if (!controller || scripts.length === 0) return resolve(false);
			const channel = new MessageChannel();
			const timer = setTimeout(() => resolve(false), 2000);
			channel.port1.onmessage = () => {
				clearTimeout(timer);
				resolve(true);
			};
			controller.postMessage({ type: 'set-inline-scripts', data: { scripts } }, [channel.port2]);
		});

	const moveInlineCode = async (source) => {
		const doc = new DOMParser().parseFromString(source, 'text/html');
		const render = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
		const scripts = [];
		const served = [];
		const fileFor = (code) => {
			const name = '__memorall_inline__/' + render + '/' + scripts.length + '.js';
			scripts.push({ path: '/' + name, code });
			return name;
		};

		for (const script of Array.from(doc.querySelectorAll('script:not([src])'))) {
			const type = (script.getAttribute('type') || '').trim().toLowerCase();
			// Import maps reach the service worker out-of-band; data blocks stay.
			if (type === 'importmap') {
				script.remove();
				continue;
			}
			if (!JS_TYPES.includes(type)) continue;
			const code = script.textContent || '';
			if (!code.trim() || DEV_SERVER_SCRIPT.test(code)) {
				script.remove();
				continue;
			}
			if (type !== 'module') {
				// Inline, it ran in place; as a file it must too.
				script.removeAttribute('async');
				script.removeAttribute('defer');
			}
			script.textContent = '';
			script.setAttribute('src', fileFor(code));
			served.push(script);
		}

		const bindings = [];
		for (const el of Array.from(doc.querySelectorAll('*'))) {
			const handlers = [];
			for (const attr of Array.from(el.attributes)) {
				const name = attr.name.toLowerCase();
				if (!name.startsWith('on') || name.length < 3) continue;
				const type = name.slice(2);
				handlers.push({
					type,
					code: attr.value,
					onWindow: (el.localName === 'body' || el.localName === 'frameset') && WINDOW_EVENTS.has(type),
				});
				el.removeAttribute(attr.name);
			}
			if (handlers.length === 0) continue;
			const id = String(bindings.length);
			el.setAttribute('data-memorall-on', id);
			bindings.push({ id, handlers });
		}
		if (bindings.length > 0) {
			const tag = doc.createElement('script');
			tag.setAttribute('src', fileFor(handlerScript(bindings)));
			(doc.body || doc.documentElement).appendChild(tag);
			served.push(tag);
		}

		// An older service worker cannot serve them: leave them out, as before.
		if (!(await sendInlineScripts(scripts))) {
			for (const script of served) script.remove();
		}
		console.log('[renderer] inline scripts served=' + scripts.length + ' handlers=' + bindings.length);
		return (doc.doctype ? '<!DOCTYPE html>\n' : '') + doc.documentElement.outerHTML;
	};

	// ── Fetch virtual server HTML ─────────────────────────────────────────────
	try {
		const virtualPath =
			'/__virtual__/' + port + (path.startsWith('/') ? path : '/' + path);

		console.log('[renderer] fetching', virtualPath);
		const response = await fetch(virtualPath);
		console.log('[renderer] fetch response status=' + response.status);
		if (!response.ok) return;

		let html = await response.text();
		console.log('[renderer] html length=' + html.length);
		console.log('[renderer] html head (first 1000):', html.slice(0, 1000));

		html = await moveInlineCode(html);

		// Rewrite absolute-path HTML attributes to relative so <base href> routes them.
		html = html.replace(/((?:src|href|action)=)"\/(?!\/)/g, '$1"');

		// ── Inject utilities into <head> ──────────────────────────────────────
		const utilsUrl = chrome.runtime.getURL('sandbox/pages/renderer-utils.js');
		const utilsScript = '<script src="' + utilsUrl + '"><\/script>';
		const baseTag = '<base href="/__virtual__/' + port + '/">';
		const headInjection = utilsScript + baseTag;
		html = html.replace(/(<head[^>]*>)/i, '$1' + headInjection);

		window._memorallRenderId = window.name;
		console.log('[renderer] renderId=' + window._memorallRenderId + ' about to document.write');

		document.open();
		document.write(html);
		document.close();

		console.log('[renderer] after document.write — _swRelayPort=', window._swRelayPort);
	} catch (err) {
		console.error('[renderer] error:', err);
	}
})();
