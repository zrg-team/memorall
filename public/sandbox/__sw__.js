/**
 * Service Worker for Mini WebContainers
 * Intercepts fetch requests and routes them to virtual servers
 * Version: 15 - cleanup: extract helpers, gate debug logs, remove test endpoints
 */

const DEBUG = false;

// Communication port with main thread
let mainPort = null;

// Pending requests waiting for response
const pendingRequests = new Map();
let requestId = 0;

// Registered virtual server ports
const registeredPorts = new Set();

// Import maps for bare-specifier rewriting, keyed by virtual server port.
// Populated via 'set-import-map' message from renderViaIframe.
const portImportMaps = new Map();

function toProxyModulePath(port, remoteUrl) {
  return `/__virtual__/${port}/__npm_proxy__/${encodeURIComponent(remoteUrl)}`;
}

function resolveRemoteModuleSpecifier(specifier, remoteUrl) {
  if (
    specifier.startsWith('/__virtual__/') ||
    specifier.startsWith('chrome-extension://') ||
    specifier.startsWith('data:') ||
    specifier.startsWith('blob:')
  ) {
    return null;
  }
  if (specifier.startsWith('/')) {
    return new URL(specifier, remoteUrl).href;
  }
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return new URL(specifier, remoteUrl).href;
  }
  if (specifier.startsWith('https://esm.sh/')) {
    return specifier;
  }
  return null;
}

function rewriteSpecifier(specifier, importMap) {
  return importMap[specifier] || specifier;
}

function getHeaderCaseInsensitive(headers, name) {
  if (!headers || typeof headers !== 'object') {
    return undefined;
  }
  const target = String(name).toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === target) {
      return value;
    }
  }
  return undefined;
}

function sanitizeSynthesizedResponseHeaders(headers) {
  const responseHeaders = new Headers(headers || {});
  // We rebuild the body in the SW, so upstream transport/size headers are stale.
  responseHeaders.delete('content-length');
  responseHeaders.delete('Content-Length');
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('Content-Encoding');
  responseHeaders.delete('transfer-encoding');
  responseHeaders.delete('Transfer-Encoding');
  responseHeaders.delete('X-Frame-Options');
  responseHeaders.set('Cross-Origin-Embedder-Policy', 'credentialless');
  responseHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
  responseHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');
  return responseHeaders;
}

/**
 * Rewrite bare module specifiers (e.g. "react/jsx-runtime") in JS source.
 * Handles:
 * - import ... from "spec"
 * - export ... from "spec"
 * - import "spec"
 * - import("spec")
 */
function rewriteBareSpecifiers(code, importMap) {
  let rewritten = code;

  rewritten = rewritten.replace(
    /\b(from)\s+(['"])((?!\/|\.\/|\.\.\/|https?:\/\/)[^'"]+)\2/g,
    (match, keyword, quote, specifier) => `${keyword} ${quote}${rewriteSpecifier(specifier, importMap)}${quote}`
  );

  rewritten = rewritten.replace(
    /\b(import)\s+(['"])((?!\/|\.\/|\.\.\/|https?:\/\/)[^'"]+)\2/g,
    (match, keyword, quote, specifier) => `${keyword} ${quote}${rewriteSpecifier(specifier, importMap)}${quote}`
  );

  rewritten = rewritten.replace(
    /\bimport\s*\(\s*(['"])((?!\/|\.\/|\.\.\/|https?:\/\/)[^'"]+)\1\s*\)/g,
    (match, quote, specifier) => `import(${quote}${rewriteSpecifier(specifier, importMap)}${quote})`
  );

  return rewritten;
}

function rewriteRemoteModuleImports(code, port, remoteUrl) {
  const rewriteResolved = (specifier) => {
    const resolved = resolveRemoteModuleSpecifier(specifier, remoteUrl);
    return resolved ? toProxyModulePath(port, resolved) : specifier;
  };

  let rewritten = code;

  rewritten = rewritten.replace(
    /\b(from)\s*(['"])([^'"]+)\2/g,
    (match, keyword, quote, specifier) => `${keyword} ${quote}${rewriteResolved(specifier)}${quote}`
  );

  rewritten = rewritten.replace(
    /\b(import)\s*(['"])([^'"]+)\2/g,
    (match, keyword, quote, specifier) => `${keyword} ${quote}${rewriteResolved(specifier)}${quote}`
  );

  rewritten = rewritten.replace(
    /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
    (match, quote, specifier) => `import(${quote}${rewriteResolved(specifier)}${quote})`
  );

  rewritten = rewritten.replace(
    /((?:import|export)[^'"\n\r]*?\bfrom)\s*(['"])([^'"]+)\2/g,
    (match, prefix, quote, specifier) => `${prefix} ${quote}${rewriteResolved(specifier)}${quote}`
  );

  return rewritten;
}

function shouldRewriteModule(path, text) {
  if (/\.(?:[cm]?[jt]sx?|vue|svelte)(?:\?.*)?$/i.test(path)) {
    return true;
  }
  return /\b(?:import|export)\b/.test(text);
}

/**
 * Decode base64 string to Uint8Array
 */
function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const previewRelayChannel = typeof BroadcastChannel === 'undefined'
  ? null
  : new BroadcastChannel('memorall-sandbox-preview-relay');
if (previewRelayChannel) {
  previewRelayChannel.onmessage = handleMainMessage;
}

function sendRequestThroughBroadcastRelay(port, method, url, headers, body) {
  if (!previewRelayChannel) {
    return Promise.reject(new Error('Sandbox preview BroadcastChannel is unavailable'));
  }
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const timeoutId = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Sandbox preview request timed out: ${method} ${url}`));
    }, 120000);
    pendingRequests.set(id, {
      resolve: (data) => {
        clearTimeout(timeoutId);
        resolve(data);
      },
      reject: (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    });
    previewRelayChannel.postMessage({
      type: 'request',
      id,
      data: { port, method, url, headers, body },
    });
  });
}

/**
 * Handle messages from main thread
 */
self.addEventListener('message', (event) => {
  const { type, data } = event.data;

  DEBUG && console.log('[SW] Received message:', type, 'hasPort in event.ports:', event.ports?.length > 0);

  // When a MessagePort is transferred, it's in event.ports[0], not event.data.port
  if (type === 'init' && event.ports && event.ports[0]) {
    // Initialize communication channel
    mainPort = event.ports[0];
    mainPort.onmessage = handleMainMessage;
	mainPort.start();
	mainPort.postMessage({ type: 'relay-ready' });
    DEBUG && console.log('[SW] Initialized communication channel with transferred port');
    // Re-claim clients so that pages opened after SW activation get controlled.
    // Without this, controllerchange never fires for late-arriving pages.
    self.clients.claim();
    // Keep the SW alive after init so the renderer iframe's first fetch can
    // reach mainPort. Without this, Chrome kills the idle SW immediately after
    // the message handler returns, clearing mainPort before the fetch arrives.
    event.waitUntil(new Promise(resolve => setTimeout(resolve, 30_000)));
  }

  // Keepalive ping from the outer page (sent every 20 s). Extend lifetime so
  // Chrome does not kill the SW between pings.
  if (type === 'keepalive') {
    event.waitUntil(new Promise(resolve => setTimeout(resolve, 25_000)));
  }

  if (type === 'server-registered' && data) {
    registeredPorts.add(data.port);
    DEBUG && console.log(`[SW] Server registered on port ${data.port}`);
  }

  if (type === 'server-unregistered' && data) {
    registeredPorts.delete(data.port);
    DEBUG && console.log(`[SW] Server unregistered from port ${data.port}`);
  }

  if (type === 'set-import-map' && data) {
    portImportMaps.set(data.port, data.importMap);
    DEBUG && console.log(`[SW] Import map registered for port ${data.port}:`, Object.keys(data.importMap));
  }
});

/**
 * Handle response messages from main thread
 */
function handleMainMessage(event) {
  const { type, id, data, error } = event.data;

  DEBUG && console.log('[SW] Received message from main:', type, 'id:', id);

  if (type === 'response') {
    const pending = pendingRequests.get(id);
    DEBUG && console.log('[SW] Looking for pending request:', id, 'found:', !!pending);

    if (pending) {
      pendingRequests.delete(id);

      if (error) {
        DEBUG && console.log('[SW] Response error:', error);
        pending.reject(new Error(error));
      } else {
        DEBUG && console.log('[SW] Response data:', {
          statusCode: data?.statusCode,
          statusMessage: data?.statusMessage,
          headers: data?.headers,
          bodyType: data?.body?.constructor?.name,
          bodyLength: data?.body?.length || data?.body?.byteLength,
        });
        pending.resolve(data);
      }
    }
  }

  // Handle streaming responses
  if (type === 'stream-start') {
    DEBUG && console.log('[SW] stream-start received, id:', id);
    const pending = pendingRequests.get(id);
    if (pending && pending.streamController) {
      // Store headers/status for the streaming response
      pending.streamData = data;
      pending.resolveHeaders(data);
      DEBUG && console.log('[SW] headers resolved for stream', id);
    } else {
      DEBUG && console.log('[SW] No pending request or controller for stream-start', id, !!pending, pending?.streamController);
    }
  }

  if (type === 'stream-chunk') {
    DEBUG && console.log('[SW] stream-chunk received, id:', id, 'size:', data?.chunkBase64?.length);
    const pending = pendingRequests.get(id);
    if (pending && pending.streamController) {
      try {
        // Decode base64 chunk and enqueue
        if (data.chunkBase64) {
          const bytes = base64ToBytes(data.chunkBase64);
          pending.streamController.enqueue(bytes);
          DEBUG && console.log('[SW] chunk enqueued, bytes:', bytes.length);
        }
      } catch (e) {
        console.error('[SW] Error enqueueing chunk:', e);
      }
    } else {
      DEBUG && console.log('[SW] No pending request or controller for stream-chunk', id);
    }
  }

  if (type === 'stream-end') {
    DEBUG && console.log('[SW] stream-end received, id:', id);
    const pending = pendingRequests.get(id);
    if (pending && pending.streamController) {
      try {
        pending.streamController.close();
        DEBUG && console.log('[SW] stream closed');
      } catch (e) {
        DEBUG && console.log('[SW] stream already closed');
      }
      pendingRequests.delete(id);
    }
  }
}

/**
 * Send request to main thread and wait for response
 */
async function sendRequest(port, method, url, headers, body) {
  DEBUG && console.log('[SW] sendRequest called, mainPort:', !!mainPort, 'url:', url);

  if (!mainPort) {
    // Ask all clients (including offscreen documents, which are uncontrolled
    // because they live outside the /sandbox/ scope) to re-send the init port.
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      client.postMessage({ type: 'sw-needs-init' });
    }
    return sendRequestThroughBroadcastRelay(port, method, url, headers, body);
  }

  const id = ++requestId;

  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });

    // Set timeout for request (120 s — Vite first-compile can take 30–60 s)
    // setTimeout(() => {
    //   if (pendingRequests.has(id)) {
    //     pendingRequests.delete(id);
    //     reject(new Error('Request timeout'));
    //   }
    // }, 120000);

    mainPort.postMessage({
      type: 'request',
      id,
      data: { port, method, url, headers, body },
    });
  });
}

/**
 * Send streaming request to main thread
 * Returns a ReadableStream that receives chunks from main thread
 */
async function sendStreamingRequest(port, method, url, headers, body) {
  DEBUG && console.log('[SW] sendStreamingRequest called, url:', url);

  if (!mainPort) {
    // Ask all clients (including offscreen documents, which are uncontrolled
    // because they live outside the /sandbox/ scope) to re-send the init port.
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      client.postMessage({ type: 'sw-needs-init' });
    }
    const result = await sendRequestThroughBroadcastRelay(
      port,
      method,
      url,
      headers,
      body,
    );
    const bytes = result.bodyBase64
      ? base64ToBytes(result.bodyBase64)
      : new TextEncoder().encode(result.body || '');
    const stream = new ReadableStream({
      start(controller) {
        if (bytes.length > 0) controller.enqueue(bytes);
        controller.close();
      },
    });
    return {
      stream,
      headersPromise: Promise.resolve(result),
      id: requestId,
    };
  }

  const id = ++requestId;

  let streamController;
  let resolveHeaders;
  const headersPromise = new Promise(resolve => { resolveHeaders = resolve; });

  const stream = new ReadableStream({
    start(controller) {
      streamController = controller;

      // Store in pending requests so handleMainMessage can find it
      pendingRequests.set(id, {
        resolve: () => {},
        reject: (err) => controller.error(err),
        streamController: controller,
        resolveHeaders,
      });

      // Send request to main thread with streaming flag
      mainPort.postMessage({
        type: 'request',
        id,
        data: { port, method, url, headers, body, streaming: true },
      });
    },
    cancel() {
      pendingRequests.delete(id);
    }
  });

  return { stream, headersPromise, id };
}

/**
 * Intercept fetch requests
 */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  DEBUG && console.log('[SW] Fetch:', url.pathname, 'mainPort:', !!mainPort);

  // Check if this is a virtual server request
  const match = url.pathname.match(/^\/__virtual__\/(\d+)(\/.*)?$/);

  if (!match) {
    // Not a virtual request - but check if it's from a virtual context
    // This handles plain <a href="/about"> links and asset requests (images, scripts)
    // that should stay within the virtual server
    const referer = event.request.referrer;
    if (referer) {
      try {
        const refererUrl = new URL(referer);
        const refererMatch = refererUrl.pathname.match(/^\/__virtual__\/(\d+)/);
        if (refererMatch) {
          // Request from within a virtual server context
          const virtualPrefix = refererMatch[0];
          const virtualPort = parseInt(refererMatch[1], 10);
          const targetPath = url.pathname + url.search;

          if (event.request.mode === 'navigate') {
            // Navigation requests: redirect to include the virtual prefix
            const redirectUrl = url.origin + virtualPrefix + targetPath;
            DEBUG && console.log('[SW] Redirecting navigation from virtual context:', url.pathname, '->', redirectUrl);
            event.respondWith(Response.redirect(redirectUrl, 302));
            return;
          } else {
            // Non-navigation requests (images, scripts, etc.): forward to virtual server
            DEBUG && console.log('[SW] Forwarding resource from virtual context:', url.pathname);
            event.respondWith(handleVirtualRequest(event.request, virtualPort, targetPath));
            return;
          }
        }
      } catch (e) {
        // Invalid referer URL, ignore
      }
    }
    // Not a virtual request, let it pass through
    return;
  }

  DEBUG && console.log('[SW] Virtual request:', url.pathname);

  const port = parseInt(match[1], 10);
  const path = match[2] || '/';

  event.respondWith(handleVirtualRequest(event.request, port, path + url.search));
});

/**
 * Handle a request to a virtual server
 */
async function handleVirtualRequest(request, port, path) {
  try {
    if (path.startsWith('/__npm_proxy__/')) {
      return handleProxyModuleRequest(port, path);
    }

    // Build headers object
    const headers = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    // Get body if present
    let body = null;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      body = await request.arrayBuffer();
    }

    // Check if this is an API route that might stream (POST to /api/*)
    const isStreamingCandidate = request.method === 'POST' && path.startsWith('/api/');

    if (isStreamingCandidate) {
      DEBUG && console.log('[SW] Using streaming mode for:', path);
      return handleStreamingRequest(port, request.method, path, headers, body);
    }
    DEBUG && console.log('[SW] Using non-streaming mode for:', request.method, path);

    // Send to main thread
    const response = await sendRequest(port, request.method, path, headers, body);

    DEBUG && console.log('[SW] Got response from main thread:', {
      statusCode: response.statusCode,
      headersKeys: response.headers ? Object.keys(response.headers) : [],
      bodyBase64Length: response.bodyBase64?.length,
    });

    // Decode base64 body and create response
    let finalResponse;
    if (response.bodyBase64 && response.bodyBase64.length > 0) {
      try {
        let bytes = base64ToBytes(response.bodyBase64);
        DEBUG && console.log('[SW] Decoded body length:', bytes.length);

        // Rewrite bare module specifiers when we have an import map for this port.
        // Do not rely on Content-Type here; virtual servers sometimes omit it for
        // transformed modules, and we still need to rewrite imports before the
        // browser evaluates the module source.
        if (portImportMaps.has(port)) {
          const text = new TextDecoder().decode(bytes);
          if (shouldRewriteModule(path, text)) {
            const rewritten = rewriteBareSpecifiers(text, portImportMaps.get(port));
            if (rewritten !== text) {
              bytes = new TextEncoder().encode(rewritten);
              DEBUG && console.log('[SW] Rewrote bare specifiers in', path);
            }
          }
        }

        const contentType =
          getHeaderCaseInsensitive(response.headers, 'content-type') ||
          'application/octet-stream';
        const blob = new Blob([bytes], { type: contentType });
        DEBUG && console.log('[SW] Created blob size:', blob.size);

        // Merge response headers with CORP/COEP headers to allow iframe embedding.
        const respHeaders = sanitizeSynthesizedResponseHeaders(response.headers);
        respHeaders.set('Content-Type', contentType);

        finalResponse = new Response(blob, {
          status: response.statusCode,
          statusText: response.statusMessage,
          headers: respHeaders,
        });
      } catch (decodeError) {
        console.error('[SW] Failed to decode base64 body:', decodeError);
        finalResponse = new Response(`Decode error: ${decodeError.message}`, {
          status: 500,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    } else {
      const respHeaders = sanitizeSynthesizedResponseHeaders(response.headers);
      finalResponse = new Response(null, {
        status: response.statusCode,
        statusText: response.statusMessage,
        headers: respHeaders,
      });
    }

    DEBUG && console.log('[SW] Final Response created, status:', finalResponse.status);

    return finalResponse;
  } catch (error) {
    console.error('[SW] Error handling virtual request:', error);
    return new Response(`Service Worker Error: ${error.message}`, {
      status: 500,
      statusText: 'Internal Server Error',
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

async function handleProxyModuleRequest(port, path) {
  try {
    const encodedUrl = path.slice('/__npm_proxy__/'.length).split('?')[0];
    const remoteUrl = decodeURIComponent(encodedUrl);
    const remoteResponse = await fetch(remoteUrl);

    if (!remoteResponse.ok) {
      return new Response(`Module proxy fetch failed: ${remoteResponse.status} ${remoteResponse.statusText}`, {
        status: remoteResponse.status,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    const contentType = remoteResponse.headers.get('content-type') || 'application/javascript; charset=utf-8';
    const text = await remoteResponse.text();
    const rewritten = rewriteRemoteModuleImports(text, port, remoteUrl);

    return new Response(rewritten, {
      status: remoteResponse.status,
      statusText: remoteResponse.statusText,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
        'Cross-Origin-Embedder-Policy': 'credentialless',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      },
    });
  } catch (error) {
    return new Response(`Module proxy error: ${error.message}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

/**
 * Handle a streaming request
 */
async function handleStreamingRequest(port, method, path, headers, body) {
  const { stream, headersPromise, id } = await sendStreamingRequest(port, method, path, headers, body);

  // Wait for headers to arrive
  const responseData = await headersPromise;

  DEBUG && console.log('[SW] Streaming response started:', responseData?.statusCode);

  // Build response headers
  const respHeaders = new Headers(responseData?.headers || {});
  respHeaders.set('Cross-Origin-Embedder-Policy', 'credentialless');
  respHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
  respHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');
  respHeaders.delete('X-Frame-Options');

  return new Response(stream, {
    status: responseData?.statusCode || 200,
    statusText: responseData?.statusMessage || 'OK',
    headers: respHeaders,
  });
}

/**
 * Activate immediately
 */
self.addEventListener('install', (event) => {
  DEBUG && console.log('[SW] Installing...');
  event.waitUntil(self.skipWaiting());
});

/**
 * Claim all clients immediately
 */
self.addEventListener('activate', (event) => {
  DEBUG && console.log('[SW] Activated');
  event.waitUntil(self.clients.claim());
});
