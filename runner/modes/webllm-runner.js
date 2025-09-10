// WebLLM Runner - WebGPU-accelerated chat completions via WebLLM
import { reply, generateId, sendReady } from '../utils/common.js';

// Scoped state
let WebLLMEngine;
let WebLLMMod;
let prebuiltAppConfig;
let webllmEngine;
const loadedModels = new Map();
let loadedModel;
const activeOperations = new Map(); // Track active operations for abort support

// Query downloaded status via WebLLM engine APIs when available
async function isDownloaded(modelId) {
  try {
    if (WebLLMMod && typeof WebLLMMod.hasModelInCache === 'function') {
      return await WebLLMMod.hasModelInCache(modelId);
    }
    if (webllmEngine && typeof webllmEngine.hasModelInCache === 'function') {
      return await webllmEngine.hasModelInCache(modelId);
    }
  } catch (e) {
    console.warn('[downloaded] hasModelInCache error:', e?.message || e);
  }
  return false;
}

async function ensureWebLLM() {
  if (WebLLMEngine) return;
  try {
    console.log('Loading WebLLM module...');

    // Help WebLLM avoid worker creation in iframe contexts
    if (typeof window !== 'undefined') {
      window.__WEBLLM_NO_WORKER__ = true;
    }

    // Try multiple CDN sources
    let mod;
    const cdnSources = [
      'https://esm.run/@mlc-ai/web-llm'
    ];

    for (const source of cdnSources) {
      try {
        console.log(`Trying WebLLM from: ${source}`);
        mod = await import(source);
        console.log(`Successfully loaded from: ${source}`);
        break;
      } catch (cdnError) {
        console.warn(`Failed to load from ${source}:`, cdnError.message);
        continue;
      }
    }

    if (!mod) throw new Error('Failed to load WebLLM from any CDN source');
    console.log('WebLLM module loaded successfully', mod);
    WebLLMMod = mod;

    if (!mod.MLCEngine) {
      throw new Error('MLCEngine export not found');
    }
    WebLLMEngine = mod.MLCEngine;

    prebuiltAppConfig = mod.prebuiltAppConfig || mod.prebuiltAppConfigV2 || mod.prebuiltConfig || null;
    if (!prebuiltAppConfig) {
      // Build a minimal config if not available
      prebuiltAppConfig = { model_list: [] };
    }

    // Do not create engine here; create per-serve with progress callback
  } catch (e) {
    console.error('WebLLM load error:', e);
    throw e;
  }
}

window.addEventListener('message', async (event) => {
  const src = event.source;
  const origin = event.origin;
  const { messageId, type, payload } = event.data || {};

  try {
    switch (type) {
      case 'abort': {
        const operation = activeOperations.get(messageId);
        if (operation && operation.abortController) {
          operation.abortController.abort();
          activeOperations.delete(messageId);
        }
        return; // Don't reply for abort messages
      }
      case 'init': {
        await ensureWebLLM();
        reply(src, origin, messageId, 'complete', { status: 'initialized', mode: 'webllm' });
        break;
      }
      case 'models': {
        await ensureWebLLM();
        const list = prebuiltAppConfig?.model_list || [];
        const models = await Promise.all(list.map(async (m) => {
          const id = m.model_id || m.model || m.name || 'unknown';
          const downloaded = await isDownloaded(id);
          return {
            id,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'webllm',
            permission: [],
            root: id,
            parent: null,
            loaded: loadedModels.get(id)?.loaded || false,
            downloaded
          };
        }));
        reply(src, origin, messageId, 'complete', { object: 'list', data: models });
        break;
      }
      case 'serve': {
        await ensureWebLLM();
        const { model } = payload || {};
        if (!model) throw new Error('Model name is required');

        // Validate against prebuilt config if present
        const modelEntry = (prebuiltAppConfig?.model_list || []).find((m) => {
          const id = m.model_id || m.model || m.name;
          return id === model;
        });

        if (!modelEntry && prebuiltAppConfig?.model_list?.length) {
          throw new Error(`Model ${model} not found in WebLLM prebuilt config`);
        }

        // Prepare progress reporting
        let lastPercent = 0;
        const reportProgress = (loaded, total, text) => {
          const percent = Math.max(0, Math.min(100, Math.round((loaded / (total || 1)) * 100)));
          if (percent !== lastPercent) {
            lastPercent = percent;
            reply(src, origin, messageId, 'progress', { loaded, total, percent, text });
          }
        };

        try {
          // Clean current engine if exists
          if (webllmEngine && typeof webllmEngine.unload === 'function') {
            try { await webllmEngine.unload(); } catch (e) { console.warn('[serve] unload previous engine error:', e?.message || e); }
          }

          // Create a fresh engine with progress callback and load model
          webllmEngine = new WebLLMEngine({
            initProgressCallback: (progressData) => {
              const { progress, text } = progressData || {};
              reportProgress(progress, 1, text)
            }
          });
          if (typeof webllmEngine.reload !== 'function') {
            const caps = { hasReload: typeof webllmEngine.reload, hasUnload: typeof webllmEngine.unload };
            console.error('MLCEngine lacks reload. Capabilities:', caps);
            throw new Error('MLCEngine.reload is not available');
          }
          await webllmEngine.reload(model);

          const modelInfo = {
            id: model,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'webllm',
            permission: [],
            root: model,
            parent: null,
            loaded: true,
            downloaded: await isDownloaded(model)
          };
          loadedModel = model;
          loadedModels.set(model, modelInfo);
          reply(src, origin, messageId, 'complete', modelInfo);
        } catch (error) {
          console.error('[serve] load error:', error);
          reply(src, origin, messageId, 'error', {
            error: { message: `Failed to load model: ${error?.message || String(error)}`, type: 'ModelLoadError', code: null }
          });
        }
        break;
      }
      case 'chat/completions': {
        await ensureWebLLM();
        if (!webllmEngine) throw new Error('WebLLM engine not initialized or incompatible');

        const { messages, model, stream = false, max_tokens = 512, temperature = 0.8, top_p = 0.9 } = payload || {};
        if (!messages) throw new Error('Messages are required');

        // Create abort controller for this operation
        const abortController = new AbortController();
        activeOperations.set(messageId, { abortController });

        const requestOptions = {
          messages,
          model: model || loadedModel,
          temperature,
          top_p,
          max_tokens,
          signal: abortController.signal
        };

        try {
          if (stream) {
            const completionId = `chatcmpl-${generateId()}`;
            let isFirst = true;
            let streamIt;
            if (typeof webllmEngine.chatCompletion === 'function') {
              streamIt = await webllmEngine.chatCompletion({ ...requestOptions, stream: true });
            } else if (webllmEngine?.chat?.completions?.create) {
              streamIt = await webllmEngine.chat.completions.create({ ...requestOptions, stream: true });
            } else {
              throw new Error('No supported streaming API');
            }
            
            for await (const chunk of streamIt) {
              // Check if aborted before processing each chunk
              if (abortController.signal.aborted) {
                throw new Error('Operation aborted');
              }
              
              if (!chunk?.choices?.length) continue;
              const choice = chunk.choices[0];
              const delta = choice?.delta || {};
              const webllmChunk = {
                id: completionId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: model || 'webllm-local',
                choices: [{
                  index: 0,
                  delta: {
                    role: isFirst ? 'assistant' : undefined,
                    content: delta.content || ''
                  },
                  finish_reason: choice.finish_reason
                }]
              };
              reply(src, origin, messageId, 'stream_chunk', webllmChunk);
              isFirst = false;
              if (choice.finish_reason) break;
            }

            const finalChunk = {
              id: completionId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: model || 'webllm-local',
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
            };
            reply(src, origin, messageId, 'stream_end', finalChunk);
          } else {
            let response;
            if (typeof webllmEngine.chatCompletion === 'function') {
              response = await webllmEngine.chatCompletion({ ...requestOptions, stream: false });
            } else if (webllmEngine?.chat?.completions?.create) {
              response = await webllmEngine.chat.completions.create(requestOptions);
            } else {
              throw new Error('No supported completion API');
            }
            const openaiResponse = {
              id: `chatcmpl-${generateId()}`,
              object: 'chat.completion',
              created: Math.floor(Date.now() / 1000),
              model: model || 'webllm-local',
              choices: [{
                index: 0,
                message: { role: 'assistant', content: response.choices?.[0]?.message?.content || '' },
                finish_reason: response.choices?.[0]?.finish_reason || 'stop'
              }],
              usage: response.usage || { prompt_tokens: -1, completion_tokens: -1, total_tokens: -1 }
            };
            reply(src, origin, messageId, 'complete', openaiResponse);
          }
        } catch (error) {
          console.error('WebLLM error:', error);
          throw error;
        } finally {
          activeOperations.delete(messageId);
        }
        break;
      }
      case 'unload': {
        const { model } = payload || {};
        if (!model) throw new Error('Model name is required');
        if (!loadedModels.has(model)) throw new Error(`Model ${model} is not loaded`);
        try {
          webllmEngine = new WebLLMEngine();
        } catch (error) {
          console.error('Error reinitializing WebLLM engine:', error);
        }
        const modelInfo = loadedModels.get(model);
        if (modelInfo) { modelInfo.loaded = false; loadedModels.set(model, modelInfo); }
        loadedModel = undefined;
        reply(src, origin, messageId, 'complete', { status: 'unloaded', model });
        break;
      }
      case 'delete': {
        const { model } = payload || {};
        if (!model) throw new Error('Model name is required');
        if (loadedModels.has(model)) {
          try {
            webllmEngine = new WebLLMEngine();
          } catch (error) {
            console.error('Error reinitializing WebLLM engine:', error);
          }
        }
        loadedModels.delete(model);
        reply(src, origin, messageId, 'complete', { status: 'deleted', model });
        break;
      }
      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (err) {
    console.error('WebLLM error:', err);
    reply(src, origin, messageId, 'error', {
      error: { message: (err && err.message) || 'Unknown error', type: 'invalid_request_error', code: null }
    });
  }
});

const endpoints = ['init', 'serve', 'models', 'chat/completions', 'unload', 'delete'];
sendReady('webllm', endpoints);
