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

		// Strip inline <script> blocks that have no src= — CSP blocks them; renderer-utils.js provides stubs.
		// Import maps are sent to the service worker out-of-band, so inline import maps are removed too.
		html = html.replace(/<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script>/gi, '');

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
