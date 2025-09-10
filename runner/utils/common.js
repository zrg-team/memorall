// Common utilities shared across all runners

export function reply(src, origin, messageId, type, payload) {
  src.postMessage({ messageId, type, payload }, origin || '*');
}

export function generateId() {
  return `model-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

export function sendReady(mode, endpoints) {
  const readyPayload = { status: 'ready', mode, endpoints };
  try { 
    window.opener && window.opener.postMessage({ 
      messageId: 'RUNNER_READY', 
      type: 'ready', 
      payload: readyPayload 
    }, '*'); 
  } catch {}
  try { 
    window.parent && window.parent.postMessage({ 
      messageId: 'RUNNER_READY', 
      type: 'ready', 
      payload: readyPayload 
    }, '*'); 
  } catch {}
}