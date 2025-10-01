// Wllama Runner - Local LLM inference via WebAssembly
import { reply, generateId, sendReady } from '../utils/common.js';

const WASM_PATHS = {
  'single-thread/wllama.wasm': 'https://cdn.jsdelivr.net/npm/@wllama/wllama@2.3.5/src/single-thread/wllama.wasm',
  'multi-thread/wllama.wasm': 'https://cdn.jsdelivr.net/npm/@wllama/wllama@2.3.5/src/multi-thread/wllama.wasm',
};

// Scoped state
let Wllama;
let wllama;
const loadedModels = new Map();
let loadedModel;
const activeOperations = new Map(); // Track active operations for abort support

async function ensureWllama() {
  if (Wllama) return;
  const mod = await import('../libs/wllama.js');
  Wllama = mod.Wllama || mod.default || mod;
  if (!Wllama) throw new Error('Failed to load @wllama/wllama');
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
        await ensureWllama();
        wllama = new Wllama(WASM_PATHS);
        reply(src, origin, messageId, 'complete', { status: 'initialized', mode: 'wllama' });
        break;
      }
      
      case 'models': {
        if (!wllama) throw new Error('Wllama not initialized. Call init first.');
        let downloadedModels = [];
        if (wllama && wllama.cacheManager) {
          try {
            const cacheEntries = await wllama.cacheManager.list();
            downloadedModels = cacheEntries
              .filter(entry => entry.name.endsWith('.gguf'))
              .map(entry => {
                const originURL = entry.metadata?.originalURL || '';
                const match = originURL.match(/^https:\/\/huggingface\.co\/([^\/]+\/[^\/]+)\/resolve\/main\/(.+)$/);
                const name = match ? match[1] : '';
                const filename = match ? match[2] : entry.name;
                const fullModelId = name && filename ? `${name}/${filename}` : entry.name;
                const isLoaded = loadedModel && fullModelId.toLowerCase() === loadedModel.toLowerCase();
                return {
                  id: fullModelId,
                  name: fullModelId,
                  filename,
                  loaded: !!isLoaded,
                  downloaded: true,
                  object: 'model',
                  created: Date.now(),
                  owned_by: 'local',
                  size: entry.size || 0
                };
              });
          } catch (error) {
            console.error('Failed to get cached models:', error);
          }
        }
        if (downloadedModels.length === 0 && wllama && wllama.currentModel && wllama.isModelLoaded) {
          const currentModelName = wllama.currentModel.name || 'unknown';
          const modelId = currentModelName.replace('.gguf', '').replace(/_/g, '/');
          downloadedModels = [{ id: modelId, name: modelId, loaded: true, downloaded: true, object: 'model', created: Date.now(), owned_by: 'local' }];
        }
        reply(src, origin, messageId, 'complete', { object: 'list', data: downloadedModels });
        break;
      }
      
      case 'serve': {
        if (!wllama) throw new Error('Wllama not initialized. Call init first.');
        const { model } = payload || {};
        if (!model) throw new Error('Model name is required');
        
        // Parse model name format: username/repo/filename
        const parts = model.split('/');
        if (parts.length < 3) {
          throw new Error('Model name must be in format: username/repo/filename');
        }
        
        const modelId = model; // Use full 3-part name
        
        // Progress callback for model loading
        const progressCallback = (progress) => {
          const { loaded, total } = progress;
          const percent = Math.max(0, Math.min(100, Math.round((loaded / (total || 1)) * 100)));
          reply(src, origin, messageId, 'progress', { loaded, total, percent, text: '' });
        };

        try {
          await wllama.loadModelFromUrl(
            `https://huggingface.co/${parts[0]}/${parts[1]}/resolve/main/${parts[2]}`,
            { progressCallback }
          );

          const modelInfo = { 
            id: modelId, 
            object: 'model', 
            created: Math.floor(Date.now() / 1000), 
            owned_by: 'wllama', 
            permission: [], 
            root: modelId, 
            parent: null, 
            loaded: true,
            downloaded: true
          };
          
          loadedModel = modelId;
          loadedModels.set(modelId, modelInfo);
          reply(src, origin, messageId, 'complete', modelInfo);
        } catch (error) {
          reply(src, origin, messageId, 'error', {
            error: {
              message: `Failed to load model: ${error.message}`,
              type: 'ModelLoadError',
              code: null
            }
          });
        }
        break;
      }
      
      case 'chat/completions': {
        if (!wllama) throw new Error('Wllama not initialized. Call init first.');
        if (!loadedModel) throw new Error('No model loaded. Call serve first.');

        const { messages, model, stream = false, max_tokens = 512, temperature = 0.8, top_p = 0.9, top_k = 40, stop } = payload || {};
        if (!messages) throw new Error('Messages are required');

        // Create abort controller for this operation
        const abortController = new AbortController();
        activeOperations.set(messageId, { abortController });

        // Convert OpenAI format to wllama format
        const wllamaMessages = messages.map(msg => ({ role: msg.role, content: msg.content }));
        try {
          // Map OpenAI options to wllama options
          const wllamaOptions = {
            nPredict: typeof max_tokens === 'number' ? max_tokens : 256,
            sampling: {
              temp: typeof temperature === 'number' ? temperature : 0.7,
              top_p: typeof top_p === 'number' ? top_p : 0.9,
              top_k: typeof top_k === 'number' ? top_k : 40,
            },
          };
          if (stop) {
            // wllama expects stopSequence as string[]
            wllamaOptions.stopSequence = Array.isArray(stop) ? stop : [stop];
          }

          if (stream) {
            const responseId = `chatcmpl-${generateId()}`;
            let content = '';
            
            await wllama.createChatCompletion(wllamaMessages, {
              ...wllamaOptions,
              onNewToken: (_token, piece, currentText) => {
                // Check if aborted before processing token
                if (abortController.signal.aborted) {
                  throw new Error('Operation aborted');
                }
                
                // piece is decoded token string; currentText is full text so far
                const deltaText = typeof currentText === 'string'
                  ? currentText.slice(content.length)
                  : (typeof piece === 'string' ? piece : String(piece ?? ''));
                if (!deltaText) return;
                content += deltaText;
                const chunk = {
                  id: responseId,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: model || 'wllama-local',
                  choices: [{
                    index: 0,
                    delta: { content: deltaText },
                    finish_reason: null
                  }]
                };
                reply(src, origin, messageId, 'stream_chunk', chunk);
              }
            });

            // Send final chunk
            const finalChunk = {
              id: responseId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: model || 'wllama-local',
              choices: [{
                index: 0,
                delta: {},
                finish_reason: 'stop'
              }]
            };
            reply(src, origin, messageId, 'stream_end', finalChunk);
          } else {
            const text = await wllama.createChatCompletion(wllamaMessages, wllamaOptions);
            const response = { 
              id: `chatcmpl-${generateId()}`, 
              object: 'chat.completion', 
              created: Math.floor(Date.now() / 1000), 
              model: model || 'wllama-local', 
              choices: [{ 
                index: 0, 
                message: { role: 'assistant', content: text || '' }, 
                finish_reason: 'stop' 
              }], 
              usage: { prompt_tokens: -1, completion_tokens: -1, total_tokens: -1 } 
            };
            reply(src, origin, messageId, 'complete', response);
          }
        } catch (error) {
          console.error('Wllama error:', error);
          throw error;
        } finally {
          activeOperations.delete(messageId);
        }
        break;
      }
      
      case 'unload': {
        const { model } = payload || {};
        if (!model) throw new Error('Model name is required');
        
        const parts = model.split('/');
        if (parts.length < 3) {
          throw new Error('Model name must be in format: username/repo/filename');
        }
        
        const modelId = model;
        if (!loadedModels.has(modelId)) throw new Error(`Model ${modelId} is not loaded`);
        
        await wllama?.exit();
        wllama = null;
        await ensureWllama();
        wllama = new Wllama(WASM_PATHS);
        const modelInfo = loadedModels.get(modelId);
        if (modelInfo) { modelInfo.loaded = false; loadedModels.set(modelId, modelInfo); }
        loadedModel = undefined;
        reply(src, origin, messageId, 'complete', { status: 'unloaded', model: modelId });
        break;
      }
      
      case 'delete': {
        const { model } = payload || {};
        if (!model) throw new Error('Model name is required');
        
        const parts = model.split('/');
        if (parts.length < 3) {
          throw new Error('Model name must be in format: username/repo/filename');
        }
        
        const modelId = model;
        if (loadedModels.has(modelId)) {
          await wllama?.exit();
          wllama = null;
          await ensureWllama();
          wllama = new Wllama(WASM_PATHS);
        }
        loadedModels.delete(modelId);
        reply(src, origin, messageId, 'complete', { status: 'deleted', model: modelId });
        break;
      }
      
      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    console.error('Wllama error:', error);
    reply(src, origin, messageId, 'error', {
      error: {
        message: error.message || 'Unknown error',
        type: error.constructor.name || 'Error',
        code: null
      }
    });
  }
});

const endpoints = ['init', 'serve', 'models', 'chat/completions', 'unload', 'delete'];
sendReady('wllama', endpoints);

console.log('Wllama runner initialized');
