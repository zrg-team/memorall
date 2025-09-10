// OpenAI-compatible Runner
// Supports three modes:
// - wllama: local chat completions (existing)
// - embedding: text embeddings via @huggingface/transformers
// - webllm: WebGPU-accelerated chat completions via WebLLM

let mode = 'wllama'; // 'wllama' | 'embedding' | 'webllm'
const params = new URLSearchParams(self.location ? self.location.search : '');
try {
  const m = params.get('mode');
  if (m === 'embedding') mode = 'embedding';
  if (m === 'webllm') mode = 'webllm';
} catch {
}

const WASM_PATHS = {
  'single-thread/wllama.wasm': 'https://cdn.jsdelivr.net/npm/@wllama/wllama@2.3.5/src/single-thread/wllama.wasm',
  'multi-thread/wllama.wasm': 'https://cdn.jsdelivr.net/npm/@wllama/wllama@2.3.5/src/multi-thread/wllama.wasm',
};

function reply(src, origin, messageId, type, payload) {
  src.postMessage({ messageId, type, payload }, origin || '*');
}

function generateId() {
  return `model-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

function setupWllamaRunner() {
  // Scoped state
  let Wllama;
  let wllama;
  const loadedModels = new Map();
  let loadedModel;

  async function ensureWllama() {
    if (Wllama) return;
    const mod = await import('https://cdn.jsdelivr.net/npm/@wllama/wllama@2.3.5/esm/index.min.js');
    Wllama = mod.Wllama || mod.default || mod;
    if (!Wllama) throw new Error('Failed to load @wllama/wllama');
  }
  window.addEventListener('message', async (event) => {
    const src = event.source;
    const origin = event.origin;
    const { messageId, type, payload } = event.data || {};
    try {
      switch (type) {
        case 'init': {
          await ensureWllama();
          wllama = new Wllama(WASM_PATHS);
          reply(src, origin, messageId, 'complete', { status: 'initialized', mode: 'wllama' });
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
          
          const username = parts[0];
          const repo = parts[1];
          const filename = parts.length > 2 ? parts.slice(2).join('/') : '';
          if (!filename) {
            throw new Error('Model name must include filename: username/repo/filename');
          }
          const modelId = `${username}/${repo}/${filename}`;
          
          const progressCallback = ({ loaded, total }) => {
            const percent = Math.max(0, Math.min(100, Math.round((loaded / (total || 1)) * 100)));
            reply(src, origin, messageId, 'progress', { loaded, total, percent });
          };
          
          await wllama.loadModelFromHF(username + '/' + repo, filename, { progressCallback });
          const modelInfo = { 
            id: modelId, 
            object: 'model', 
            created: Math.floor(Date.now() / 1000), 
            owned_by: username, 
            permission: [], 
            root: modelId, 
            parent: null, 
            loaded: true,
            downloaded: true
          };
          loadedModel = modelId;
          loadedModels.set(modelId, modelInfo);
          reply(src, origin, messageId, 'complete', modelInfo);
          break;
        }
        case 'models': {
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
                  let isLoaded = false;
                  if (wllama && loadedModel) {
                    isLoaded = fullModelId.toLowerCase() === loadedModel?.toLowerCase();
                  }
                  return { id: fullModelId, name: fullModelId, filename, loaded: isLoaded, downloaded: true, object: 'model', created: Date.now(), owned_by: 'local', size: entry.size || 0 };
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
          const response = { object: 'list', data: downloadedModels };
          reply(src, origin, messageId, 'complete', response);
          break;
        }
        case 'chat/completions': {
          if (!wllama) throw new Error('Wllama not initialized');
          if (loadedModels.size === 0) throw new Error('No models loaded. Use serve endpoint to load a model first.');
          const { messages, model, stream = false, max_tokens, temperature, top_p, top_k, stop } = payload || {};
          if (!messages || !Array.isArray(messages)) throw new Error('Messages array is required');
          const wllamaOptions = { nPredict: max_tokens || 256, sampling: { temp: temperature || 0.7, top_p: top_p || 0.9, top_k: top_k || 40 } };
          if (stop) { wllamaOptions.stopSequence = Array.isArray(stop) ? stop : [stop]; }
          const wllamaMessages = messages.map(msg => ({ role: msg.role, content: msg.content }));
          if (stream) {
            let lastContent = '';
            let isFirst = true;
            const completionId = `chatcmpl-${generateId()}`;
            wllamaOptions.onNewToken = (_token, _piece, currentText) => {
              const newToken = currentText.slice(lastContent.length);
              if (newToken) {
                const chunk = { id: completionId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: model || 'wllama-local', choices: [{ index: 0, delta: { role: isFirst ? 'assistant' : undefined, content: newToken }, finish_reason: null }] };
                reply(src, origin, messageId, 'stream_chunk', chunk);
                isFirst = false;
              }
              lastContent = currentText;
            };
            await wllama.createChatCompletion(wllamaMessages, wllamaOptions);
            const finalChunk = { id: completionId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: model || 'wllama-local', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
            reply(src, origin, messageId, 'stream_end', finalChunk);
          } else {
            const text = await wllama.createChatCompletion(wllamaMessages, wllamaOptions);
            const response = { id: `chatcmpl-${generateId()}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: model || 'wllama-local', choices: [{ index: 0, message: { role: 'assistant', content: text || '' }, finish_reason: 'stop' }], usage: { prompt_tokens: -1, completion_tokens: -1, total_tokens: -1 } };
            reply(src, origin, messageId, 'complete', response);
          }
          break;
        }
        case 'unload': {
          const { model } = payload || {};
          if (!model) throw new Error('Model name is required');
          
          // Parse model name format: username/repo/filename  
          const parts = model.split('/');
          if (parts.length < 3) {
            throw new Error('Model name must be in format: username/repo/filename');
          }
          
          const modelId = model; // Use full 3-part name
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
          
          // Parse model name format: username/repo/filename
          const parts = model.split('/');
          if (parts.length < 3) {
            throw new Error('Model name must be in format: username/repo/filename');
          }
          
          const modelId = model; // Use full 3-part name
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
          throw new Error(`Unknown endpoint: ${type}`);
      }
    } catch (err) {
      reply(src, origin, messageId, 'error', { error: { message: (err && err.message) || 'Unknown error', type: 'invalid_request_error', code: null } });
    }
  });

  const endpoints = ['init', 'serve', 'models', 'chat/completions', 'unload', 'delete'];
  try { window.opener && window.opener.postMessage({ messageId: 'RUNNER_READY', type: 'ready', payload: { status: 'ready', mode: 'wllama', endpoints } }, '*'); } catch {}
  try { window.parent && window.parent.postMessage({ messageId: 'RUNNER_READY', type: 'ready', payload: { status: 'ready', mode: 'wllama', endpoints } }, '*'); } catch {}
}

function setupEmbeddingRunner() {
  // Scoped state
  let HF;
  let hfPipeline;
  let embeddingModel = params.get('model');

  if (embeddingModel) {
    embeddingModel = decodeURIComponent(embeddingModel);
  } else {
    embeddingModel = 'nomic-ai/nomic-embed-text-v1.5';
  }

  async function ensureTransformers(modelName) {
    if (!HF) {
      HF = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2');
      if (!HF || !HF.pipeline) throw new Error('Failed to load @huggingface/transformers');
      try {
        if (HF.env?.backends?.onnx?.wasm) {
          HF.env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/';
          HF.env.backends.onnx.wasm.proxy = false;
        }
      } catch {}
    }
    if (!hfPipeline || (modelName && modelName !== embeddingModel)) {
      embeddingModel = modelName || embeddingModel;
      hfPipeline = await HF.pipeline('feature-extraction', embeddingModel);
      try { await hfPipeline(['test'], { pooling: 'mean', normalize: true }); } catch {}
    }
  }
  window.addEventListener('message', async (event) => {
    const src = event.source;
    const origin = event.origin;
    const { messageId, type, payload } = event.data || {};
    try {
      switch (type) {
        case 'init': {
          await ensureTransformers(embeddingModel);
          reply(src, origin, messageId, 'complete', { status: 'initialized', mode: 'embedding', model: embeddingModel });
          break;
        }
        case 'models': {
          const modelInfo = { object: 'list', data: [{ id: embeddingModel, name: embeddingModel, loaded: !!hfPipeline, object: 'model', created: Date.now(), owned_by: 'local' }] };
          reply(src, origin, messageId, 'complete', modelInfo);
          break;
        }
        case 'embeddings': {
          const { input, model } = payload || {};
          if (!input) throw new Error('input is required');
          await ensureTransformers(model || embeddingModel);
          const texts = Array.isArray(input) ? input : [input];
          const processed = texts.map((t) => typeof t === 'string' ? t.replace(/\n/g, ' ') : String(t));
          const result = await hfPipeline(processed, { pooling: 'mean', normalize: true });
          const list = typeof result.tolist === 'function' ? result.tolist() : result;
          const response = { object: 'list', data: list.map((vec, idx) => ({ object: 'embedding', embedding: vec, index: idx })), model: model || embeddingModel, usage: { prompt_tokens: -1, total_tokens: -1 } };
          reply(src, origin, messageId, 'complete', response);
          break;
        }
        default:
          throw new Error(`Unknown endpoint: ${type}`);
      }
    } catch (err) {
      reply(src, origin, messageId, 'error', { error: { message: (err && err.message) || 'Unknown error', type: 'invalid_request_error', code: null } });
    }
  });

  const endpoints = ['init', 'models', 'embeddings'];
  try { window.opener && window.opener.postMessage({ messageId: 'RUNNER_READY', type: 'ready', payload: { status: 'ready', mode: 'embedding', model: embeddingModel, endpoints } }, '*'); } catch {}
  try { window.parent && window.parent.postMessage({ messageId: 'RUNNER_READY', type: 'ready', payload: { status: 'ready', mode: 'embedding', model: embeddingModel, endpoints } }, '*'); } catch {}
}

function setupWebLLMRunner() {
  // Scoped state
  let WebLLMEngine;
  let prebuiltAppConfig;
  let webllmEngine;
  const loadedModels = new Map();
  let loadedModel;

  async function ensureWebLLM() {
    if (WebLLMEngine) return;
    try {
      console.log('Loading WebLLM module...');
      
      // Set flags to help WebLLM avoid worker creation
      if (typeof window !== 'undefined') {
        window.__WEBLLM_NO_WORKER__ = true;
      }
      
      // Try different CDN sources for WebLLM to find one that works in iframe
      let mod;
      const cdnSources = [
        'https://esm.run/@mlc-ai/web-llm',
        'https://cdn.skypack.dev/@mlc-ai/web-llm',
        'https://unpkg.com/@mlc-ai/web-llm/lib/index.js'
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
      
      if (!mod) {
        throw new Error('Failed to load WebLLM from any CDN source');
      }
      console.log('WebLLM module loaded successfully');
      console.log('Available exports:', Object.keys(mod));
      
      // Prioritize non-worker engines to avoid iframe worker issues
      const possibleEngines = [
        'MLCEngine',           // Direct engine class (preferred)
        'CreateMLCEngine',     // Factory function (may need model)
        'CreateWebWorkerMLCEngine', // Worker engine (may fail in iframe)
        'WebWorkerMLCEngine'   // Legacy worker (may fail in iframe)
      ];
      
      for (const engineName of possibleEngines) {
        if (mod[engineName]) {
          console.log(`Found engine: ${engineName}`);
          WebLLMEngine = mod[engineName];
          console.log(`Selected WebLLM engine: ${engineName}`);
          // Always use the first available engine (MLCEngine is prioritized)
          break;
        }
      }
      
      prebuiltAppConfig = mod.prebuiltAppConfig;
      
      if (!WebLLMEngine) {
        console.error('No WebLLM engine constructor found');
        console.log('Tried:', possibleEngines);
        console.log('Available:', Object.keys(mod));
        throw new Error('WebLLM engine constructor not found');
      }
      
      if (!prebuiltAppConfig || !prebuiltAppConfig.model_list) {
        console.error('prebuiltAppConfig not found or invalid');
        console.log('prebuiltAppConfig:', prebuiltAppConfig);
        throw new Error('WebLLM prebuiltAppConfig not available');
      }
      
      console.log('WebLLM setup complete:');
      console.log('- Engine:', WebLLMEngine.name || 'unnamed function');
      console.log('- Models available:', prebuiltAppConfig.model_list.length);
    } catch (error) {
      console.error('Failed to load WebLLM:', error);
      throw new Error(`Failed to load @mlc-ai/web-llm: ${error.message}`);
    }
  }

  window.addEventListener('message', async (event) => {
    const src = event.source;
    const origin = event.origin;
    const { messageId, type, payload } = event.data || {};
    try {
      switch (type) {
        case 'init': {
          await ensureWebLLM();
          try {
            console.log('Initializing WebLLM engine...');
            
            // Create WebLLM engine using the correct pattern from the reference code
            console.log('Creating WebLLM MLCEngine...');
            console.log('Engine function name:', WebLLMEngine.name);
            
            if (WebLLMEngine.name === 'MLCEngine') {
              // Direct MLCEngine class constructor
              console.log('Instantiating MLCEngine directly');
              webllmEngine = new WebLLMEngine();
            } else {
              // Factory function (CreateMLCEngine) - call without parameters
              console.log('Using CreateMLCEngine factory');
              webllmEngine = await WebLLMEngine();
            }
            
            console.log('WebLLM engine created successfully (models loaded on-demand via reload)');
            
            console.log('WebLLM engine initialized successfully');
            reply(src, origin, messageId, 'complete', { status: 'initialized', mode: 'webllm' });
          } catch (initError) {
            console.error('WebLLM initialization error:', initError);
            console.error('Error details:', {
              name: initError.name,
              message: initError.message,
              stack: initError.stack,
              engineUsed: WebLLMEngine.name
            });
            
            // Provide specific guidance for common errors
            if (initError.message && (
                initError.message.includes('onmessage') || 
                initError.message.includes('worker') ||
                initError.message.includes('Worker') ||
                initError.message.includes('web_worker')
            )) {
              console.error('WebLLM worker initialization failed - this is a fundamental limitation in iframe context');
              console.error('WebLLM requires WebAssembly workers which are restricted in iframe contexts');
              console.error('Recommendation: Use Wllama provider instead, which supports iframe contexts');
              
              reply(src, origin, messageId, 'error', {
                error: {
                  message: 'WebLLM is not compatible with iframe contexts due to WebAssembly worker restrictions. Please use the Wllama provider instead.',
                  type: 'WebWorkerError',
                  code: 'IFRAME_WEBLLM_INCOMPATIBLE',
                  suggestion: 'Switch to Wllama provider which supports iframe contexts'
                }
              });
            } else {
              reply(src, origin, messageId, 'error', {
                error: {
                  message: `Failed to initialize WebLLM engine: ${initError.message}`,
                  type: 'InitializationError',
                  code: null
                }
              });
            }
            return; // Don't throw, we've already sent error response
          }
          break;
        }
        case 'serve': {
          if (!webllmEngine) throw new Error('WebLLM not initialized. Call init first.');
          const { model } = payload || {};
          if (!model) throw new Error('Model name is required');
          
          // Verify model exists in supported list
          const supportedModels = prebuiltAppConfig?.model_list || [];
          const modelConfig = supportedModels.find(m => m.model_id === model || m.model === model);
          
          if (!modelConfig) {
            const availableModels = supportedModels.map(m => m.model_id || m.model).join(', ');
            throw new Error(`Model '${model}' not found in supported models. Available: ${availableModels}`);
          }
          
          const modelId = modelConfig.model_id || modelConfig.model;
          
          // Progress callback for model loading
          const progressCallback = (progress) => {
            const { loaded, total } = progress;
            const percent = Math.max(0, Math.min(100, Math.round((loaded / (total || 1)) * 100)));
            reply(src, origin, messageId, 'progress', { loaded, total, percent });
          };

          try {
            await webllmEngine.reload(modelId, undefined, {
              initProgressCallback: progressCallback
            });

            const modelInfo = { 
              id: modelId, 
              object: 'model', 
              created: Math.floor(Date.now() / 1000), 
              owned_by: 'webllm', 
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
            throw new Error(`Failed to load model ${modelId}: ${error.message}`);
          }
          break;
        }
        case 'models': {
          const supportedModels = prebuiltAppConfig?.model_list || [];
          const models = supportedModels.map(modelConfig => {
            const modelId = modelConfig.model_id || modelConfig.model;
            const isLoaded = loadedModels.has(modelId);
            
            return {
              id: modelId,
              name: modelConfig.model_lib_name || modelId,
              filename: '',
              loaded: isLoaded,
              downloaded: true, // WebLLM models are streamed, not pre-downloaded
              object: 'model',
              created: Math.floor(Date.now() / 1000),
              owned_by: 'webllm',
              size: modelConfig.model_lib_size || 0
            };
          });

          const response = { object: 'list', data: models };
          reply(src, origin, messageId, 'complete', response);
          break;
        }
        case 'chat/completions': {
          if (!webllmEngine) throw new Error('WebLLM not initialized');
          if (loadedModels.size === 0) throw new Error('No models loaded. Use serve endpoint to load a model first.');
          
          const { messages, model, stream = false, max_tokens, temperature, top_p, stop } = payload || {};
          if (!messages || !Array.isArray(messages)) throw new Error('Messages array is required');

          // Convert to WebLLM format
          const webllmMessages = messages.map(msg => ({
            role: msg.role,
            content: msg.content
          }));

          const requestOptions = {
            messages: webllmMessages,
            max_tokens: max_tokens || 256,
            temperature: temperature || 0.7,
            top_p: top_p || 0.9,
            stream: stream
          };

          if (stop) {
            requestOptions.stop = Array.isArray(stop) ? stop : [stop];
          }

          if (stream) {
            const completionId = `chatcmpl-${generateId()}`;
            let isFirst = true;
            
            try {
              const asyncChunkGenerator = await webllmEngine.chat.completions.create(requestOptions);
              
              for await (const chunk of asyncChunkGenerator) {
                if (chunk.choices && chunk.choices[0] && chunk.choices[0].delta) {
                  const delta = chunk.choices[0].delta;
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
                      finish_reason: chunk.choices[0].finish_reason
                    }]
                  };
                  
                  reply(src, origin, messageId, 'stream_chunk', webllmChunk);
                  isFirst = false;
                  
                  if (chunk.choices[0].finish_reason) break;
                }
              }
            } catch (error) {
              console.error('WebLLM streaming error:', error);
              throw error;
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
            // Non-streaming request
            try {
              const response = await webllmEngine.chat.completions.create(requestOptions);
              
              const openaiResponse = {
                id: `chatcmpl-${generateId()}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: model || 'webllm-local',
                choices: [{
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: response.choices[0].message.content || ''
                  },
                  finish_reason: response.choices[0].finish_reason || 'stop'
                }],
                usage: response.usage || { prompt_tokens: -1, completion_tokens: -1, total_tokens: -1 }
              };
              
              reply(src, origin, messageId, 'complete', openaiResponse);
            } catch (error) {
              console.error('WebLLM completion error:', error);
              throw error;
            }
          }
          break;
        }
        case 'unload': {
          const { model } = payload || {};
          if (!model) throw new Error('Model name is required');
          
          if (!loadedModels.has(model)) throw new Error(`Model ${model} is not loaded`);
          
          // WebLLM doesn't have explicit unload, but we can reset the engine
          try {
            webllmEngine = await WebLLMEngine();
          } catch (error) {
            console.error('Error reinitializing WebLLM engine:', error);
          }
          
          const modelInfo = loadedModels.get(model);
          if (modelInfo) {
            modelInfo.loaded = false;
            loadedModels.set(model, modelInfo);
          }
          loadedModel = undefined;
          
          reply(src, origin, messageId, 'complete', { status: 'unloaded', model: model });
          break;
        }
        case 'delete': {
          const { model } = payload || {};
          if (!model) throw new Error('Model name is required');
          
          if (loadedModels.has(model)) {
            try {
              webllmEngine = await WebLLMEngine();
            } catch (error) {
              console.error('Error reinitializing WebLLM engine:', error);
            }
          }
          
          loadedModels.delete(model);
          reply(src, origin, messageId, 'complete', { status: 'deleted', model: model });
          break;
        }
        default:
          throw new Error(`Unknown endpoint: ${type}`);
      }
    } catch (err) {
      console.error('WebLLM error:', err);
      reply(src, origin, messageId, 'error', { 
        error: { 
          message: (err && err.message) || 'Unknown error', 
          type: 'invalid_request_error', 
          code: null 
        } 
      });
    }
  });

  const endpoints = ['init', 'serve', 'models', 'chat/completions', 'unload', 'delete'];
  try { window.opener && window.opener.postMessage({ messageId: 'RUNNER_READY', type: 'ready', payload: { status: 'ready', mode: 'webllm', endpoints } }, '*'); } catch {}
  try { window.parent && window.parent.postMessage({ messageId: 'RUNNER_READY', type: 'ready', payload: { status: 'ready', mode: 'webllm', endpoints } }, '*'); } catch {}
}

// Start exactly one mode
if (mode === 'embedding') {
  setupEmbeddingRunner();
} else if (mode === 'webllm') {
  setupWebLLMRunner();
} else {
  setupWllamaRunner();
}
