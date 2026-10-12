var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __knownSymbol = (name, symbol) => (symbol = Symbol[name]) ? symbol : Symbol.for("Symbol." + name);
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};
var __await = function(promise, isYieldStar) {
  this[0] = promise;
  this[1] = isYieldStar;
};
var __asyncGenerator = (__this, __arguments, generator) => {
  var resume = (k, v, yes, no) => {
    try {
      var x = generator[k](v), isAwait = (v = x.value) instanceof __await, done = x.done;
      Promise.resolve(isAwait ? v[0] : v).then((y) => isAwait ? resume(k === "return" ? k : "next", v[1] ? { done: y.done, value: y.value } : y, yes, no) : yes({ value: y, done })).catch((e) => resume("throw", e, yes, no));
    } catch (e) {
      no(e);
    }
  }, method = (k) => it[k] = (x) => new Promise((yes, no) => resume(k, x, yes, no)), it = {};
  return generator = generator.apply(__this, __arguments), it[__knownSymbol("asyncIterator")] = () => it, method("next"), method("throw"), method("return"), it;
};
var __forAwait = (obj, it, method) => (it = obj[__knownSymbol("asyncIterator")]) ? it.call(obj) : (obj = obj[__knownSymbol("iterator")](), it = {}, method = (key, fn) => (fn = obj[key]) && (it[key] = (arg) => new Promise((yes, no, done) => (arg = fn.call(obj, arg), done = arg.done, Promise.resolve(arg.value).then((value) => yes({ value, done }), no)))), method("next"), method("return"), it);

// src/glue/messages.ts
var GLUE_VERSION = 1;
var GLUE_MESSAGE_PROTOTYPES = {
  "erro_evt": {
    "name": "erro_evt",
    "structName": "glue_msg_error",
    "className": "GlueMsgError",
    "fields": [
      {
        "type": "str",
        "name": "message",
        "isNullable": false
      }
    ]
  },
  "load_req": {
    "name": "load_req",
    "structName": "glue_msg_load_req",
    "className": "GlueMsgLoadReq",
    "fields": [
      {
        "type": "arr_str",
        "name": "model_paths",
        "isNullable": false
      },
      {
        "type": "str",
        "name": "mmproj_path",
        "isNullable": true
      },
      {
        "type": "bool",
        "name": "n_ctx_auto",
        "isNullable": false
      },
      {
        "type": "bool",
        "name": "use_mmap",
        "isNullable": false
      },
      {
        "type": "bool",
        "name": "use_mlock",
        "isNullable": false
      },
      {
        "type": "int",
        "name": "n_gpu_layers",
        "isNullable": false
      },
      {
        "type": "int",
        "name": "n_ctx",
        "isNullable": false
      },
      {
        "type": "int",
        "name": "n_threads",
        "isNullable": false
      },
      {
        "type": "str",
        "name": "model_alias",
        "isNullable": true
      },
      {
        "type": "int",
        "name": "log_level",
        "isNullable": true
      },
      {
        "type": "bool",
        "name": "embeddings",
        "isNullable": true
      },
      {
        "type": "bool",
        "name": "offload_kqv",
        "isNullable": true
      },
      {
        "type": "int",
        "name": "n_batch",
        "isNullable": true
      },
      {
        "type": "int",
        "name": "n_ubatch",
        "isNullable": true
      },
      {
        "type": "int",
        "name": "n_parallel",
        "isNullable": true
      },
      {
        "type": "str",
        "name": "pooling_type",
        "isNullable": true
      },
      {
        "type": "str",
        "name": "rope_scaling_type",
        "isNullable": true
      },
      {
        "type": "float",
        "name": "rope_freq_base",
        "isNullable": true
      },
      {
        "type": "float",
        "name": "rope_freq_scale",
        "isNullable": true
      },
      {
        "type": "float",
        "name": "yarn_ext_factor",
        "isNullable": true
      },
      {
        "type": "float",
        "name": "yarn_attn_factor",
        "isNullable": true
      },
      {
        "type": "float",
        "name": "yarn_beta_fast",
        "isNullable": true
      },
      {
        "type": "float",
        "name": "yarn_beta_slow",
        "isNullable": true
      },
      {
        "type": "int",
        "name": "yarn_orig_ctx",
        "isNullable": true
      },
      {
        "type": "str",
        "name": "cache_type_k",
        "isNullable": true
      },
      {
        "type": "str",
        "name": "cache_type_v",
        "isNullable": true
      },
      {
        "type": "bool",
        "name": "kv_unified",
        "isNullable": true
      },
      {
        "type": "bool",
        "name": "flash_attn",
        "isNullable": true
      },
      {
        "type": "bool",
        "name": "swa_full",
        "isNullable": true
      },
      {
        "type": "int",
        "name": "n_ctx_checkpoints",
        "isNullable": true
      },
      {
        "type": "int",
        "name": "checkpoint_min_step",
        "isNullable": true
      },
      {
        "type": "str",
        "name": "chat_template",
        "isNullable": true
      },
      {
        "type": "bool",
        "name": "jinja",
        "isNullable": true
      },
      {
        "type": "arr_str",
        "name": "default_template_kwargs_keys",
        "isNullable": true
      },
      {
        "type": "arr_str",
        "name": "default_template_kwargs_vals",
        "isNullable": true
      },
      {
        "type": "bool",
        "name": "reasoning",
        "isNullable": true
      },
      {
        "type": "int",
        "name": "image_min_tokens",
        "isNullable": true
      },
      {
        "type": "int",
        "name": "image_max_tokens",
        "isNullable": true
      },
      {
        "type": "bool",
        "name": "warmup",
        "isNullable": true
      },
      {
        "type": "bool",
        "name": "no_kv_offload",
        "isNullable": true
      },
      {
        "type": "bool",
        "name": "mmproj_offload",
        "isNullable": true
      },
      {
        "type": "bool",
        "name": "cont_batching",
        "isNullable": true
      },
      {
        "type": "int",
        "name": "n_keep",
        "isNullable": true
      },
      {
        "type": "bool",
        "name": "ctx_shift",
        "isNullable": true
      },
      {
        "type": "bool",
        "name": "cache_idle_slots",
        "isNullable": true
      },
      {
        "type": "int",
        "name": "n_cache_reuse",
        "isNullable": true
      },
      {
        "type": "arr_str",
        "name": "lora_paths",
        "isNullable": true
      },
      {
        "type": "arr_float",
        "name": "lora_scales",
        "isNullable": true
      },
      {
        "type": "bool",
        "name": "lora_init_without_apply",
        "isNullable": true
      },
      {
        "type": "str",
        "name": "spec_draft_model",
        "isNullable": true
      },
      {
        "type": "int",
        "name": "spec_draft_ngl",
        "isNullable": true
      },
      {
        "type": "int",
        "name": "spec_draft_n_max",
        "isNullable": true
      },
      {
        "type": "int",
        "name": "spec_draft_n_min",
        "isNullable": true
      },
      {
        "type": "float",
        "name": "spec_draft_p_min",
        "isNullable": true
      },
      {
        "type": "int",
        "name": "spec_draft_threads",
        "isNullable": true
      },
      {
        "type": "int",
        "name": "spec_draft_threads_batch",
        "isNullable": true
      },
      {
        "type": "arr_str",
        "name": "kv_overrides_keys",
        "isNullable": true
      },
      {
        "type": "arr_str",
        "name": "kv_overrides_vals",
        "isNullable": true
      },
      {
        "type": "int",
        "name": "reasoning_budget_tokens",
        "isNullable": true
      },
      {
        "type": "str",
        "name": "reasoning_budget_message",
        "isNullable": true
      },
      {
        "type": "str",
        "name": "reasoning_format",
        "isNullable": true
      },
      {
        "type": "bool",
        "name": "skip_chat_parsing",
        "isNullable": true
      },
      {
        "type": "bool",
        "name": "prefill_assistant",
        "isNullable": true
      }
    ]
  },
  "load_res": {
    "name": "load_res",
    "structName": "glue_msg_load_res",
    "className": "GlueMsgLoadRes",
    "fields": [
      {
        "type": "bool",
        "name": "success",
        "isNullable": false
      },
      {
        "type": "int",
        "name": "n_ctx",
        "isNullable": false
      },
      {
        "type": "int",
        "name": "n_batch",
        "isNullable": false
      },
      {
        "type": "int",
        "name": "n_ubatch",
        "isNullable": false
      },
      {
        "type": "int",
        "name": "n_vocab",
        "isNullable": false
      },
      {
        "type": "int",
        "name": "n_ctx_train",
        "isNullable": false
      },
      {
        "type": "int",
        "name": "n_embd",
        "isNullable": false
      },
      {
        "type": "int",
        "name": "n_layer",
        "isNullable": false
      },
      {
        "type": "arr_str",
        "name": "metadata_key",
        "isNullable": false
      },
      {
        "type": "arr_str",
        "name": "metadata_val",
        "isNullable": false
      },
      {
        "type": "int",
        "name": "token_bos",
        "isNullable": false
      },
      {
        "type": "int",
        "name": "token_eos",
        "isNullable": false
      },
      {
        "type": "int",
        "name": "token_eot",
        "isNullable": false
      },
      {
        "type": "arr_int",
        "name": "list_tokens_eog",
        "isNullable": false
      },
      {
        "type": "bool",
        "name": "add_bos_token",
        "isNullable": false
      },
      {
        "type": "bool",
        "name": "add_eos_token",
        "isNullable": false
      },
      {
        "type": "bool",
        "name": "has_encoder",
        "isNullable": false
      },
      {
        "type": "int",
        "name": "token_decoder_start",
        "isNullable": false
      },
      {
        "type": "str",
        "name": "media_marker",
        "isNullable": false
      },
      {
        "type": "bool",
        "name": "has_image_input",
        "isNullable": false
      },
      {
        "type": "bool",
        "name": "has_audio_input",
        "isNullable": false
      }
    ]
  },
  "cmpl_req": {
    "name": "cmpl_req",
    "structName": "glue_msg_completion_req",
    "className": "GlueMsgCompletionReq",
    "fields": [
      {
        "type": "bool",
        "name": "is_chat",
        "isNullable": false
      },
      {
        "type": "str",
        "name": "data_json",
        "isNullable": false
      },
      {
        "type": "arr_raw",
        "name": "files",
        "isNullable": false
      }
    ]
  },
  "cmpl_res": {
    "name": "cmpl_res",
    "structName": "glue_msg_completion_res",
    "className": "GlueMsgCompletionRes",
    "fields": [
      {
        "type": "bool",
        "name": "success",
        "isNullable": false
      },
      {
        "type": "int",
        "name": "req_id",
        "isNullable": false
      }
    ]
  },
  "embd_req": {
    "name": "embd_req",
    "structName": "glue_msg_embedding_req",
    "className": "GlueMsgEmbeddingReq",
    "fields": [
      {
        "type": "str",
        "name": "data_json",
        "isNullable": false
      },
      {
        "type": "arr_raw",
        "name": "files",
        "isNullable": false
      }
    ]
  },
  "embd_res": {
    "name": "embd_res",
    "structName": "glue_msg_embedding_res",
    "className": "GlueMsgEmbeddingRes",
    "fields": [
      {
        "type": "bool",
        "name": "success",
        "isNullable": false
      },
      {
        "type": "int",
        "name": "req_id",
        "isNullable": false
      }
    ]
  },
  "rrnk_req": {
    "name": "rrnk_req",
    "structName": "glue_msg_rerank_req",
    "className": "GlueMsgRerankReq",
    "fields": [
      {
        "type": "str",
        "name": "data_json",
        "isNullable": false
      }
    ]
  },
  "rrnk_res": {
    "name": "rrnk_res",
    "structName": "glue_msg_rerank_res",
    "className": "GlueMsgRerankRes",
    "fields": [
      {
        "type": "bool",
        "name": "success",
        "isNullable": false
      },
      {
        "type": "int",
        "name": "req_id",
        "isNullable": false
      }
    ]
  },
  "sys1_req": {
    "name": "sys1_req",
    "structName": "glue_msg_systemone_req",
    "className": "GlueMsgSystemoneReq",
    "fields": [
      {
        "type": "str",
        "name": "data_json",
        "isNullable": false
      }
    ]
  },
  "sys1_res": {
    "name": "sys1_res",
    "structName": "glue_msg_systemone_res",
    "className": "GlueMsgSystemoneRes",
    "fields": [
      {
        "type": "bool",
        "name": "success",
        "isNullable": false
      },
      {
        "type": "int",
        "name": "req_id",
        "isNullable": false
      }
    ]
  },
  "gres_req": {
    "name": "gres_req",
    "structName": "glue_msg_get_result_req",
    "className": "GlueMsgGetResultReq",
    "fields": [
      {
        "type": "int",
        "name": "req_id",
        "isNullable": false
      }
    ]
  },
  "gres_res": {
    "name": "gres_res",
    "structName": "glue_msg_get_result_res",
    "className": "GlueMsgGetResultRes",
    "fields": [
      {
        "type": "bool",
        "name": "success",
        "isNullable": false
      },
      {
        "type": "bool",
        "name": "has_more",
        "isNullable": false
      },
      {
        "type": "bool",
        "name": "is_error",
        "isNullable": false
      },
      {
        "type": "str",
        "name": "data_json",
        "isNullable": false
      }
    ]
  },
  "cncl_req": {
    "name": "cncl_req",
    "structName": "glue_msg_cancel_req",
    "className": "GlueMsgCancelReq",
    "fields": [
      {
        "type": "int",
        "name": "req_id",
        "isNullable": false
      }
    ]
  },
  "cncl_res": {
    "name": "cncl_res",
    "structName": "glue_msg_cancel_res",
    "className": "GlueMsgCancelRes",
    "fields": [
      {
        "type": "bool",
        "name": "success",
        "isNullable": false
      }
    ]
  },
  "tbop_req": {
    "name": "tbop_req",
    "structName": "glue_msg_test_backend_ops_req",
    "className": "GlueMsgTestBackendOpsReq",
    "fields": [
      {
        "type": "arr_str",
        "name": "args",
        "isNullable": false
      }
    ]
  },
  "tbop_res": {
    "name": "tbop_res",
    "structName": "glue_msg_test_backend_ops_res",
    "className": "GlueMsgTestBackendOpsRes",
    "fields": [
      {
        "type": "int",
        "name": "retcode",
        "isNullable": false
      },
      {
        "type": "bool",
        "name": "success",
        "isNullable": false
      }
    ]
  }
};

// src/glue/glue.ts
var GLUE_MAGIC = new Uint8Array([71, 76, 85, 69]);
var GLUE_DTYPE_NULL = 0;
var GLUE_DTYPE_BOOL = 1;
var GLUE_DTYPE_INT = 2;
var GLUE_DTYPE_FLOAT = 3;
var GLUE_DTYPE_STRING = 4;
var GLUE_DTYPE_RAW = 5;
var GLUE_DTYPE_ARRAY_BOOL = 6;
var GLUE_DTYPE_ARRAY_INT = 7;
var GLUE_DTYPE_ARRAY_FLOAT = 8;
var GLUE_DTYPE_ARRAY_STRING = 9;
var GLUE_DTYPE_ARRAY_RAW = 10;
var TYPE_MAP = {
  str: GLUE_DTYPE_STRING,
  int: GLUE_DTYPE_INT,
  float: GLUE_DTYPE_FLOAT,
  bool: GLUE_DTYPE_BOOL,
  raw: GLUE_DTYPE_RAW,
  arr_str: GLUE_DTYPE_ARRAY_STRING,
  arr_int: GLUE_DTYPE_ARRAY_INT,
  arr_float: GLUE_DTYPE_ARRAY_FLOAT,
  arr_bool: GLUE_DTYPE_ARRAY_BOOL,
  arr_raw: GLUE_DTYPE_ARRAY_RAW,
  null: GLUE_DTYPE_NULL
};
function glueDeserialize(buf) {
  let offset = 0;
  const view = new DataView(buf.buffer);
  const readUint32 = () => {
    const value = view.getUint32(offset, true);
    offset += 4;
    return value;
  };
  const readInt32 = () => {
    const value = view.getInt32(offset, true);
    offset += 4;
    return value;
  };
  const readFloat = () => {
    const value = view.getFloat32(offset, true);
    offset += 4;
    return value;
  };
  const readBool = () => {
    return readUint32() !== 0;
  };
  const readString = (customLen) => {
    const length = customLen != null ? customLen : readUint32();
    const value = new TextDecoder().decode(buf.slice(offset, offset + length));
    offset += length;
    return value;
  };
  const readRaw = () => {
    const length = readUint32();
    const value = buf.slice(offset, offset + length);
    offset += length;
    return value;
  };
  const readArray = (readItem) => {
    const length = readUint32();
    const value = new Array(length);
    for (let i = 0; i < length; i++) {
      value[i] = readItem();
    }
    return value;
  };
  const readNull = () => null;
  const readField = (field) => {
    switch (field.type) {
      case "str":
        return readString();
      case "int":
        return readInt32();
      case "float":
        return readFloat();
      case "bool":
        return readBool();
      case "raw":
        return readRaw();
      case "arr_str":
        return readArray(readString);
      case "arr_int":
        return readArray(readInt32);
      case "arr_float":
        return readArray(readFloat);
      case "arr_bool":
        return readArray(readBool);
      case "arr_raw":
        return readArray(readRaw);
      case "null":
        return readNull();
    }
  };
  const magicValid = buf[0] === GLUE_MAGIC[0] && buf[1] === GLUE_MAGIC[1] && buf[2] === GLUE_MAGIC[2] && buf[3] === GLUE_MAGIC[3];
  offset += 4;
  if (!magicValid) {
    throw new Error("Invalid magic number");
  }
  const version = readUint32();
  if (version !== GLUE_VERSION) {
    throw new Error("Invalid version number");
  }
  const name = readString(8);
  const msgProto = GLUE_MESSAGE_PROTOTYPES[name];
  if (!msgProto) {
    throw new Error(`Unknown message name: ${name}`);
  }
  const output = { _name: name };
  for (const field of msgProto.fields) {
    const readType = readUint32();
    if (readType === GLUE_DTYPE_NULL) {
      if (!field.isNullable) {
        throw new Error(
          `${name}: Expect field ${field.name} to be non-nullable`
        );
      }
      output[field.name] = null;
      continue;
    }
    if (readType !== TYPE_MAP[field.type]) {
      throw new Error(
        `${name}: Expect field ${field.name} to have type ${field.type}`
      );
    }
    output[field.name] = readField(field);
  }
  return output;
}
function glueSerialize(msg) {
  const msgProto = GLUE_MESSAGE_PROTOTYPES[msg._name];
  if (!msgProto) {
    throw new Error(`Unknown message name: ${msg._name}`);
  }
  const bufs = [];
  const writeUint32 = (value) => {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setUint32(0, value, true);
    bufs.push(new Uint8Array(buf));
  };
  const writeInt32 = (value) => {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setInt32(0, value, true);
    bufs.push(new Uint8Array(buf));
  };
  const writeFloat = (value) => {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, value, true);
    bufs.push(new Uint8Array(buf));
  };
  const writeBool = (value) => {
    writeUint32(value ? 1 : 0);
  };
  const writeString = (value) => {
    const utf8 = new TextEncoder().encode(value);
    writeUint32(utf8.byteLength);
    bufs.push(utf8);
  };
  const writeRaw = (value) => {
    writeUint32(value.byteLength);
    bufs.push(value);
  };
  const writeArray = (value, writeItem) => {
    writeUint32(value.length);
    for (const item of value) {
      writeItem(item);
    }
  };
  const writeNull = () => {
  };
  bufs.push(GLUE_MAGIC);
  writeUint32(GLUE_VERSION);
  {
    const utf8 = new TextEncoder().encode(msg._name);
    bufs.push(utf8);
  }
  for (const field of msgProto.fields) {
    const val = msg[field.name];
    if (!field.isNullable && (val === null || val === void 0)) {
      throw new Error(
        `${msg._name}: Expect field ${field.name} to be non-nullable`
      );
    }
    if (val === null || val === void 0) {
      writeUint32(GLUE_DTYPE_NULL);
      continue;
    }
    writeUint32(TYPE_MAP[field.type]);
    switch (field.type) {
      case "str":
        writeString(val);
        break;
      case "int":
        writeInt32(val);
        break;
      case "float":
        writeFloat(val);
        break;
      case "bool":
        writeBool(val);
        break;
      case "raw":
        writeRaw(val);
        break;
      case "arr_str":
        writeArray(val, writeString);
        break;
      case "arr_int":
        writeArray(val, writeInt32);
        break;
      case "arr_float":
        writeArray(val, writeFloat);
        break;
      case "arr_bool":
        writeArray(val, writeBool);
        break;
      case "arr_raw":
        writeArray(val, writeRaw);
        break;
      case "null":
        writeNull();
        break;
    }
  }
  const totalLength = bufs.reduce((acc, buf) => acc + buf.byteLength, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of bufs) {
    output.set(buf, offset);
    offset += buf.byteLength;
  }
  return output;
}

// src/wasm/source-map.ts
var WASM_SOURCE_MAP = {
  "default": "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9Vn1OfV59QX1RfUl9WX1FfVV9TX1dfUN9U31LfVtdYv6jvqu+p76vvqB+qH6kfqx+on6qfqZ+rn6hfql+pX6tfqN+q36nfq9+oO6Vf1R/Un9Wf3F+vtV/c36+13dZv39oW63/v5U/2r/+1vdoQJN0Mw/qInWn6Qh6w9rRKMa02RN0bimapqmaztpXbSuWjetu9ZD66n10nprfbS+Wj+tvzZAG6gN0gZrQ7Sh2jBtuDZCG6mN0sq0cm20NkYbq43TxmsTtArNo3k1n7YV+rWuKKCZexDSv4r/zSHuv9L7GfyaKVsL8mNxiz0Es3pd0REw/zobTy6lXKxmfFmtUiT9azlajiq1Kq1aq9Emajtrk7TJ2mRtiraLtqs2VZuqTdN206Zrd5HdtT20u8kMbU9tL20D2Vubqc3SZmsbyT7aHG1fbT9tf22udoB2D5mnHajN1w7SFmgHa4doh2qHaYdrQe0ILaTVavWwTqvXZoqG1qA1altIkxaAw9ECENYWaou0iNasRbWYFtfi2mLtE5LQklpSS2kprUVr1ZZoS7Q2bam2TFuurdCO1FZqq7RV2lHa0drR2jHasdqx2nHacdrx2gnaidpJ2snaau0U7VTtNO107QztTO0sbY12tnaOdq52nna+doF2oXahdpF2sXaJdql2mXa5doW2VrtSu0q7WrtGu1a7Trteu0HjdJ12o3aTdrN2i3arNhndpt2urdfu0O7U7tLu1jZoG7V7tCnoXu0+7X5tk7ZZe0B7UHtIe1h7RHtUe0x7XHtCe1J7Sntae0Z7VntOe157QXtRe0l7WXtFWwde1V7TXtfe0N7U3tLe1rZoW7R3tHe197T3tQ+0D7WPtI+1T7RPtc+0z7UvtC+1r7SvtUHSN9o89K32nfa99oNWSbdqP2o/aT9rv2i/aL9qv2m/a9u0bdof2nZtu/an9pf2t7ZDA7qgQ13UJR3pWCc61Zku64rOdVXXdF3fSe+id9W76d31HnpPvZfeW++j99X76f31AfpAfZA+WB+iD9WH6cP1EfpIfZReppfro/Ux+lh9nD5en6BX6B7dq/t0vx7QK/UqvVqv0SfqO+uT9Mn6FH0XfVd9qj5N302fru+u76HP0PfU99L31mfqs/TZ+j76HH1ffT99f32ufoA+Tz9Qn68fpC/QD9YP0Q/VD9MP14P6EXpIr9Xr9Hrd0Bv0Rr1JD+sL9UV6RG/Wo3pMj+uL9YSe1FN6i96qL9Hb9KX6Mn25vkI/Ul+pr9KP0o/Wj9GP1Y/Tj9dP0E/UT9JP1lfrp+in6qfpp+tn6GfqZ+lr9LP1c/Rz9fP08/UL9Av1i/SL9Uv0S/XL9Mv1K/S1+pX6VfrV+jX6tfp1+vX6Dfo6/Ub9Jv1m/Rb9Vv02/XZ9vX6Hfqd+l363vkHfqN+j36vfp9+vb9I36w/oD+oP6Q/rj+iP6o/pj+tP6E/qT+lP68/oz+rP6c/rL+gv6i/pL+uv6K/qr+mv62/ob+pv6W/rW/R39Hf19/T39Q/0D/WP9I/1T/RP9c/0z/Uv9C/1r/Sv9W/0b/Xv9O/1H/St+o/6T/rP+i/6r/pv+u/6Nn2H439/6H/o2/U/9f8D4178Wq9jAgA=",
  "compat": "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"
};

// src/debug.ts
var cache = /* @__PURE__ */ new Map();
function loadMap(buildKey) {
  return __async(this, null, function* () {
    if (cache.has(buildKey)) return cache.get(buildKey);
    const b64 = WASM_SOURCE_MAP[buildKey];
    if (!b64) throw new Error(`No source map for build "${buildKey}"`);
    const gzipped = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const ds = new DecompressionStream("gzip");
    const writer = ds.writable.getWriter();
    writer.write(gzipped);
    writer.close();
    const buf = yield new Response(ds.readable).arrayBuffer();
    const dv = new DataView(buf);
    const bytes = new Uint8Array(buf);
    const firstId = dv.getUint32(0, true);
    const funcCount = dv.getUint32(4, true);
    const numNames = dv.getUint32(8, true);
    const td = new TextDecoder();
    const names = [];
    let pos = 12;
    for (let i = 0; i < numNames; i++) {
      const len = bytes[pos++];
      names.push(td.decode(bytes.subarray(pos, pos + len)));
      pos += len;
    }
    const funcNames = [];
    for (let i = 0; i < funcCount; i++) {
      const idx = dv.getUint16(pos, true);
      pos += 2;
      funcNames.push(idx === 65535 ? null : names[idx]);
    }
    const entry = { firstId, funcNames };
    cache.set(buildKey, entry);
    return entry;
  });
}
var Debug = {
  /**
   * Resolves a list of wasm function indices to their cleaned symbol names.
   */
  decodeFuncIds: (funcIds, isCompatBuild) => __async(void 0, null, function* () {
    const buildKey = isCompatBuild ? "compat" : "default";
    const { firstId, funcNames } = yield loadMap(buildKey);
    return funcIds.map((funcId) => {
      const i = funcId - firstId;
      const name = i >= 0 && i < funcNames.length && funcNames[i] ? funcNames[i] : "(unknown)";
      return { funcId, name };
    });
  }),
  /**
   * Annotates a wasm stack trace string with resolved function names.
   *
   * Example input from Chrome:
   *   at http://localhost:8080/esm/wasm/wllama.wasm:wasm-function[775]:0x74251
   *   at async blob:http://localhost:8080/53a863cc-7227-45cc-8594-ddbbf5257f20:317:28
   *
   * Example input from Firefox:
   *   @http://localhost:8080/esm/wasm/wllama.wasm:wasm-function[796]:0x7dfe2
   *       at wModuleInit/WebAssembly.promising/< (9b6a2acd-d909-44e2-b021-d42fb9087cfb:15:32) index.js:1433:45
   *
   * Example input from Safari:
   *   2441@wasm-function[2441]
   *       at wrapper (d746f19e-4523-4f36-ba06-d0969acc0b05:22:126009)
   *
   * Example output:
   *   wasm-func[775] (server_response::send)
   */
  decodeStackTrace: (stack, isCompatBuild) => __async(void 0, null, function* () {
    const re = /wasm-function\[(\d+)\]/g;
    const funcIds = [
      ...new Set([...stack.matchAll(re)].map((m) => parseInt(m[1])))
    ];
    if (funcIds.length === 0) return stack;
    const resolved = yield Debug.decodeFuncIds(funcIds, isCompatBuild);
    return resolved.map((r) => {
      if (r.name === "(unknown)") {
        return `    wasm-func[${r.funcId}] (unknown)`;
      }
      return `    wasm-func[${r.funcId}] (${r.name})`;
    }).join("\n");
  })
};

// src/utils.ts
var textDecoder = new TextDecoder();
var URL_PARTS_REGEX = /-(\d{5})-of-(\d{5})\.gguf(?:\?.*)?$/;
var parseShardNumber = (fnameOrUrl) => {
  const matches = fnameOrUrl.match(URL_PARTS_REGEX);
  if (!matches) {
    return {
      baseURL: fnameOrUrl,
      current: 1,
      total: 1
    };
  } else {
    return {
      baseURL: fnameOrUrl.replace(URL_PARTS_REGEX, ""),
      current: parseInt(matches[1]),
      total: parseInt(matches[2])
    };
  }
};
var sortFileByShard = (blobs) => {
  const isFiles = blobs.every((b) => !!b.name);
  if (isFiles && blobs.length > 1) {
    const files = blobs;
    files.sort((a, b) => {
      const infoA = parseShardNumber(a.name);
      const infoB = parseShardNumber(b.name);
      return infoA.current - infoB.current;
    });
  }
};
var isMmproj = (blob) => __async(void 0, null, function* () {
  const META_NAME = "general.architecture";
  const META_VAL = "clip";
  const tmp = blob.slice(0, 128 * 1024);
  const header = yield tmp.arrayBuffer();
  const buf = new Uint8Array(header);
  const nameBytes = new TextEncoder().encode(META_NAME);
  const valBytes = new TextEncoder().encode(META_VAL);
  let offset = -1;
  outer: for (let i = 0; i <= buf.length - nameBytes.length; i++) {
    for (let j = 0; j < nameBytes.length; j++) {
      if (buf[i + j] !== nameBytes[j]) continue outer;
    }
    offset = i;
    break;
  }
  if (offset === -1) return false;
  if (offset + 8 * 4 + 4 > buf.length) return false;
  const view = new DataView(header);
  const valLen = view.getBigUint64(offset + 8 * 3, true);
  if (valLen !== /* @__PURE__ */ BigInt("4")) return false;
  for (let i = 0; i < valBytes.length; i++) {
    if (buf[offset + 8 * 4 + i] !== valBytes[i]) return false;
  }
  return true;
});
var absoluteUrl = (relativePath) => typeof document === "undefined" ? new URL(relativePath, self.location.href).href : new URL(relativePath, document.baseURI).href;
var padDigits = (number, digits) => {
  return Array(Math.max(digits - String(number).length + 1, 0)).join("0") + number;
};
var sumArr = (arr) => arr.reduce((prev, curr) => prev + curr, 0);
var isString = (value) => !!(value == null ? void 0 : value.startsWith);
var MMPROJ_FILE_NAME = "mmproj.gguf";
var prepareBlobs = (blobsInp) => __async(void 0, null, function* () {
  const blobs = [];
  let blobMmproj = null;
  for (const blob of blobsInp) {
    if (yield isMmproj(blob)) {
      blobMmproj = blob;
    } else {
      blobs.push(blob);
    }
  }
  sortFileByShard(blobs);
  const result = blobs.map((blob, i) => ({
    blob,
    name: `model-${padDigits(i + 1, 5)}-of-${padDigits(blobs.length, 5)}.gguf`
  }));
  if (blobMmproj) {
    result.push({
      blob: blobMmproj,
      name: MMPROJ_FILE_NAME
    });
  }
  return {
    llm: result.filter((f) => f.name !== MMPROJ_FILE_NAME),
    mmproj: blobMmproj ? { blob: blobMmproj, name: MMPROJ_FILE_NAME } : null,
    all: result
  };
});
var isSupportMultiThread = () => ((e) => __async(void 0, null, function* () {
  try {
    return "undefined" != typeof MessageChannel && new MessageChannel().port1.postMessage(new SharedArrayBuffer(1)), WebAssembly.validate(e);
  } catch (e2) {
    return false;
  }
}))(
  new Uint8Array([
    0,
    97,
    115,
    109,
    1,
    0,
    0,
    0,
    1,
    4,
    1,
    96,
    0,
    0,
    3,
    2,
    1,
    0,
    5,
    4,
    1,
    3,
    1,
    1,
    10,
    11,
    1,
    9,
    0,
    65,
    0,
    254,
    16,
    2,
    0,
    26,
    11
  ])
);
var isSupportExceptions = () => __async(void 0, null, function* () {
  return WebAssembly.validate(
    new Uint8Array([
      0,
      97,
      115,
      109,
      1,
      0,
      0,
      0,
      1,
      4,
      1,
      96,
      0,
      0,
      3,
      2,
      1,
      0,
      10,
      8,
      1,
      6,
      0,
      6,
      64,
      25,
      11,
      11
    ])
  );
});
var isSupportSIMD = () => __async(void 0, null, function* () {
  return WebAssembly.validate(
    new Uint8Array([
      0,
      97,
      115,
      109,
      1,
      0,
      0,
      0,
      1,
      5,
      1,
      96,
      0,
      1,
      123,
      3,
      2,
      1,
      0,
      10,
      10,
      1,
      8,
      0,
      65,
      0,
      253,
      15,
      253,
      98,
      11
    ])
  );
});
var isSupportJSPI = () => {
  return !!WebAssembly.Suspending;
};
var isSupportWebGPU = () => {
  return !!navigator.gpu;
};
var isSupportMem64 = () => {
  try {
    new WebAssembly.Memory({
      address: "i64",
      initial: /* @__PURE__ */ BigInt("1")
      // 1 page (64 KiB)
    });
    return true;
  } catch (e) {
    return false;
  }
};
var checkEnvironmentCompatible = () => __async(void 0, null, function* () {
  if (!(yield isSupportExceptions())) {
    throw new Error("WebAssembly runtime does not support exception handling");
  }
  if (!(yield isSupportSIMD())) {
    throw new Error("WebAssembly runtime does not support SIMD");
  }
});
var isFirefox = () => {
  return !!navigator.userAgent.match(/Firefox\/([0-9\.]+)(?:\s|$)/);
};
var GGUF_FILE_REGEX = /^.*\.gguf(?:\?.*)?$/;
var isValidGgufFile = (path) => {
  return GGUF_FILE_REGEX.test(path);
};
var isSafariMobile = () => {
  return !!navigator.userAgent.match(/Version\/([0-9\._]+).*Mobile.*Safari.*/);
};
var createWorker = (workerCode) => {
  const workerURL = URL.createObjectURL(
    isString(workerCode) ? new Blob([workerCode], { type: "text/javascript" }) : workerCode
  );
  return new Worker(workerURL, { type: "module" });
};
var cbToAsyncIter = (fn) => (...args) => {
  let values = [];
  let resolve;
  let reject;
  values.push(
    new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    })
  );
  fn(...args, (val, done, err) => {
    if (err) {
      reject(err);
      return;
    }
    resolve([val, done]);
    values.push(
      new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      })
    );
  });
  return function() {
    return __asyncGenerator(this, null, function* () {
      let val;
      for (let i = 0, done = false; !done; i++) {
        [val, done] = yield new __await(values[i]);
        delete values[i];
        if (val !== void 0) yield val;
      }
    });
  }();
};
var canUseAsyncFileRead = (compat) => isSupportJSPI() || compat;
var needCompat = () => !isSupportJSPI() || !isSupportMem64();

// src/workers-code/generated.ts
var LIBLLAMA_VERSION = "b11364-46ca246";
var LLAMA_CPP_WORKER_CODE = "// Start the main llama.cpp\nlet wllamaMalloc;\nlet wllamaStart;\nlet wllamaAction;\nlet wllamaExit;\nlet wllamaDebug;\n\nlet Module = null;\nlet isCompat = false;\nlet lastStack = '';\nlet isAborted = false;\nlet hasMultithread = false;\n\n//////////////////////////////////////////////////////////////\n// UTILS\n//////////////////////////////////////////////////////////////\n\n// send message back to main thread\nconst msg = (data, transfer) => postMessage(data, transfer);\n\n// Convert CPP log into JS log\nconst cppLogToJSLog = (line) => {\n  const matched = line.match(/@@(DEBUG|INFO|WARN|ERROR)@@(.*)/);\n  return !!matched\n    ? {\n        level: (matched[1] === 'INFO' ? 'debug' : matched[1]).toLowerCase(),\n        text: matched[2],\n      }\n    : { level: 'log', text: line };\n};\n\nconst getHeapU8 = () => {\n  const buffer = Module.wasmMemory.buffer;\n  return new Uint8Array(buffer);\n};\n\nconst toSizeT = (num) => {\n  return isCompat ? Number(num) : BigInt(num);\n};\n\n// Get module config that forwards stdout/err to main thread\nconst getWModuleConfig = (_argMainScriptBlob) => {\n  var pathConfig = RUN_OPTIONS.pathConfig;\n  var pthreadPoolSize = RUN_OPTIONS.nbThread;\n  var argMainScriptBlob = _argMainScriptBlob;\n\n  isCompat = RUN_OPTIONS.compat;\n  hasMultithread = pthreadPoolSize > 1;\n\n  msg({\n    verb: 'console.debug',\n    args: [\n      `Multithread enabled: ${hasMultithread}, pthreadPoolSize: ${pthreadPoolSize}`,\n    ],\n  });\n\n  if (!pathConfig['wllama.wasm']) {\n    throw new Error('\"wllama.wasm\" is missing in pathConfig');\n  }\n  return {\n    noInitialRun: true,\n    print: function (text) {\n      if (arguments.length > 1)\n        text = Array.prototype.slice.call(arguments).join(' ');\n      msg({ verb: 'console.log', args: [text] });\n    },\n    printErr: function (text) {\n      if (arguments.length > 1)\n        text = Array.prototype.slice.call(arguments).join(' ');\n      if (text.startsWith('@@STACK@@')) {\n        lastStack = text.slice('@@STACK@@'.length);\n        return;\n      }\n      const logLine = cppLogToJSLog(text);\n      msg({ verb: 'console.' + logLine.level, args: [logLine.text] });\n    },\n    locateFile: function (filename, basePath) {\n      const p = pathConfig[filename];\n      const truncate = (str) =>\n        str.length > 128 ? `${str.substr(0, 128)}...` : str;\n      if (filename.match(/wllama\\.worker\\.js/)) {\n        msg({\n          verb: 'console.error',\n          args: [\n            '\"wllama.worker.js\" is removed from v2.2.1. Hint: make sure to clear browser\\'s cache.',\n          ],\n        });\n      } else {\n        msg({\n          verb: 'console.debug',\n          args: [`Loading \"${filename}\" from \"${truncate(p)}\"`],\n        });\n        return p;\n      }\n    },\n    mainScriptUrlOrBlob: hasMultithread\n      ? argMainScriptBlob\n      : 'throw new Error(\"Multithreading is not enabled\")',\n    pthreadPoolSize: hasMultithread ? pthreadPoolSize : 0,\n    wasmMemory: hasMultithread ? getWasmMemory() : null,\n    onAbort: function (message) {\n      isAborted = true;\n      msg({ verb: 'signal.abort', args: ['abort', message, lastStack, null] });\n    },\n    onExit: function (code) {\n      isAborted = true;\n      const callstack = new Error().stack.toString();\n      msg({\n        verb: 'signal.abort',\n        args: ['abort', 'exit(' + code + ')', callstack, null],\n      });\n    },\n  };\n};\n\n// Get the memory to be used by wasm. (Only used in multi-thread mode)\n// Because we have a weird OOM issue on iOS, we need to try some values\n// See: https://github.com/emscripten-core/emscripten/issues/19144\n//      https://github.com/godotengine/godot/issues/70621\nconst getWasmMemory = () => {\n  let minBytes = 128 * 1024 * 1024;\n  let maxBytes = 4096 * 1024 * 1024;\n  let stepBytes = 128 * 1024 * 1024;\n  while (maxBytes > minBytes) {\n    try {\n      const wasmMemory = new WebAssembly.Memory({\n        initial: toSizeT(minBytes / 65536),\n        maximum: toSizeT(maxBytes / 65536),\n        shared: true,\n        address: isCompat ? undefined : 'i64',\n      });\n      return wasmMemory;\n    } catch (e) {\n      maxBytes -= stepBytes;\n      continue; // retry\n    }\n  }\n  throw new Error('Cannot allocate WebAssembly.Memory');\n};\n\n//////////////////////////////////////////////////////////////\n// HEAPFS PATCH\n//////////////////////////////////////////////////////////////\n\n/**\n * By default, emscripten uses memfs. The way it works is by\n * allocating new Uint8Array in javascript heap. This is not good\n * because it requires files to be copied to wasm heap each time\n * a file is read.\n *\n * HeapFS is an alternative, which resolves this problem by\n * allocating space for file directly inside wasm heap. This\n * allows us to mmap without doing any copy.\n *\n * For llama.cpp, this is great because we use MAP_SHARED\n *\n * Ref: https://github.com/ngxson/wllama/pull/39\n * Ref: https://github.com/emscripten-core/emscripten/blob/main/src/library_memfs.js\n *\n * Note 29/05/2024 @ngxson\n * Due to ftell() being limited to MAX_LONG, we cannot load files bigger than 2^31 bytes (or 2GB)\n * Ref: https://github.com/emscripten-core/emscripten/blob/main/system/lib/libc/musl/src/stdio/ftell.c\n */\n\nconst fsNameToFile = {}; // map Name => File\nconst fsIdToFile = {}; // map ID => File\nlet currFileId = 0;\n\n// Patch and redirect memfs calls to wllama\nconst patchHeapFS = () => {\n  const m = Module;\n  // save functions\n  m.MEMFS.stream_ops._read = m.MEMFS.stream_ops.read;\n  m.MEMFS.stream_ops._write = m.MEMFS.stream_ops.write;\n  m.MEMFS.stream_ops._llseek = m.MEMFS.stream_ops.llseek;\n  m.MEMFS.stream_ops._allocate = m.MEMFS.stream_ops.allocate;\n  m.MEMFS.stream_ops._mmap = m.MEMFS.stream_ops.mmap;\n  m.MEMFS.stream_ops._msync = m.MEMFS.stream_ops.msync;\n\n  const patchStream = (stream) => {\n    const name = stream.node.name;\n    if (fsNameToFile[name]) {\n      const f = fsNameToFile[name];\n      const ptr = Number(f.ptr);\n      stream.node.contents = getHeapU8().subarray(ptr, ptr + f.size);\n      stream.node.usedBytes = f.size;\n    }\n  };\n\n  // replace \"read\" functions\n  m.MEMFS.stream_ops.read = function (\n    stream,\n    buffer,\n    offset,\n    length,\n    position\n  ) {\n    patchStream(stream);\n    return m.MEMFS.stream_ops._read(stream, buffer, offset, length, position);\n  };\n  m.MEMFS.ops_table.file.stream.read = m.MEMFS.stream_ops.read;\n\n  // replace \"llseek\" functions\n  m.MEMFS.stream_ops.llseek = function (stream, offset, whence) {\n    patchStream(stream);\n    return m.MEMFS.stream_ops._llseek(stream, offset, whence);\n  };\n  m.MEMFS.ops_table.file.stream.llseek = m.MEMFS.stream_ops.llseek;\n\n  // replace \"mmap\" functions\n  m.MEMFS.stream_ops.mmap = function (stream, length, position, prot, flags) {\n    patchStream(stream);\n    const name = stream.node.name;\n    if (fsNameToFile[name]) {\n      const f = fsNameToFile[name];\n      const mmapPtr = f.ptr + toSizeT(position);\n      return {\n        ptr: mmapPtr,\n        allocated: false,\n      };\n    } else {\n      return m.MEMFS.stream_ops._mmap(stream, length, position, prot, flags);\n    }\n  };\n  m.MEMFS.ops_table.file.stream.mmap = m.MEMFS.stream_ops.mmap;\n\n  // mount FS\n  m.FS.mkdir('/models');\n  m.FS.mount(m.MEMFS, { root: '.' }, '/models');\n};\n\n// Allocate a new file in wllama heapfs, returns file ID\nconst heapfsAlloc = (name, size, allocBuffer) => {\n  if (size < 1) {\n    throw new Error('File size must be bigger than 0');\n  }\n  const m = Module;\n  const ptr = toSizeT(allocBuffer ? m.mmapAlloc(size) : 0);\n  const file = {\n    ptr: ptr,\n    size: size,\n    id: currFileId++,\n  };\n  fsIdToFile[file.id] = file;\n  fsNameToFile[name] = file;\n  return file.id;\n};\n\n// Add new file to wllama heapfs, return number of written bytes\nconst heapfsWrite = (id, buffer, offset) => {\n  if (fsIdToFile[id]) {\n    const { ptr, size } = fsIdToFile[id];\n    const afterWriteByte = offset + buffer.byteLength;\n    if (afterWriteByte > size) {\n      throw new Error(\n        `File ID ${id} write out of bound, afterWriteByte = ${afterWriteByte} while size = ${size}`\n      );\n    }\n    getHeapU8().set(buffer, Number(ptr) + offset);\n    return buffer.byteLength;\n  } else {\n    throw new Error(`File ID ${id} not found in heapfs`);\n  }\n};\n\n//////////////////////////////////////////////////////////////\n// ASYNC FILE READ\n//////////////////////////////////////////////////////////////\n\nlet isAwaitReading = false;\nlet pendingReadPromise = null;\nlet pendingReadResolve = null;\nlet pendingReadReject = null;\n\nconst _stripModelsPrefix = (path) => path.replace(/^\\/?models\\//, '');\n\n// Called from EM_ASYNC_JS stub in wllama-fs.h (path is already a JS string)\nconst _wllama_js_file_read = async (path, offset, req_size, out_ptr) => {\n  const name = _stripModelsPrefix(path);\n\n  pendingReadPromise = new Promise((res, rej) => {\n    pendingReadResolve = res;\n    pendingReadReject = rej;\n  });\n  isAwaitReading = true;\n\n  postMessage({ verb: 'fs.read_req', args: [name, offset, req_size] });\n\n  let data;\n  try {\n    data = await pendingReadPromise;\n  } finally {\n    isAwaitReading = false;\n    pendingReadResolve = null;\n    pendingReadReject = null;\n  }\n\n  const bytes = new Uint8Array(data);\n  getHeapU8().set(bytes, out_ptr);\n  return toSizeT(bytes.length);\n};\n\n//////////////////////////////////////////////////////////////\n// MAIN CODE\n//////////////////////////////////////////////////////////////\n\nconst callWrapper = (name, ret, args, isAsync) => {\n  const fn = Module.cwrap(\n    name,\n    ret,\n    args,\n    isAsync ? { async: true } : undefined\n  );\n  return async (action, req) => {\n    // console.log(`Calling ${name} with action:`, action, 'and req:', req);\n    let result;\n    try {\n      if (args.length === 2) {\n        result = isAsync ? await fn(action, req) : fn(action, req);\n      } else {\n        result = fn();\n      }\n    } catch (ex) {\n      console.error(ex);\n      throw ex;\n    }\n    return result;\n  };\n};\n\n// re-entering the wasm while a call is suspended (JSPI / asyncify) corrupts its state, so only one call runs at a time and the rest wait in the queue\nlet wasmCallBusy = false;\nconst wasmCallQueue = [];\n\nconst runWasmCall = async (callbackId, fn) => {\n  if (isAborted) {\n    // the wasm is dead, fail fast instead of calling into it\n    msg({ callbackId, err: 'wllama has crashed, please reload the module' });\n    return;\n  }\n  if (wasmCallBusy) {\n    wasmCallQueue.push({ callbackId, fn });\n    return;\n  }\n  wasmCallBusy = true;\n  try {\n    await fn();\n  } finally {\n    wasmCallBusy = false;\n    if (isAborted) {\n      // do not touch the wasm again after it aborted; the main thread already rejected the queued tasks\n      wasmCallQueue.length = 0;\n    } else {\n      const next = wasmCallQueue.shift();\n      if (next) runWasmCall(next.callbackId, next.fn);\n    }\n  }\n};\n\nconst runAction = async (data) => {\n  const { args, callbackId } = data;\n  const argAction = args[0];\n  const argEncodedMsg = args[1];\n  try {\n    const inputPtr = await wllamaMalloc(toSizeT(argEncodedMsg.byteLength), 0);\n    // copy data to wasm heap\n    const inputBuffer = new Uint8Array(\n      getHeapU8().buffer,\n      Number(inputPtr),\n      argEncodedMsg.byteLength\n    );\n    inputBuffer.set(argEncodedMsg, 0);\n    const outputPtr = await wllamaAction(argAction, inputPtr);\n    // length of output buffer is written at the first 4 bytes of input buffer\n    const outputLen = new Uint32Array(\n      getHeapU8().buffer,\n      Number(inputPtr),\n      1\n    )[0];\n    // copy the output buffer to JS heap\n    const outputBuffer = new Uint8Array(outputLen);\n    const outputSrcView = new Uint8Array(\n      getHeapU8().buffer,\n      Number(outputPtr),\n      outputLen\n    );\n    outputBuffer.set(outputSrcView, 0); // copy it\n    msg({ callbackId, result: outputBuffer }, [outputBuffer.buffer]);\n  } catch (err) {\n    handleError(err);\n  }\n};\n\nfunction handleError(err) {\n  // If WASM already aborted, onAbort already sent signal.abort; skip to avoid\n  // re-reporting the resulting WebAssembly.RuntimeError as a JS exception.\n  if (isAborted) return;\n\n  const message = err ? err.message || String(err) : 'Unknown error';\n  const stack = err ? err.stack || String(err) : '';\n  msg({\n    verb: 'signal.abort',\n    args: ['exception', message, stack, err],\n  });\n}\n\nonmessage = async (e) => {\n  if (!e.data) return;\n  const { verb, args, callbackId } = e.data;\n\n  // fs.read_res arrives while wasm is JSPI-suspended; resolve the pending promise.\n  if (verb === 'fs.read_res') {\n    if (pendingReadResolve) {\n      pendingReadResolve(args[0]);\n    }\n    return;\n  }\n\n  // Guard: while awaiting a file read, reject any other incoming task.\n  if (isAwaitReading) {\n    if (callbackId) {\n      msg({\n        callbackId,\n        err: 'Worker is suspended waiting for file data (JSPI)',\n      });\n    }\n    return;\n  }\n\n  if (!callbackId) {\n    msg({ verb: 'console.error', args: ['callbackId is required', e.data] });\n    return;\n  }\n\n  if (verb === 'module.init') {\n    const argMainScriptBlob = args[0];\n    const argUseAsyncFile = args[1];\n    try {\n      Module = getWModuleConfig(argMainScriptBlob);\n      Module.preRun = () => {\n        if (argUseAsyncFile) {\n          Module.ENV['USE_ASYNC_FILE'] = '1';\n        }\n      };\n      Module.onRuntimeInitialized = () => {\n        // async call once module is ready\n        // init FS\n        patchHeapFS();\n        // init cwrap\n        const pointer = isCompat ? 'number' : 'bigint';\n        // TODO: note sure why emscripten cannot bind if there is only 1 argument\n        wllamaMalloc = callWrapper('wllama_malloc', pointer, [\n          'number',\n          pointer,\n        ]);\n        wllamaStart = callWrapper('wllama_start', 'string', [], true);\n        wllamaAction = callWrapper(\n          'wllama_action',\n          pointer,\n          ['string', pointer],\n          true\n        );\n        wllamaExit = callWrapper('wllama_exit', 'string', []);\n        wllamaDebug = callWrapper('wllama_debug', 'string', []);\n        msg({ callbackId, result: null });\n      };\n      wModuleInit();\n    } catch (err) {\n      handleError(err);\n    }\n    return;\n  }\n\n  if (verb === 'fs.alloc') {\n    const argFilename = args[0];\n    const argSize = args[1];\n    const argAllocBuffer = args[2];\n    try {\n      // create blank file\n      const emptyBuffer = new ArrayBuffer(0);\n      Module['FS_createDataFile'](\n        '/models',\n        argFilename,\n        emptyBuffer,\n        true,\n        true,\n        true\n      );\n      // alloc data on heap\n      const fileId = heapfsAlloc(argFilename, argSize, argAllocBuffer);\n      msg({ callbackId, result: { fileId } });\n    } catch (err) {\n      handleError(err);\n    }\n    return;\n  }\n\n  if (verb === 'fs.write') {\n    const argFileId = args[0];\n    const argBuffer = args[1];\n    const argOffset = args[2];\n    try {\n      const writtenBytes = heapfsWrite(argFileId, argBuffer, argOffset);\n      msg({ callbackId, result: { writtenBytes } });\n    } catch (err) {\n      handleError(err);\n    }\n    return;\n  }\n\n  if (verb === 'wllama.start') {\n    await runWasmCall(callbackId, async () => {\n      try {\n        const result = await wllamaStart();\n        msg({ callbackId, result });\n      } catch (err) {\n        handleError(err);\n      }\n    });\n    return;\n  }\n\n  if (verb === 'wllama.action') {\n    await runWasmCall(callbackId, () => runAction(e.data));\n    return;\n  }\n\n  if (verb === 'wllama.exit') {\n    await runWasmCall(callbackId, async () => {\n      try {\n        const result = await wllamaExit();\n        msg({ callbackId, result });\n      } catch (err) {\n        handleError(err);\n      }\n    });\n    return;\n  }\n\n  if (verb === 'wllama.debug') {\n    await runWasmCall(callbackId, async () => {\n      try {\n        const result = await wllamaDebug();\n        msg({ callbackId, result });\n      } catch (err) {\n        handleError(err);\n      }\n    });\n    return;\n  }\n};\n";
var OPFS_UTILS_WORKER_CODE = "let accessHandle;\nlet abortController = new AbortController();\n\nasync function openFile(filename) {\n  const opfsRoot = await navigator.storage.getDirectory();\n  const cacheDir = await opfsRoot.getDirectoryHandle('cache', { create: true });\n  const fileHandler = await cacheDir.getFileHandle(filename, { create: true });\n  accessHandle = await fileHandler.createSyncAccessHandle();\n  accessHandle.truncate(0); // clear file content\n}\n\nasync function writeFile(buf) {\n  accessHandle.write(buf);\n}\n\nasync function closeFile() {\n  accessHandle.flush();\n  accessHandle.close();\n}\n\nasync function writeTextFile(filename, str) {\n  await openFile(filename);\n  await writeFile(new TextEncoder().encode(str));\n  await closeFile();\n}\n\nconst throttled = (func, delay) => {\n  let lastRun = 0;\n  return (...args) => {\n    const now = Date.now();\n    if (now - lastRun > delay) {\n      lastRun = now;\n      func.apply(null, args);\n    }\n  };\n};\n\nconst assertNonNull = (val) => {\n  if (val === null || val === undefined) {\n    throw new Error('OPFS Worker: Assertion failed');\n  }\n};\n\n// respond to main thread\nconst resOK = () => postMessage({ ok: true });\nconst resProgress = (loaded, total) =>\n  postMessage({ progress: { loaded, total } });\nconst resErr = (err) => postMessage({ err });\n\nonmessage = async (e) => {\n  try {\n    if (!e.data) return;\n\n    /**\n     * @param {Object} e.data\n     *\n     * Fine-control FS actions:\n     * - { action: 'open', filename: 'string' }\n     * - { action: 'write', buf: ArrayBuffer }\n     * - { action: 'close' }\n     *\n     * Simple write API:\n     * - { action: 'write-simple', filename: 'string', buf: ArrayBuffer }\n     *\n     * Download API:\n     * - { action: 'download', url: 'string', filename: 'string', options: Object, metadataFileName: 'string' }\n     * - { action: 'download-abort' }\n     */\n    const {\n      action,\n      filename,\n      buf,\n      url,\n      options,\n      metadataFileName,\n      metadataAdditional,\n    } = e.data;\n\n    if (action === 'open') {\n      assertNonNull(filename);\n      await openFile(filename);\n      return resOK();\n    } else if (action === 'write') {\n      assertNonNull(buf);\n      await writeFile(buf);\n      return resOK();\n    } else if (action === 'close') {\n      await closeFile();\n      return resOK();\n    } else if (action === 'write-simple') {\n      assertNonNull(filename);\n      assertNonNull(buf);\n      await openFile(filename);\n      await writeFile(buf);\n      await closeFile();\n      return resOK();\n    } else if (action === 'download') {\n      assertNonNull(url);\n      assertNonNull(filename);\n      assertNonNull(metadataFileName);\n      assertNonNull(options);\n      assertNonNull(options.aborted);\n      abortController = new AbortController();\n      if (options.aborted) abortController.abort();\n      const response = await fetch(url, {\n        ...options,\n        signal: abortController.signal,\n      });\n      const contentLength = response.headers.get('content-length');\n      const etag = (response.headers.get('etag') || '').replace(\n        /[^A-Za-z0-9]/g,\n        ''\n      );\n      const total = parseInt(contentLength, 10);\n      const reader = response.body.getReader();\n      await openFile(filename);\n      let loaded = 0;\n      const throttledProgress = throttled(resProgress, 100);\n      while (true) {\n        const { done, value } = await reader.read();\n        if (done) break;\n        loaded += value.byteLength;\n        await writeFile(value);\n        throttledProgress(loaded, total);\n      }\n      resProgress(total, total); // 100% done\n      await closeFile();\n      // make sure this is in-sync with CacheEntryMetadata\n      await writeTextFile(\n        metadataFileName,\n        JSON.stringify({\n          originalURL: url,\n          originalSize: total,\n          etag,\n          ...metadataAdditional,\n        })\n      );\n      return resOK();\n    } else if (action === 'download-abort') {\n      if (abortController) {\n        abortController.abort();\n      }\n      return;\n    }\n\n    throw new Error('OPFS Worker: Invalid action', e.data);\n  } catch (err) {\n    return resErr(err);\n  }\n};\n";
var WLLAMA_EMSCRIPTEN_CODE = 'var Module=typeof Module!="undefined"?Module:{};var ENVIRONMENT_IS_WEB=!!globalThis.window;var ENVIRONMENT_IS_WORKER=!!globalThis.WorkerGlobalScope;var ENVIRONMENT_IS_NODE=globalThis.process?.versions?.node&&globalThis.process?.type!="renderer";var ENVIRONMENT_IS_PTHREAD=ENVIRONMENT_IS_WORKER&&self.name?.startsWith("em-pthread");if(ENVIRONMENT_IS_NODE){var worker_threads=require("worker_threads");global.Worker=worker_threads.Worker;ENVIRONMENT_IS_WORKER=!worker_threads.isMainThread;ENVIRONMENT_IS_PTHREAD=ENVIRONMENT_IS_WORKER&&worker_threads["workerData"]=="em-pthread"}var arguments_=[];var thisProgram="./this.program";var quit_=(status,toThrow)=>{throw toThrow};var _scriptName=globalThis.document?.currentScript?.src;if(typeof __filename!="undefined"){_scriptName=__filename}else if(ENVIRONMENT_IS_WORKER){_scriptName=self.location.href}var scriptDirectory="";function locateFile(path){if(Module["locateFile"]){return Module["locateFile"](path,scriptDirectory)}return scriptDirectory+path}var readAsync,readBinary;if(ENVIRONMENT_IS_NODE){var fs=require("fs");scriptDirectory=__dirname+"/";readBinary=filename=>{filename=isFileURI(filename)?new URL(filename):filename;var ret=fs.readFileSync(filename);return ret};readAsync=async(filename,binary=true)=>{filename=isFileURI(filename)?new URL(filename):filename;var ret=fs.readFileSync(filename,binary?undefined:"utf8");return ret};if(process.argv.length>1){thisProgram=process.argv[1].replace(/\\\\/g,"/")}arguments_=process.argv.slice(2);if(typeof module!="undefined"){module["exports"]=Module}quit_=(status,toThrow)=>{process.exitCode=status;throw toThrow}}else if(ENVIRONMENT_IS_WEB||ENVIRONMENT_IS_WORKER){try{scriptDirectory=new URL(".",_scriptName).href}catch{}if(!ENVIRONMENT_IS_NODE){if(ENVIRONMENT_IS_WORKER){readBinary=url=>{var xhr=new XMLHttpRequest;xhr.open("GET",url,false);xhr.responseType="arraybuffer";xhr.send(null);return new Uint8Array(xhr.response)}}readAsync=async url=>{if(isFileURI(url)){return new Promise((resolve,reject)=>{var xhr=new XMLHttpRequest;xhr.open("GET",url,true);xhr.responseType="arraybuffer";xhr.onload=()=>{if(xhr.status==200||xhr.status==0&&xhr.response){resolve(xhr.response);return}reject(xhr.status)};xhr.onerror=reject;xhr.send(null)})}var response=await fetch(url,{credentials:"same-origin"});if(response.ok){return response.arrayBuffer()}throw new Error(response.status+" : "+response.url)}}}else{}var defaultPrint=console.log.bind(console);var defaultPrintErr=console.error.bind(console);if(ENVIRONMENT_IS_NODE){var utils=require("util");var stringify=a=>typeof a=="object"?utils.inspect(a):a;defaultPrint=(...args)=>fs.writeSync(1,args.map(stringify).join(" ")+"\\n");defaultPrintErr=(...args)=>fs.writeSync(2,args.map(stringify).join(" ")+"\\n")}var out=defaultPrint;var err=defaultPrintErr;var wasmBinary;var wasmModule;var ABORT=false;var EXITSTATUS;function assert(condition,text){if(!condition){abort(text)}}var isFileURI=filename=>filename.startsWith("file://");function growMemViews(){if(wasmMemory.buffer!=HEAP8.buffer){updateMemoryViews()}}if(ENVIRONMENT_IS_NODE&&ENVIRONMENT_IS_PTHREAD){var parentPort=worker_threads["parentPort"];parentPort.on("message",msg=>global.onmessage?.({data:msg}));Object.assign(globalThis,{self:global,postMessage:msg=>parentPort["postMessage"](msg)});process.on("uncaughtException",err=>{postMessage({cmd:"uncaughtException",error:err});process.exit(1)})}var startWorker;if(ENVIRONMENT_IS_PTHREAD){var initializedJS=false;self.onunhandledrejection=e=>{throw e.reason||e};async function handleMessage(e){try{var msgData=e["data"];var cmd=msgData.cmd;if(cmd==="load"){let messageQueue=[];self.onmessage=e=>messageQueue.push(e);startWorker=()=>{postMessage({cmd:"loaded"});for(let msg of messageQueue){handleMessage(msg)}self.onmessage=handleMessage};for(const handler of msgData.handlers){if(!Module[handler]||Module[handler].proxy){Module[handler]=(...args)=>{postMessage({cmd:"callHandler",handler,args})};if(handler=="print")out=Module[handler];if(handler=="printErr")err=Module[handler]}}wasmMemory=msgData.wasmMemory;updateMemoryViews();wasmModule=msgData.wasmModule;createWasm();run()}else if(cmd==="run"){establishStackSpace(msgData.pthread_ptr);__emscripten_thread_init(msgData.pthread_ptr,0,0,1,0,0);PThread.threadInitTLS();__emscripten_thread_mailbox_await(msgData.pthread_ptr);if(!initializedJS){initializedJS=true}try{await invokeEntryPoint(msgData.start_routine,msgData.arg)}catch(ex){if(ex!="unwind"){throw ex}}}else if(msgData.target==="setimmediate"){}else if(cmd==="checkMailbox"){if(initializedJS){checkMailbox()}}else if(cmd){err(`worker: received unknown command ${cmd}`);err(msgData)}}catch(ex){__emscripten_thread_crashed();throw ex}}self.onmessage=handleMessage}var HEAP8,HEAPU8,HEAP16,HEAPU16,HEAP32,HEAPU32,HEAPF32,HEAPF64;var HEAP64,HEAPU64;var runtimeInitialized=false;function updateMemoryViews(){var b=wasmMemory.buffer;HEAP8=new Int8Array(b);HEAP16=new Int16Array(b);Module["HEAPU8"]=HEAPU8=new Uint8Array(b);HEAPU16=new Uint16Array(b);HEAP32=new Int32Array(b);HEAPU32=new Uint32Array(b);HEAPF32=new Float32Array(b);HEAPF64=new Float64Array(b);HEAP64=new BigInt64Array(b);HEAPU64=new BigUint64Array(b)}function initMemory(){if(ENVIRONMENT_IS_PTHREAD){return}if(Module["wasmMemory"]){wasmMemory=Module["wasmMemory"]}else{var INITIAL_MEMORY=Module["INITIAL_MEMORY"]||134217728;wasmMemory=new WebAssembly.Memory({initial:BigInt(INITIAL_MEMORY/65536),maximum:65536n,shared:true,address:"i64"})}updateMemoryViews()}function preRun(){if(Module["preRun"]){if(typeof Module["preRun"]=="function")Module["preRun"]=[Module["preRun"]];while(Module["preRun"].length){addOnPreRun(Module["preRun"].shift())}}callRuntimeCallbacks(onPreRuns)}function initRuntime(){runtimeInitialized=true;if(ENVIRONMENT_IS_PTHREAD)return startWorker();if(!Module["noFSInit"]&&!FS.initialized)FS.init();TTY.init();wasmExports["__wasm_call_ctors"]();FS.ignorePermissions=false}function preMain(){}function postRun(){if(ENVIRONMENT_IS_PTHREAD){return}if(Module["postRun"]){if(typeof Module["postRun"]=="function")Module["postRun"]=[Module["postRun"]];while(Module["postRun"].length){addOnPostRun(Module["postRun"].shift())}}callRuntimeCallbacks(onPostRuns)}function abort(what){Module["onAbort"]?.(what);what="Aborted("+what+")";err(what);ABORT=true;what+=". Build with -sASSERTIONS for more info.";if(runtimeInitialized){___trap()}var e=new WebAssembly.RuntimeError(what);throw e}var wasmBinaryFile;function findWasmBinary(){return locateFile("wllama.wasm")}function getBinarySync(file){if(file==wasmBinaryFile&&wasmBinary){return new Uint8Array(wasmBinary)}if(readBinary){return readBinary(file)}throw"both async and sync fetching of the wasm failed"}async function getWasmBinary(binaryFile){if(!wasmBinary){try{var response=await readAsync(binaryFile);return new Uint8Array(response)}catch{}}return getBinarySync(binaryFile)}async function instantiateArrayBuffer(binaryFile,imports){try{var binary=await getWasmBinary(binaryFile);var instance=await WebAssembly.instantiate(binary,imports);return instance}catch(reason){err(`failed to asynchronously prepare wasm: ${reason}`);abort(reason)}}async function instantiateAsync(binary,binaryFile,imports){if(!binary&&!isFileURI(binaryFile)&&!ENVIRONMENT_IS_NODE){try{var response=fetch(binaryFile,{credentials:"same-origin"});var instantiationResult=await WebAssembly.instantiateStreaming(response,imports);return instantiationResult}catch(reason){err(`wasm streaming compile failed: ${reason}`);err("falling back to ArrayBuffer instantiation")}}return instantiateArrayBuffer(binaryFile,imports)}function getWasmImports(){assignWasmImports();if(!wasmImports.__instrumented){wasmImports.__instrumented=true;Asyncify.instrumentWasmImports(wasmImports)}var imports={env:wasmImports,wasi_snapshot_preview1:wasmImports};return imports}async function createWasm(){function receiveInstance(instance,module){wasmExports=instance.exports;wasmExports=Asyncify.instrumentWasmExports(wasmExports);wasmExports=applySignatureConversions(wasmExports);registerTLSInit(wasmExports["_emscripten_tls_init"]);assignWasmExports(wasmExports);wasmModule=module;removeRunDependency("wasm-instantiate");return wasmExports}addRunDependency("wasm-instantiate");function receiveInstantiationResult(result){return receiveInstance(result["instance"],result["module"])}var info=getWasmImports();if(Module["instantiateWasm"]){return new Promise((resolve,reject)=>{Module["instantiateWasm"](info,(inst,mod)=>{resolve(receiveInstance(inst,mod))})})}if(ENVIRONMENT_IS_PTHREAD){var instance=new WebAssembly.Instance(wasmModule,getWasmImports());return receiveInstance(instance,wasmModule)}wasmBinaryFile??=findWasmBinary();var result=await instantiateAsync(wasmBinary,wasmBinaryFile,info);var exports=receiveInstantiationResult(result);return exports}class ExitStatus{name="ExitStatus";constructor(status){this.message=`Program terminated with exit(${status})`;this.status=status}}var terminateWorker=worker=>{worker.terminate();worker.onmessage=e=>{}};var cleanupThread=pthread_ptr=>{var worker=PThread.pthreads[pthread_ptr];PThread.returnWorkerToPool(worker)};var callRuntimeCallbacks=callbacks=>{while(callbacks.length>0){callbacks.shift()(Module)}};var onPreRuns=[];var addOnPreRun=cb=>onPreRuns.push(cb);var runDependencies=0;var dependenciesFulfilled=null;var removeRunDependency=id=>{runDependencies--;Module["monitorRunDependencies"]?.(runDependencies);if(runDependencies==0){if(dependenciesFulfilled){var callback=dependenciesFulfilled;dependenciesFulfilled=null;callback()}}};var addRunDependency=id=>{runDependencies++;Module["monitorRunDependencies"]?.(runDependencies)};var spawnThread=threadParams=>{var worker=PThread.getNewWorker();if(!worker){return 6}PThread.runningWorkers.push(worker);PThread.pthreads[threadParams.pthread_ptr]=worker;worker.pthread_ptr=threadParams.pthread_ptr;var msg={cmd:"run",start_routine:threadParams.startRoutine,arg:threadParams.arg,pthread_ptr:threadParams.pthread_ptr};if(ENVIRONMENT_IS_NODE){worker.unref()}worker.postMessage(msg,threadParams.transferList);return 0};var runtimeKeepaliveCounter=0;var keepRuntimeAlive=()=>noExitRuntime||runtimeKeepaliveCounter>0;var stackSave=()=>_emscripten_stack_get_current();var stackRestore=val=>__emscripten_stack_restore(val);var stackAlloc=sz=>__emscripten_stack_alloc(sz);var proxyToMainThread=(funcIndex,emAsmAddr,sync,...callArgs)=>{var serializedNumCallArgs=callArgs.length*2;var sp=stackSave();var args=stackAlloc(serializedNumCallArgs*8);var b=args/8;for(var i=0;i<callArgs.length;i++){var arg=callArgs[i];if(typeof arg=="bigint"){(growMemViews(),HEAP64)[b+2*i]=1n;(growMemViews(),HEAP64)[b+2*i+1]=arg}else{(growMemViews(),HEAP64)[b+2*i]=0n;(growMemViews(),HEAPF64)[b+2*i+1]=arg}}var rtn=__emscripten_run_js_on_main_thread(funcIndex,emAsmAddr,serializedNumCallArgs,args,sync);stackRestore(sp);return rtn};function _proc_exit(code){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(0,0,1,code);EXITSTATUS=code;if(!keepRuntimeAlive()){PThread.terminateAllThreads();Module["onExit"]?.(code);ABORT=true}quit_(code,new ExitStatus(code))}function exitOnMainThread(returnCode){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(1,0,0,returnCode);_exit(returnCode)}var exitJS=(status,implicit)=>{EXITSTATUS=status;if(ENVIRONMENT_IS_PTHREAD){exitOnMainThread(status);throw"unwind"}_proc_exit(status)};var _exit=exitJS;var PThread={unusedWorkers:[],runningWorkers:[],tlsInitFunctions:[],pthreads:{},init(){if(!ENVIRONMENT_IS_PTHREAD){PThread.initMainThread()}},initMainThread(){var pthreadPoolSize=Module["pthreadPoolSize"];while(pthreadPoolSize--){PThread.allocateUnusedWorker()}addOnPreRun(async()=>{var pthreadPoolReady=PThread.loadWasmModuleToAllWorkers();addRunDependency("loading-workers");await pthreadPoolReady;removeRunDependency("loading-workers")})},terminateAllThreads:()=>{for(var worker of PThread.runningWorkers){terminateWorker(worker)}for(var worker of PThread.unusedWorkers){terminateWorker(worker)}PThread.unusedWorkers=[];PThread.runningWorkers=[];PThread.pthreads={}},returnWorkerToPool:worker=>{var pthread_ptr=worker.pthread_ptr;delete PThread.pthreads[pthread_ptr];PThread.unusedWorkers.push(worker);PThread.runningWorkers.splice(PThread.runningWorkers.indexOf(worker),1);worker.pthread_ptr=0;__emscripten_thread_free_data(pthread_ptr)},threadInitTLS(){PThread.tlsInitFunctions.forEach(f=>f())},loadWasmModuleToWorker:worker=>new Promise(onFinishedLoading=>{worker.onmessage=e=>{var d=e["data"];var cmd=d.cmd;if(d.targetThread&&d.targetThread!=_pthread_self()){var targetWorker=PThread.pthreads[d.targetThread];if(targetWorker){targetWorker.postMessage(d,d.transferList)}else{err(`Internal error! Worker sent a message "${cmd}" to target pthread ${d.targetThread}, but that thread no longer exists!`)}return}if(cmd==="checkMailbox"){checkMailbox()}else if(cmd==="spawnThread"){spawnThread(d)}else if(cmd==="cleanupThread"){callUserCallback(()=>cleanupThread(d.thread))}else if(cmd==="loaded"){worker.loaded=true;if(ENVIRONMENT_IS_NODE&&!worker.pthread_ptr){worker.unref()}onFinishedLoading(worker)}else if(d.target==="setimmediate"){worker.postMessage(d)}else if(cmd==="uncaughtException"){worker.onerror(d.error)}else if(cmd==="callHandler"){Module[d.handler](...d.args)}else if(cmd){err(`worker sent an unknown command ${cmd}`)}};worker.onerror=e=>{var message="worker sent an error!";err(`${message} ${e.filename}:${e.lineno}: ${e.message}`);throw e};if(ENVIRONMENT_IS_NODE){worker.on("message",data=>worker.onmessage({data}));worker.on("error",e=>worker.onerror(e))}var handlers=[];var knownHandlers=["onExit","onAbort","print","printErr"];for(var handler of knownHandlers){if(Module.propertyIsEnumerable(handler)){handlers.push(handler)}}worker.postMessage({cmd:"load",handlers,wasmMemory,wasmModule})}),async loadWasmModuleToAllWorkers(){if(ENVIRONMENT_IS_PTHREAD){return}let pthreadPoolReady=Promise.all(PThread.unusedWorkers.map(PThread.loadWasmModuleToWorker));return pthreadPoolReady},allocateUnusedWorker(){var worker;var pthreadMainJs=_scriptName;if(Module["mainScriptUrlOrBlob"]){pthreadMainJs=Module["mainScriptUrlOrBlob"];if(typeof pthreadMainJs!="string"){pthreadMainJs=URL.createObjectURL(pthreadMainJs)}}worker=new Worker(pthreadMainJs,{workerData:"em-pthread",name:"em-pthread"});PThread.unusedWorkers.push(worker)},getNewWorker(){if(PThread.unusedWorkers.length==0){PThread.allocateUnusedWorker();PThread.loadWasmModuleToWorker(PThread.unusedWorkers[0])}return PThread.unusedWorkers.pop()}};var onPostRuns=[];var addOnPostRun=cb=>onPostRuns.push(cb);function establishStackSpace(pthread_ptr){var stackHigh=Number((growMemViews(),HEAPU64)[(pthread_ptr+88)/8]);var stackSize=Number((growMemViews(),HEAPU64)[(pthread_ptr+96)/8]);var stackLow=stackHigh-stackSize;_emscripten_stack_set_limits(stackHigh,stackLow);stackRestore(stackHigh)}var wasmTableMirror=[];var getWasmTableEntry=funcPtr=>{funcPtr=Number(funcPtr);var func=wasmTableMirror[funcPtr];if(!func){wasmTableMirror[funcPtr]=func=wasmTable.get(BigInt(funcPtr));if(Asyncify.isAsyncExport(func)){wasmTableMirror[funcPtr]=func=Asyncify.makeAsyncFunction(func)}}return func};var invokeEntryPoint=async(ptr,arg)=>{runtimeKeepaliveCounter=0;noExitRuntime=0;var result=(a1=>WebAssembly.promising(getWasmTableEntry(ptr)).call(null,BigInt(a1)))(arg);function finish(result){if(keepRuntimeAlive()){EXITSTATUS=result;return}__emscripten_thread_exit(result)}result=await result;finish(result)};invokeEntryPoint.isAsync=true;var noExitRuntime=true;var registerTLSInit=tlsInitFunc=>PThread.tlsInitFunctions.push(tlsInitFunc);var wasmMemory;function pthreadCreateProxied(pthread_ptr,attr,startRoutine,arg){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(2,0,1,pthread_ptr,attr,startRoutine,arg);return ___pthread_create_js(pthread_ptr,attr,startRoutine,arg)}var _emscripten_has_threading_support=()=>!!globalThis.SharedArrayBuffer;var INT53_MAX=9007199254740992;var INT53_MIN=-9007199254740992;var bigintToI53Checked=num=>num<INT53_MIN||num>INT53_MAX?NaN:Number(num);function ___pthread_create_js(pthread_ptr,attr,startRoutine,arg){pthread_ptr=bigintToI53Checked(pthread_ptr);attr=bigintToI53Checked(attr);startRoutine=bigintToI53Checked(startRoutine);arg=bigintToI53Checked(arg);if(!_emscripten_has_threading_support()){return 6}var transferList=[];var error=0;if(ENVIRONMENT_IS_PTHREAD&&(transferList.length===0||error)){return pthreadCreateProxied(pthread_ptr,attr,startRoutine,arg)}if(error)return error;var threadParams={startRoutine,pthread_ptr,arg,transferList};if(ENVIRONMENT_IS_PTHREAD){threadParams.cmd="spawnThread";postMessage(threadParams,transferList);return 0}return spawnThread(threadParams)}var syscallGetVarargP=()=>{var ret=Number((growMemViews(),HEAPU64)[SYSCALLS.varargs/8]);SYSCALLS.varargs+=8;return ret};var syscallGetVarargI=()=>{var ret=(growMemViews(),HEAP32)[+SYSCALLS.varargs/4];SYSCALLS.varargs+=4;return ret};var PATH={isAbs:path=>path.charAt(0)==="/",splitPath:filename=>{var splitPathRe=/^(\\/?|)([\\s\\S]*?)((?:\\.{1,2}|[^\\/]+?|)(\\.[^.\\/]*|))(?:[\\/]*)$/;return splitPathRe.exec(filename).slice(1)},normalizeArray:(parts,allowAboveRoot)=>{var up=0;for(var i=parts.length-1;i>=0;i--){var last=parts[i];if(last==="."){parts.splice(i,1)}else if(last===".."){parts.splice(i,1);up++}else if(up){parts.splice(i,1);up--}}if(allowAboveRoot){for(;up;up--){parts.unshift("..")}}return parts},normalize:path=>{var isAbsolute=PATH.isAbs(path),trailingSlash=path.slice(-1)==="/";path=PATH.normalizeArray(path.split("/").filter(p=>!!p),!isAbsolute).join("/");if(!path&&!isAbsolute){path="."}if(path&&trailingSlash){path+="/"}return(isAbsolute?"/":"")+path},dirname:path=>{var result=PATH.splitPath(path),root=result[0],dir=result[1];if(!root&&!dir){return"."}if(dir){dir=dir.slice(0,-1)}return root+dir},basename:path=>path&&path.match(/([^\\/]+|\\/)\\/*$/)[1],join:(...paths)=>PATH.normalize(paths.join("/")),join2:(l,r)=>PATH.normalize(l+"/"+r)};var initRandomFill=()=>view=>view.set(crypto.getRandomValues(new Uint8Array(view.byteLength)));var randomFill=view=>{(randomFill=initRandomFill())(view)};var PATH_FS={resolve:(...args)=>{var resolvedPath="",resolvedAbsolute=false;for(var i=args.length-1;i>=-1&&!resolvedAbsolute;i--){var path=i>=0?args[i]:FS.cwd();if(typeof path!="string"){throw new TypeError("Arguments to path.resolve must be strings")}else if(!path){return""}resolvedPath=path+"/"+resolvedPath;resolvedAbsolute=PATH.isAbs(path)}resolvedPath=PATH.normalizeArray(resolvedPath.split("/").filter(p=>!!p),!resolvedAbsolute).join("/");return(resolvedAbsolute?"/":"")+resolvedPath||"."},relative:(from,to)=>{from=PATH_FS.resolve(from).slice(1);to=PATH_FS.resolve(to).slice(1);function trim(arr){var start=0;for(;start<arr.length;start++){if(arr[start]!=="")break}var end=arr.length-1;for(;end>=0;end--){if(arr[end]!=="")break}if(start>end)return[];return arr.slice(start,end-start+1)}var fromParts=trim(from.split("/"));var toParts=trim(to.split("/"));var length=Math.min(fromParts.length,toParts.length);var samePartsLength=length;for(var i=0;i<length;i++){if(fromParts[i]!==toParts[i]){samePartsLength=i;break}}var outputParts=[];for(var i=samePartsLength;i<fromParts.length;i++){outputParts.push("..")}outputParts=outputParts.concat(toParts.slice(samePartsLength));return outputParts.join("/")}};var UTF8Decoder=globalThis.TextDecoder&&new TextDecoder;var findStringEnd=(heapOrArray,idx,maxBytesToRead,ignoreNul)=>{var maxIdx=idx+maxBytesToRead;if(ignoreNul)return maxIdx;while(heapOrArray[idx]&&!(idx>=maxIdx))++idx;return idx};var UTF8ArrayToString=(heapOrArray,idx=0,maxBytesToRead,ignoreNul)=>{var endPtr=findStringEnd(heapOrArray,idx,maxBytesToRead,ignoreNul);if(endPtr-idx>16&&heapOrArray.buffer&&UTF8Decoder){return UTF8Decoder.decode(heapOrArray.buffer instanceof ArrayBuffer?heapOrArray.subarray(idx,endPtr):heapOrArray.slice(idx,endPtr))}var str="";while(idx<endPtr){var u0=heapOrArray[idx++];if(!(u0&128)){str+=String.fromCharCode(u0);continue}var u1=heapOrArray[idx++]&63;if((u0&224)==192){str+=String.fromCharCode((u0&31)<<6|u1);continue}var u2=heapOrArray[idx++]&63;if((u0&240)==224){u0=(u0&15)<<12|u1<<6|u2}else{u0=(u0&7)<<18|u1<<12|u2<<6|heapOrArray[idx++]&63}if(u0<65536){str+=String.fromCharCode(u0)}else{var ch=u0-65536;str+=String.fromCharCode(55296|ch>>10,56320|ch&1023)}}return str};var FS_stdin_getChar_buffer=[];var lengthBytesUTF8=str=>{var len=0;for(var i=0;i<str.length;++i){var c=str.charCodeAt(i);if(c<=127){len++}else if(c<=2047){len+=2}else if(c>=55296&&c<=57343){len+=4;++i}else{len+=3}}return len};var stringToUTF8Array=(str,heap,outIdx,maxBytesToWrite)=>{if(!(maxBytesToWrite>0))return 0;var startIdx=outIdx;var endIdx=outIdx+maxBytesToWrite-1;for(var i=0;i<str.length;++i){var u=str.codePointAt(i);if(u<=127){if(outIdx>=endIdx)break;heap[outIdx++]=u}else if(u<=2047){if(outIdx+1>=endIdx)break;heap[outIdx++]=192|u>>6;heap[outIdx++]=128|u&63}else if(u<=65535){if(outIdx+2>=endIdx)break;heap[outIdx++]=224|u>>12;heap[outIdx++]=128|u>>6&63;heap[outIdx++]=128|u&63}else{if(outIdx+3>=endIdx)break;heap[outIdx++]=240|u>>18;heap[outIdx++]=128|u>>12&63;heap[outIdx++]=128|u>>6&63;heap[outIdx++]=128|u&63;i++}}heap[outIdx]=0;return outIdx-startIdx};var intArrayFromString=(stringy,dontAddNull,length)=>{var len=length>0?length:lengthBytesUTF8(stringy)+1;var u8array=new Array(len);var numBytesWritten=stringToUTF8Array(stringy,u8array,0,u8array.length);if(dontAddNull)u8array.length=numBytesWritten;return u8array};var FS_stdin_getChar=()=>{if(!FS_stdin_getChar_buffer.length){var result=null;if(ENVIRONMENT_IS_NODE){var BUFSIZE=256;var buf=Buffer.alloc(BUFSIZE);var bytesRead=0;var fd=process.stdin.fd;try{bytesRead=fs.readSync(fd,buf,0,BUFSIZE)}catch(e){if(e.toString().includes("EOF"))bytesRead=0;else throw e}if(bytesRead>0){result=buf.slice(0,bytesRead).toString("utf-8")}}else if(globalThis.window?.prompt){result=window.prompt("Input: ");if(result!==null){result+="\\n"}}else{}if(!result){return null}FS_stdin_getChar_buffer=intArrayFromString(result,true)}return FS_stdin_getChar_buffer.shift()};var TTY={ttys:[],init(){},shutdown(){},register(dev,ops){TTY.ttys[dev]={input:[],output:[],ops};FS.registerDevice(dev,TTY.stream_ops)},stream_ops:{open(stream){var tty=TTY.ttys[stream.node.rdev];if(!tty){throw new FS.ErrnoError(43)}stream.tty=tty;stream.seekable=false},close(stream){stream.tty.ops.fsync(stream.tty)},fsync(stream){stream.tty.ops.fsync(stream.tty)},read(stream,buffer,offset,length,pos){if(!stream.tty||!stream.tty.ops.get_char){throw new FS.ErrnoError(60)}var bytesRead=0;for(var i=0;i<length;i++){var result;try{result=stream.tty.ops.get_char(stream.tty)}catch(e){throw new FS.ErrnoError(29)}if(result===undefined&&bytesRead===0){throw new FS.ErrnoError(6)}if(result===null||result===undefined)break;bytesRead++;buffer[offset+i]=result}if(bytesRead){stream.node.atime=Date.now()}return bytesRead},write(stream,buffer,offset,length,pos){if(!stream.tty||!stream.tty.ops.put_char){throw new FS.ErrnoError(60)}try{for(var i=0;i<length;i++){stream.tty.ops.put_char(stream.tty,buffer[offset+i])}}catch(e){throw new FS.ErrnoError(29)}if(length){stream.node.mtime=stream.node.ctime=Date.now()}return i}},default_tty_ops:{get_char(tty){return FS_stdin_getChar()},put_char(tty,val){if(val===null||val===10){out(UTF8ArrayToString(tty.output));tty.output=[]}else{if(val!=0)tty.output.push(val)}},fsync(tty){if(tty.output?.length>0){out(UTF8ArrayToString(tty.output));tty.output=[]}},ioctl_tcgets(tty){return{c_iflag:25856,c_oflag:5,c_cflag:191,c_lflag:35387,c_cc:[3,28,127,21,4,0,1,0,17,19,26,0,18,15,23,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}},ioctl_tcsets(tty,optional_actions,data){return 0},ioctl_tiocgwinsz(tty){return[24,80]}},default_tty1_ops:{put_char(tty,val){if(val===null||val===10){err(UTF8ArrayToString(tty.output));tty.output=[]}else{if(val!=0)tty.output.push(val)}},fsync(tty){if(tty.output?.length>0){err(UTF8ArrayToString(tty.output));tty.output=[]}}}};var zeroMemory=(ptr,size)=>(growMemViews(),HEAPU8).fill(0,ptr,ptr+size);var alignMemory=(size,alignment)=>Math.ceil(size/alignment)*alignment;var mmapAlloc=size=>{size=alignMemory(size,65536);var ptr=_emscripten_builtin_memalign(65536,size);if(ptr)zeroMemory(ptr,size);return ptr};var MEMFS={ops_table:null,mount(mount){return MEMFS.createNode(null,"/",16895,0)},createNode(parent,name,mode,dev){if(FS.isBlkdev(mode)||FS.isFIFO(mode)){throw new FS.ErrnoError(63)}MEMFS.ops_table||={dir:{node:{getattr:MEMFS.node_ops.getattr,setattr:MEMFS.node_ops.setattr,lookup:MEMFS.node_ops.lookup,mknod:MEMFS.node_ops.mknod,rename:MEMFS.node_ops.rename,unlink:MEMFS.node_ops.unlink,rmdir:MEMFS.node_ops.rmdir,readdir:MEMFS.node_ops.readdir,symlink:MEMFS.node_ops.symlink},stream:{llseek:MEMFS.stream_ops.llseek}},file:{node:{getattr:MEMFS.node_ops.getattr,setattr:MEMFS.node_ops.setattr},stream:{llseek:MEMFS.stream_ops.llseek,read:MEMFS.stream_ops.read,write:MEMFS.stream_ops.write,mmap:MEMFS.stream_ops.mmap,msync:MEMFS.stream_ops.msync}},link:{node:{getattr:MEMFS.node_ops.getattr,setattr:MEMFS.node_ops.setattr,readlink:MEMFS.node_ops.readlink},stream:{}},chrdev:{node:{getattr:MEMFS.node_ops.getattr,setattr:MEMFS.node_ops.setattr},stream:FS.chrdev_stream_ops}};var node=FS.createNode(parent,name,mode,dev);if(FS.isDir(node.mode)){node.node_ops=MEMFS.ops_table.dir.node;node.stream_ops=MEMFS.ops_table.dir.stream;node.contents={}}else if(FS.isFile(node.mode)){node.node_ops=MEMFS.ops_table.file.node;node.stream_ops=MEMFS.ops_table.file.stream;node.usedBytes=0;node.contents=null}else if(FS.isLink(node.mode)){node.node_ops=MEMFS.ops_table.link.node;node.stream_ops=MEMFS.ops_table.link.stream}else if(FS.isChrdev(node.mode)){node.node_ops=MEMFS.ops_table.chrdev.node;node.stream_ops=MEMFS.ops_table.chrdev.stream}node.atime=node.mtime=node.ctime=Date.now();if(parent){parent.contents[name]=node;parent.atime=parent.mtime=parent.ctime=node.atime}return node},getFileDataAsTypedArray(node){if(!node.contents)return new Uint8Array(0);if(node.contents.subarray)return node.contents.subarray(0,node.usedBytes);return new Uint8Array(node.contents)},expandFileStorage(node,newCapacity){var prevCapacity=node.contents?node.contents.length:0;if(prevCapacity>=newCapacity)return;var CAPACITY_DOUBLING_MAX=1024*1024;newCapacity=Math.max(newCapacity,prevCapacity*(prevCapacity<CAPACITY_DOUBLING_MAX?2:1.125)>>>0);if(prevCapacity!=0)newCapacity=Math.max(newCapacity,256);var oldContents=node.contents;node.contents=new Uint8Array(newCapacity);if(node.usedBytes>0)node.contents.set(oldContents.subarray(0,node.usedBytes),0)},resizeFileStorage(node,newSize){if(node.usedBytes==newSize)return;if(newSize==0){node.contents=null;node.usedBytes=0}else{var oldContents=node.contents;node.contents=new Uint8Array(newSize);if(oldContents){node.contents.set(oldContents.subarray(0,Math.min(newSize,node.usedBytes)))}node.usedBytes=newSize}},node_ops:{getattr(node){var attr={};attr.dev=FS.isChrdev(node.mode)?node.id:1;attr.ino=node.id;attr.mode=node.mode;attr.nlink=1;attr.uid=0;attr.gid=0;attr.rdev=node.rdev;if(FS.isDir(node.mode)){attr.size=4096}else if(FS.isFile(node.mode)){attr.size=node.usedBytes}else if(FS.isLink(node.mode)){attr.size=node.link.length}else{attr.size=0}attr.atime=new Date(node.atime);attr.mtime=new Date(node.mtime);attr.ctime=new Date(node.ctime);attr.blksize=4096;attr.blocks=Math.ceil(attr.size/attr.blksize);return attr},setattr(node,attr){for(const key of["mode","atime","mtime","ctime"]){if(attr[key]!=null){node[key]=attr[key]}}if(attr.size!==undefined){MEMFS.resizeFileStorage(node,attr.size)}},lookup(parent,name){if(!MEMFS.doesNotExistError){MEMFS.doesNotExistError=new FS.ErrnoError(44);MEMFS.doesNotExistError.stack="<generic error, no stack>"}throw MEMFS.doesNotExistError},mknod(parent,name,mode,dev){return MEMFS.createNode(parent,name,mode,dev)},rename(old_node,new_dir,new_name){var new_node;try{new_node=FS.lookupNode(new_dir,new_name)}catch(e){}if(new_node){if(FS.isDir(old_node.mode)){for(var i in new_node.contents){throw new FS.ErrnoError(55)}}FS.hashRemoveNode(new_node)}delete old_node.parent.contents[old_node.name];new_dir.contents[new_name]=old_node;old_node.name=new_name;new_dir.ctime=new_dir.mtime=old_node.parent.ctime=old_node.parent.mtime=Date.now()},unlink(parent,name){delete parent.contents[name];parent.ctime=parent.mtime=Date.now()},rmdir(parent,name){var node=FS.lookupNode(parent,name);for(var i in node.contents){throw new FS.ErrnoError(55)}delete parent.contents[name];parent.ctime=parent.mtime=Date.now()},readdir(node){return[".","..",...Object.keys(node.contents)]},symlink(parent,newname,oldpath){var node=MEMFS.createNode(parent,newname,511|40960,0);node.link=oldpath;return node},readlink(node){if(!FS.isLink(node.mode)){throw new FS.ErrnoError(28)}return node.link}},stream_ops:{read(stream,buffer,offset,length,position){var contents=stream.node.contents;if(position>=stream.node.usedBytes)return 0;var size=Math.min(stream.node.usedBytes-position,length);if(size>8&&contents.subarray){buffer.set(contents.subarray(position,position+size),offset)}else{for(var i=0;i<size;i++)buffer[offset+i]=contents[position+i]}return size},write(stream,buffer,offset,length,position,canOwn){if(buffer.buffer===(growMemViews(),HEAP8).buffer){canOwn=false}if(!length)return 0;var node=stream.node;node.mtime=node.ctime=Date.now();if(buffer.subarray&&(!node.contents||node.contents.subarray)){if(canOwn){node.contents=buffer.subarray(offset,offset+length);node.usedBytes=length;return length}else if(node.usedBytes===0&&position===0){node.contents=buffer.slice(offset,offset+length);node.usedBytes=length;return length}else if(position+length<=node.usedBytes){node.contents.set(buffer.subarray(offset,offset+length),position);return length}}MEMFS.expandFileStorage(node,position+length);if(node.contents.subarray&&buffer.subarray){node.contents.set(buffer.subarray(offset,offset+length),position)}else{for(var i=0;i<length;i++){node.contents[position+i]=buffer[offset+i]}}node.usedBytes=Math.max(node.usedBytes,position+length);return length},llseek(stream,offset,whence){var position=offset;if(whence===1){position+=stream.position}else if(whence===2){if(FS.isFile(stream.node.mode)){position+=stream.node.usedBytes}}if(position<0){throw new FS.ErrnoError(28)}return position},mmap(stream,length,position,prot,flags){if(!FS.isFile(stream.node.mode)){throw new FS.ErrnoError(43)}var ptr;var allocated;var contents=stream.node.contents;if(!(flags&2)&&contents&&contents.buffer===(growMemViews(),HEAP8).buffer){allocated=false;ptr=contents.byteOffset}else{allocated=true;ptr=mmapAlloc(length);if(!ptr){throw new FS.ErrnoError(48)}if(contents){if(position>0||position+length<contents.length){if(contents.subarray){contents=contents.subarray(position,position+length)}else{contents=Array.prototype.slice.call(contents,position,position+length)}}(growMemViews(),HEAP8).set(contents,ptr)}}return{ptr,allocated}},msync(stream,buffer,offset,length,mmapFlags){MEMFS.stream_ops.write(stream,buffer,0,length,offset,false);return 0}}};var FS_modeStringToFlags=str=>{var flagModes={r:0,"r+":2,w:512|64|1,"w+":512|64|2,a:1024|64|1,"a+":1024|64|2};var flags=flagModes[str];if(typeof flags=="undefined"){throw new Error(`Unknown file open mode: ${str}`)}return flags};var FS_getMode=(canRead,canWrite)=>{var mode=0;if(canRead)mode|=292|73;if(canWrite)mode|=146;return mode};var asyncLoad=async url=>{var arrayBuffer=await readAsync(url);return new Uint8Array(arrayBuffer)};var FS_createDataFile=(...args)=>FS.createDataFile(...args);var getUniqueRunDependency=id=>id;var preloadPlugins=[];var FS_handledByPreloadPlugin=async(byteArray,fullname)=>{if(typeof Browser!="undefined")Browser.init();for(var plugin of preloadPlugins){if(plugin["canHandle"](fullname)){return plugin["handle"](byteArray,fullname)}}return byteArray};var FS_preloadFile=async(parent,name,url,canRead,canWrite,dontCreateFile,canOwn,preFinish)=>{var fullname=name?PATH_FS.resolve(PATH.join2(parent,name)):parent;var dep=getUniqueRunDependency(`cp ${fullname}`);addRunDependency(dep);try{var byteArray=url;if(typeof url=="string"){byteArray=await asyncLoad(url)}byteArray=await FS_handledByPreloadPlugin(byteArray,fullname);preFinish?.();if(!dontCreateFile){FS_createDataFile(parent,name,byteArray,canRead,canWrite,canOwn)}}finally{removeRunDependency(dep)}};var FS_createPreloadedFile=(parent,name,url,canRead,canWrite,onload,onerror,dontCreateFile,canOwn,preFinish)=>{FS_preloadFile(parent,name,url,canRead,canWrite,dontCreateFile,canOwn,preFinish).then(onload).catch(onerror)};var FS={root:null,mounts:[],devices:{},streams:[],nextInode:1,nameTable:null,currentPath:"/",initialized:false,ignorePermissions:true,filesystems:null,syncFSRequests:0,readFiles:{},ErrnoError:class{name="ErrnoError";constructor(errno){this.errno=errno}},FSStream:class{shared={};get object(){return this.node}set object(val){this.node=val}get isRead(){return(this.flags&2097155)!==1}get isWrite(){return(this.flags&2097155)!==0}get isAppend(){return this.flags&1024}get flags(){return this.shared.flags}set flags(val){this.shared.flags=val}get position(){return this.shared.position}set position(val){this.shared.position=val}},FSNode:class{node_ops={};stream_ops={};readMode=292|73;writeMode=146;mounted=null;constructor(parent,name,mode,rdev){if(!parent){parent=this}this.parent=parent;this.mount=parent.mount;this.id=FS.nextInode++;this.name=name;this.mode=mode;this.rdev=rdev;this.atime=this.mtime=this.ctime=Date.now()}get read(){return(this.mode&this.readMode)===this.readMode}set read(val){val?this.mode|=this.readMode:this.mode&=~this.readMode}get write(){return(this.mode&this.writeMode)===this.writeMode}set write(val){val?this.mode|=this.writeMode:this.mode&=~this.writeMode}get isFolder(){return FS.isDir(this.mode)}get isDevice(){return FS.isChrdev(this.mode)}},lookupPath(path,opts={}){if(!path){throw new FS.ErrnoError(44)}opts.follow_mount??=true;if(!PATH.isAbs(path)){path=FS.cwd()+"/"+path}linkloop:for(var nlinks=0;nlinks<40;nlinks++){var parts=path.split("/").filter(p=>!!p);var current=FS.root;var current_path="/";for(var i=0;i<parts.length;i++){var islast=i===parts.length-1;if(islast&&opts.parent){break}if(parts[i]==="."){continue}if(parts[i]===".."){current_path=PATH.dirname(current_path);if(FS.isRoot(current)){path=current_path+"/"+parts.slice(i+1).join("/");nlinks--;continue linkloop}else{current=current.parent}continue}current_path=PATH.join2(current_path,parts[i]);try{current=FS.lookupNode(current,parts[i])}catch(e){if(e?.errno===44&&islast&&opts.noent_okay){return{path:current_path}}throw e}if(FS.isMountpoint(current)&&(!islast||opts.follow_mount)){current=current.mounted.root}if(FS.isLink(current.mode)&&(!islast||opts.follow)){if(!current.node_ops.readlink){throw new FS.ErrnoError(52)}var link=current.node_ops.readlink(current);if(!PATH.isAbs(link)){link=PATH.dirname(current_path)+"/"+link}path=link+"/"+parts.slice(i+1).join("/");continue linkloop}}return{path:current_path,node:current}}throw new FS.ErrnoError(32)},getPath(node){var path;while(true){if(FS.isRoot(node)){var mount=node.mount.mountpoint;if(!path)return mount;return mount[mount.length-1]!=="/"?`${mount}/${path}`:mount+path}path=path?`${node.name}/${path}`:node.name;node=node.parent}},hashName(parentid,name){var hash=0;for(var i=0;i<name.length;i++){hash=(hash<<5)-hash+name.charCodeAt(i)|0}return(parentid+hash>>>0)%FS.nameTable.length},hashAddNode(node){var hash=FS.hashName(node.parent.id,node.name);node.name_next=FS.nameTable[hash];FS.nameTable[hash]=node},hashRemoveNode(node){var hash=FS.hashName(node.parent.id,node.name);if(FS.nameTable[hash]===node){FS.nameTable[hash]=node.name_next}else{var current=FS.nameTable[hash];while(current){if(current.name_next===node){current.name_next=node.name_next;break}current=current.name_next}}},lookupNode(parent,name){var errCode=FS.mayLookup(parent);if(errCode){throw new FS.ErrnoError(errCode)}var hash=FS.hashName(parent.id,name);for(var node=FS.nameTable[hash];node;node=node.name_next){var nodeName=node.name;if(node.parent.id===parent.id&&nodeName===name){return node}}return FS.lookup(parent,name)},createNode(parent,name,mode,rdev){var node=new FS.FSNode(parent,name,mode,rdev);FS.hashAddNode(node);return node},destroyNode(node){FS.hashRemoveNode(node)},isRoot(node){return node===node.parent},isMountpoint(node){return!!node.mounted},isFile(mode){return(mode&61440)===32768},isDir(mode){return(mode&61440)===16384},isLink(mode){return(mode&61440)===40960},isChrdev(mode){return(mode&61440)===8192},isBlkdev(mode){return(mode&61440)===24576},isFIFO(mode){return(mode&61440)===4096},isSocket(mode){return(mode&49152)===49152},flagsToPermissionString(flag){var perms=["r","w","rw"][flag&3];if(flag&512){perms+="w"}return perms},nodePermissions(node,perms){if(FS.ignorePermissions){return 0}if(perms.includes("r")&&!(node.mode&292)){return 2}else if(perms.includes("w")&&!(node.mode&146)){return 2}else if(perms.includes("x")&&!(node.mode&73)){return 2}return 0},mayLookup(dir){if(!FS.isDir(dir.mode))return 54;var errCode=FS.nodePermissions(dir,"x");if(errCode)return errCode;if(!dir.node_ops.lookup)return 2;return 0},mayCreate(dir,name){if(!FS.isDir(dir.mode)){return 54}try{var node=FS.lookupNode(dir,name);return 20}catch(e){}return FS.nodePermissions(dir,"wx")},mayDelete(dir,name,isdir){var node;try{node=FS.lookupNode(dir,name)}catch(e){return e.errno}var errCode=FS.nodePermissions(dir,"wx");if(errCode){return errCode}if(isdir){if(!FS.isDir(node.mode)){return 54}if(FS.isRoot(node)||FS.getPath(node)===FS.cwd()){return 10}}else{if(FS.isDir(node.mode)){return 31}}return 0},mayOpen(node,flags){if(!node){return 44}if(FS.isLink(node.mode)){return 32}else if(FS.isDir(node.mode)){if(FS.flagsToPermissionString(flags)!=="r"||flags&(512|64)){return 31}}return FS.nodePermissions(node,FS.flagsToPermissionString(flags))},checkOpExists(op,err){if(!op){throw new FS.ErrnoError(err)}return op},MAX_OPEN_FDS:4096,nextfd(){for(var fd=0;fd<=FS.MAX_OPEN_FDS;fd++){if(!FS.streams[fd]){return fd}}throw new FS.ErrnoError(33)},getStreamChecked(fd){var stream=FS.getStream(fd);if(!stream){throw new FS.ErrnoError(8)}return stream},getStream:fd=>FS.streams[fd],createStream(stream,fd=-1){stream=Object.assign(new FS.FSStream,stream);if(fd==-1){fd=FS.nextfd()}stream.fd=fd;FS.streams[fd]=stream;return stream},closeStream(fd){FS.streams[fd]=null},dupStream(origStream,fd=-1){var stream=FS.createStream(origStream,fd);stream.stream_ops?.dup?.(stream);return stream},doSetAttr(stream,node,attr){var setattr=stream?.stream_ops.setattr;var arg=setattr?stream:node;setattr??=node.node_ops.setattr;FS.checkOpExists(setattr,63);setattr(arg,attr)},chrdev_stream_ops:{open(stream){var device=FS.getDevice(stream.node.rdev);stream.stream_ops=device.stream_ops;stream.stream_ops.open?.(stream)},llseek(){throw new FS.ErrnoError(70)}},major:dev=>dev>>8,minor:dev=>dev&255,makedev:(ma,mi)=>ma<<8|mi,registerDevice(dev,ops){FS.devices[dev]={stream_ops:ops}},getDevice:dev=>FS.devices[dev],getMounts(mount){var mounts=[];var check=[mount];while(check.length){var m=check.pop();mounts.push(m);check.push(...m.mounts)}return mounts},syncfs(populate,callback){if(typeof populate=="function"){callback=populate;populate=false}FS.syncFSRequests++;if(FS.syncFSRequests>1){err(`warning: ${FS.syncFSRequests} FS.syncfs operations in flight at once, probably just doing extra work`)}var mounts=FS.getMounts(FS.root.mount);var completed=0;function doCallback(errCode){FS.syncFSRequests--;return callback(errCode)}function done(errCode){if(errCode){if(!done.errored){done.errored=true;return doCallback(errCode)}return}if(++completed>=mounts.length){doCallback(null)}}for(var mount of mounts){if(mount.type.syncfs){mount.type.syncfs(mount,populate,done)}else{done(null)}}},mount(type,opts,mountpoint){var root=mountpoint==="/";var pseudo=!mountpoint;var node;if(root&&FS.root){throw new FS.ErrnoError(10)}else if(!root&&!pseudo){var lookup=FS.lookupPath(mountpoint,{follow_mount:false});mountpoint=lookup.path;node=lookup.node;if(FS.isMountpoint(node)){throw new FS.ErrnoError(10)}if(!FS.isDir(node.mode)){throw new FS.ErrnoError(54)}}var mount={type,opts,mountpoint,mounts:[]};var mountRoot=type.mount(mount);mountRoot.mount=mount;mount.root=mountRoot;if(root){FS.root=mountRoot}else if(node){node.mounted=mount;if(node.mount){node.mount.mounts.push(mount)}}return mountRoot},unmount(mountpoint){var lookup=FS.lookupPath(mountpoint,{follow_mount:false});if(!FS.isMountpoint(lookup.node)){throw new FS.ErrnoError(28)}var node=lookup.node;var mount=node.mounted;var mounts=FS.getMounts(mount);for(var[hash,current]of Object.entries(FS.nameTable)){while(current){var next=current.name_next;if(mounts.includes(current.mount)){FS.destroyNode(current)}current=next}}node.mounted=null;var idx=node.mount.mounts.indexOf(mount);node.mount.mounts.splice(idx,1)},lookup(parent,name){return parent.node_ops.lookup(parent,name)},mknod(path,mode,dev){var lookup=FS.lookupPath(path,{parent:true});var parent=lookup.node;var name=PATH.basename(path);if(!name){throw new FS.ErrnoError(28)}if(name==="."||name===".."){throw new FS.ErrnoError(20)}var errCode=FS.mayCreate(parent,name);if(errCode){throw new FS.ErrnoError(errCode)}if(!parent.node_ops.mknod){throw new FS.ErrnoError(63)}return parent.node_ops.mknod(parent,name,mode,dev)},statfs(path){return FS.statfsNode(FS.lookupPath(path,{follow:true}).node)},statfsStream(stream){return FS.statfsNode(stream.node)},statfsNode(node){var rtn={bsize:4096,frsize:4096,blocks:1e6,bfree:5e5,bavail:5e5,files:FS.nextInode,ffree:FS.nextInode-1,fsid:42,flags:2,namelen:255};if(node.node_ops.statfs){Object.assign(rtn,node.node_ops.statfs(node.mount.opts.root))}return rtn},create(path,mode=438){mode&=4095;mode|=32768;return FS.mknod(path,mode,0)},mkdir(path,mode=511){mode&=511|512;mode|=16384;return FS.mknod(path,mode,0)},mkdirTree(path,mode){var dirs=path.split("/");var d="";for(var dir of dirs){if(!dir)continue;if(d||PATH.isAbs(path))d+="/";d+=dir;try{FS.mkdir(d,mode)}catch(e){if(e.errno!=20)throw e}}},mkdev(path,mode,dev){if(typeof dev=="undefined"){dev=mode;mode=438}mode|=8192;return FS.mknod(path,mode,dev)},symlink(oldpath,newpath){if(!PATH_FS.resolve(oldpath)){throw new FS.ErrnoError(44)}var lookup=FS.lookupPath(newpath,{parent:true});var parent=lookup.node;if(!parent){throw new FS.ErrnoError(44)}var newname=PATH.basename(newpath);var errCode=FS.mayCreate(parent,newname);if(errCode){throw new FS.ErrnoError(errCode)}if(!parent.node_ops.symlink){throw new FS.ErrnoError(63)}return parent.node_ops.symlink(parent,newname,oldpath)},rename(old_path,new_path){var old_dirname=PATH.dirname(old_path);var new_dirname=PATH.dirname(new_path);var old_name=PATH.basename(old_path);var new_name=PATH.basename(new_path);var lookup,old_dir,new_dir;lookup=FS.lookupPath(old_path,{parent:true});old_dir=lookup.node;lookup=FS.lookupPath(new_path,{parent:true});new_dir=lookup.node;if(!old_dir||!new_dir)throw new FS.ErrnoError(44);if(old_dir.mount!==new_dir.mount){throw new FS.ErrnoError(75)}var old_node=FS.lookupNode(old_dir,old_name);var relative=PATH_FS.relative(old_path,new_dirname);if(relative.charAt(0)!=="."){throw new FS.ErrnoError(28)}relative=PATH_FS.relative(new_path,old_dirname);if(relative.charAt(0)!=="."){throw new FS.ErrnoError(55)}var new_node;try{new_node=FS.lookupNode(new_dir,new_name)}catch(e){}if(old_node===new_node){return}var isdir=FS.isDir(old_node.mode);var errCode=FS.mayDelete(old_dir,old_name,isdir);if(errCode){throw new FS.ErrnoError(errCode)}errCode=new_node?FS.mayDelete(new_dir,new_name,isdir):FS.mayCreate(new_dir,new_name);if(errCode){throw new FS.ErrnoError(errCode)}if(!old_dir.node_ops.rename){throw new FS.ErrnoError(63)}if(FS.isMountpoint(old_node)||new_node&&FS.isMountpoint(new_node)){throw new FS.ErrnoError(10)}if(new_dir!==old_dir){errCode=FS.nodePermissions(old_dir,"w");if(errCode){throw new FS.ErrnoError(errCode)}}FS.hashRemoveNode(old_node);try{old_dir.node_ops.rename(old_node,new_dir,new_name);old_node.parent=new_dir}catch(e){throw e}finally{FS.hashAddNode(old_node)}},rmdir(path){var lookup=FS.lookupPath(path,{parent:true});var parent=lookup.node;var name=PATH.basename(path);var node=FS.lookupNode(parent,name);var errCode=FS.mayDelete(parent,name,true);if(errCode){throw new FS.ErrnoError(errCode)}if(!parent.node_ops.rmdir){throw new FS.ErrnoError(63)}if(FS.isMountpoint(node)){throw new FS.ErrnoError(10)}parent.node_ops.rmdir(parent,name);FS.destroyNode(node)},readdir(path){var lookup=FS.lookupPath(path,{follow:true});var node=lookup.node;var readdir=FS.checkOpExists(node.node_ops.readdir,54);return readdir(node)},unlink(path){var lookup=FS.lookupPath(path,{parent:true});var parent=lookup.node;if(!parent){throw new FS.ErrnoError(44)}var name=PATH.basename(path);var node=FS.lookupNode(parent,name);var errCode=FS.mayDelete(parent,name,false);if(errCode){throw new FS.ErrnoError(errCode)}if(!parent.node_ops.unlink){throw new FS.ErrnoError(63)}if(FS.isMountpoint(node)){throw new FS.ErrnoError(10)}parent.node_ops.unlink(parent,name);FS.destroyNode(node)},readlink(path){var lookup=FS.lookupPath(path);var link=lookup.node;if(!link){throw new FS.ErrnoError(44)}if(!link.node_ops.readlink){throw new FS.ErrnoError(28)}return link.node_ops.readlink(link)},stat(path,dontFollow){var lookup=FS.lookupPath(path,{follow:!dontFollow});var node=lookup.node;var getattr=FS.checkOpExists(node.node_ops.getattr,63);return getattr(node)},fstat(fd){var stream=FS.getStreamChecked(fd);var node=stream.node;var getattr=stream.stream_ops.getattr;var arg=getattr?stream:node;getattr??=node.node_ops.getattr;FS.checkOpExists(getattr,63);return getattr(arg)},lstat(path){return FS.stat(path,true)},doChmod(stream,node,mode,dontFollow){FS.doSetAttr(stream,node,{mode:mode&4095|node.mode&~4095,ctime:Date.now(),dontFollow})},chmod(path,mode,dontFollow){var node;if(typeof path=="string"){var lookup=FS.lookupPath(path,{follow:!dontFollow});node=lookup.node}else{node=path}FS.doChmod(null,node,mode,dontFollow)},lchmod(path,mode){FS.chmod(path,mode,true)},fchmod(fd,mode){var stream=FS.getStreamChecked(fd);FS.doChmod(stream,stream.node,mode,false)},doChown(stream,node,dontFollow){FS.doSetAttr(stream,node,{timestamp:Date.now(),dontFollow})},chown(path,uid,gid,dontFollow){var node;if(typeof path=="string"){var lookup=FS.lookupPath(path,{follow:!dontFollow});node=lookup.node}else{node=path}FS.doChown(null,node,dontFollow)},lchown(path,uid,gid){FS.chown(path,uid,gid,true)},fchown(fd,uid,gid){var stream=FS.getStreamChecked(fd);FS.doChown(stream,stream.node,false)},doTruncate(stream,node,len){if(FS.isDir(node.mode)){throw new FS.ErrnoError(31)}if(!FS.isFile(node.mode)){throw new FS.ErrnoError(28)}var errCode=FS.nodePermissions(node,"w");if(errCode){throw new FS.ErrnoError(errCode)}FS.doSetAttr(stream,node,{size:len,timestamp:Date.now()})},truncate(path,len){if(len<0){throw new FS.ErrnoError(28)}var node;if(typeof path=="string"){var lookup=FS.lookupPath(path,{follow:true});node=lookup.node}else{node=path}FS.doTruncate(null,node,len)},ftruncate(fd,len){var stream=FS.getStreamChecked(fd);if(len<0||(stream.flags&2097155)===0){throw new FS.ErrnoError(28)}FS.doTruncate(stream,stream.node,len)},utime(path,atime,mtime){var lookup=FS.lookupPath(path,{follow:true});var node=lookup.node;var setattr=FS.checkOpExists(node.node_ops.setattr,63);setattr(node,{atime,mtime})},open(path,flags,mode=438){if(path===""){throw new FS.ErrnoError(44)}flags=typeof flags=="string"?FS_modeStringToFlags(flags):flags;if(flags&64){mode=mode&4095|32768}else{mode=0}var node;var isDirPath;if(typeof path=="object"){node=path}else{isDirPath=path.endsWith("/");var lookup=FS.lookupPath(path,{follow:!(flags&131072),noent_okay:true});node=lookup.node;path=lookup.path}var created=false;if(flags&64){if(node){if(flags&128){throw new FS.ErrnoError(20)}}else if(isDirPath){throw new FS.ErrnoError(31)}else{node=FS.mknod(path,mode|511,0);created=true}}if(!node){throw new FS.ErrnoError(44)}if(FS.isChrdev(node.mode)){flags&=~512}if(flags&65536&&!FS.isDir(node.mode)){throw new FS.ErrnoError(54)}if(!created){var errCode=FS.mayOpen(node,flags);if(errCode){throw new FS.ErrnoError(errCode)}}if(flags&512&&!created){FS.truncate(node,0)}flags&=~(128|512|131072);var stream=FS.createStream({node,path:FS.getPath(node),flags,seekable:true,position:0,stream_ops:node.stream_ops,ungotten:[],error:false});if(stream.stream_ops.open){stream.stream_ops.open(stream)}if(created){FS.chmod(node,mode&511)}if(Module["logReadFiles"]&&!(flags&1)){if(!(path in FS.readFiles)){FS.readFiles[path]=1}}return stream},close(stream){if(FS.isClosed(stream)){throw new FS.ErrnoError(8)}if(stream.getdents)stream.getdents=null;try{if(stream.stream_ops.close){stream.stream_ops.close(stream)}}catch(e){throw e}finally{FS.closeStream(stream.fd)}stream.fd=null},isClosed(stream){return stream.fd===null},llseek(stream,offset,whence){if(FS.isClosed(stream)){throw new FS.ErrnoError(8)}if(!stream.seekable||!stream.stream_ops.llseek){throw new FS.ErrnoError(70)}if(whence!=0&&whence!=1&&whence!=2){throw new FS.ErrnoError(28)}stream.position=stream.stream_ops.llseek(stream,offset,whence);stream.ungotten=[];return stream.position},read(stream,buffer,offset,length,position){if(length<0||position<0){throw new FS.ErrnoError(28)}if(FS.isClosed(stream)){throw new FS.ErrnoError(8)}if((stream.flags&2097155)===1){throw new FS.ErrnoError(8)}if(FS.isDir(stream.node.mode)){throw new FS.ErrnoError(31)}if(!stream.stream_ops.read){throw new FS.ErrnoError(28)}var seeking=typeof position!="undefined";if(!seeking){position=stream.position}else if(!stream.seekable){throw new FS.ErrnoError(70)}var bytesRead=stream.stream_ops.read(stream,buffer,offset,length,position);if(!seeking)stream.position+=bytesRead;return bytesRead},write(stream,buffer,offset,length,position,canOwn){if(length<0||position<0){throw new FS.ErrnoError(28)}if(FS.isClosed(stream)){throw new FS.ErrnoError(8)}if((stream.flags&2097155)===0){throw new FS.ErrnoError(8)}if(FS.isDir(stream.node.mode)){throw new FS.ErrnoError(31)}if(!stream.stream_ops.write){throw new FS.ErrnoError(28)}if(stream.seekable&&stream.flags&1024){FS.llseek(stream,0,2)}var seeking=typeof position!="undefined";if(!seeking){position=stream.position}else if(!stream.seekable){throw new FS.ErrnoError(70)}var bytesWritten=stream.stream_ops.write(stream,buffer,offset,length,position,canOwn);if(!seeking)stream.position+=bytesWritten;return bytesWritten},mmap(stream,length,position,prot,flags){if((prot&2)!==0&&(flags&2)===0&&(stream.flags&2097155)!==2){throw new FS.ErrnoError(2)}if((stream.flags&2097155)===1){throw new FS.ErrnoError(2)}if(!stream.stream_ops.mmap){throw new FS.ErrnoError(43)}if(!length){throw new FS.ErrnoError(28)}return stream.stream_ops.mmap(stream,length,position,prot,flags)},msync(stream,buffer,offset,length,mmapFlags){if(!stream.stream_ops.msync){return 0}return stream.stream_ops.msync(stream,buffer,offset,length,mmapFlags)},ioctl(stream,cmd,arg){if(!stream.stream_ops.ioctl){throw new FS.ErrnoError(59)}return stream.stream_ops.ioctl(stream,cmd,arg)},readFile(path,opts={}){opts.flags=opts.flags||0;opts.encoding=opts.encoding||"binary";if(opts.encoding!=="utf8"&&opts.encoding!=="binary"){abort(`Invalid encoding type "${opts.encoding}"`)}var stream=FS.open(path,opts.flags);var stat=FS.stat(path);var length=stat.size;var buf=new Uint8Array(length);FS.read(stream,buf,0,length,0);if(opts.encoding==="utf8"){buf=UTF8ArrayToString(buf)}FS.close(stream);return buf},writeFile(path,data,opts={}){opts.flags=opts.flags||577;var stream=FS.open(path,opts.flags,opts.mode);if(typeof data=="string"){data=new Uint8Array(intArrayFromString(data,true))}if(ArrayBuffer.isView(data)){FS.write(stream,data,0,data.byteLength,undefined,opts.canOwn)}else{abort("Unsupported data type")}FS.close(stream)},cwd:()=>FS.currentPath,chdir(path){var lookup=FS.lookupPath(path,{follow:true});if(lookup.node===null){throw new FS.ErrnoError(44)}if(!FS.isDir(lookup.node.mode)){throw new FS.ErrnoError(54)}var errCode=FS.nodePermissions(lookup.node,"x");if(errCode){throw new FS.ErrnoError(errCode)}FS.currentPath=lookup.path},createDefaultDirectories(){FS.mkdir("/tmp");FS.mkdir("/home");FS.mkdir("/home/web_user")},createDefaultDevices(){FS.mkdir("/dev");FS.registerDevice(FS.makedev(1,3),{read:()=>0,write:(stream,buffer,offset,length,pos)=>length,llseek:()=>0});FS.mkdev("/dev/null",FS.makedev(1,3));TTY.register(FS.makedev(5,0),TTY.default_tty_ops);TTY.register(FS.makedev(6,0),TTY.default_tty1_ops);FS.mkdev("/dev/tty",FS.makedev(5,0));FS.mkdev("/dev/tty1",FS.makedev(6,0));var randomBuffer=new Uint8Array(1024),randomLeft=0;var randomByte=()=>{if(randomLeft===0){randomFill(randomBuffer);randomLeft=randomBuffer.byteLength}return randomBuffer[--randomLeft]};FS.createDevice("/dev","random",randomByte);FS.createDevice("/dev","urandom",randomByte);FS.mkdir("/dev/shm");FS.mkdir("/dev/shm/tmp")},createSpecialDirectories(){FS.mkdir("/proc");var proc_self=FS.mkdir("/proc/self");FS.mkdir("/proc/self/fd");FS.mount({mount(){var node=FS.createNode(proc_self,"fd",16895,73);node.stream_ops={llseek:MEMFS.stream_ops.llseek};node.node_ops={lookup(parent,name){var fd=+name;var stream=FS.getStreamChecked(fd);var ret={parent:null,mount:{mountpoint:"fake"},node_ops:{readlink:()=>stream.path},id:fd+1};ret.parent=ret;return ret},readdir(){return Array.from(FS.streams.entries()).filter(([k,v])=>v).map(([k,v])=>k.toString())}};return node}},{},"/proc/self/fd")},createStandardStreams(input,output,error){if(input){FS.createDevice("/dev","stdin",input)}else{FS.symlink("/dev/tty","/dev/stdin")}if(output){FS.createDevice("/dev","stdout",null,output)}else{FS.symlink("/dev/tty","/dev/stdout")}if(error){FS.createDevice("/dev","stderr",null,error)}else{FS.symlink("/dev/tty1","/dev/stderr")}var stdin=FS.open("/dev/stdin",0);var stdout=FS.open("/dev/stdout",1);var stderr=FS.open("/dev/stderr",1)},staticInit(){FS.nameTable=new Array(4096);FS.mount(MEMFS,{},"/");FS.createDefaultDirectories();FS.createDefaultDevices();FS.createSpecialDirectories();FS.filesystems={MEMFS}},init(input,output,error){FS.initialized=true;input??=Module["stdin"];output??=Module["stdout"];error??=Module["stderr"];FS.createStandardStreams(input,output,error)},quit(){FS.initialized=false;for(var stream of FS.streams){if(stream){FS.close(stream)}}},findObject(path,dontResolveLastLink){var ret=FS.analyzePath(path,dontResolveLastLink);if(!ret.exists){return null}return ret.object},analyzePath(path,dontResolveLastLink){try{var lookup=FS.lookupPath(path,{follow:!dontResolveLastLink});path=lookup.path}catch(e){}var ret={isRoot:false,exists:false,error:0,name:null,path:null,object:null,parentExists:false,parentPath:null,parentObject:null};try{var lookup=FS.lookupPath(path,{parent:true});ret.parentExists=true;ret.parentPath=lookup.path;ret.parentObject=lookup.node;ret.name=PATH.basename(path);lookup=FS.lookupPath(path,{follow:!dontResolveLastLink});ret.exists=true;ret.path=lookup.path;ret.object=lookup.node;ret.name=lookup.node.name;ret.isRoot=lookup.path==="/"}catch(e){ret.error=e.errno}return ret},createPath(parent,path,canRead,canWrite){parent=typeof parent=="string"?parent:FS.getPath(parent);var parts=path.split("/").reverse();while(parts.length){var part=parts.pop();if(!part)continue;var current=PATH.join2(parent,part);try{FS.mkdir(current)}catch(e){if(e.errno!=20)throw e}parent=current}return current},createFile(parent,name,properties,canRead,canWrite){var path=PATH.join2(typeof parent=="string"?parent:FS.getPath(parent),name);var mode=FS_getMode(canRead,canWrite);return FS.create(path,mode)},createDataFile(parent,name,data,canRead,canWrite,canOwn){var path=name;if(parent){parent=typeof parent=="string"?parent:FS.getPath(parent);path=name?PATH.join2(parent,name):parent}var mode=FS_getMode(canRead,canWrite);var node=FS.create(path,mode);if(data){if(typeof data=="string"){var arr=new Array(data.length);for(var i=0,len=data.length;i<len;++i)arr[i]=data.charCodeAt(i);data=arr}FS.chmod(node,mode|146);var stream=FS.open(node,577);FS.write(stream,data,0,data.length,0,canOwn);FS.close(stream);FS.chmod(node,mode)}},createDevice(parent,name,input,output){var path=PATH.join2(typeof parent=="string"?parent:FS.getPath(parent),name);var mode=FS_getMode(!!input,!!output);FS.createDevice.major??=64;var dev=FS.makedev(FS.createDevice.major++,0);FS.registerDevice(dev,{open(stream){stream.seekable=false},close(stream){if(output?.buffer?.length){output(10)}},read(stream,buffer,offset,length,pos){var bytesRead=0;for(var i=0;i<length;i++){var result;try{result=input()}catch(e){throw new FS.ErrnoError(29)}if(result===undefined&&bytesRead===0){throw new FS.ErrnoError(6)}if(result===null||result===undefined)break;bytesRead++;buffer[offset+i]=result}if(bytesRead){stream.node.atime=Date.now()}return bytesRead},write(stream,buffer,offset,length,pos){for(var i=0;i<length;i++){try{output(buffer[offset+i])}catch(e){throw new FS.ErrnoError(29)}}if(length){stream.node.mtime=stream.node.ctime=Date.now()}return i}});return FS.mkdev(path,mode,dev)},forceLoadFile(obj){if(obj.isDevice||obj.isFolder||obj.link||obj.contents)return true;if(globalThis.XMLHttpRequest){abort("Lazy loading should have been performed (contents set) in createLazyFile, but it was not. Lazy loading only works in web workers. Use --embed-file or --preload-file in emcc on the main thread.")}else{try{obj.contents=readBinary(obj.url)}catch(e){throw new FS.ErrnoError(29)}}},createLazyFile(parent,name,url,canRead,canWrite){class LazyUint8Array{lengthKnown=false;chunks=[];get(idx){if(idx>this.length-1||idx<0){return undefined}var chunkOffset=idx%this.chunkSize;var chunkNum=idx/this.chunkSize|0;return this.getter(chunkNum)[chunkOffset]}setDataGetter(getter){this.getter=getter}cacheLength(){var xhr=new XMLHttpRequest;xhr.open("HEAD",url,false);xhr.send(null);if(!(xhr.status>=200&&xhr.status<300||xhr.status===304))abort("Couldn\'t load "+url+". Status: "+xhr.status);var datalength=Number(xhr.getResponseHeader("Content-length"));var header;var hasByteServing=(header=xhr.getResponseHeader("Accept-Ranges"))&&header==="bytes";var usesGzip=(header=xhr.getResponseHeader("Content-Encoding"))&&header==="gzip";var chunkSize=1024*1024;if(!hasByteServing)chunkSize=datalength;var doXHR=(from,to)=>{if(from>to)abort("invalid range ("+from+", "+to+") or no bytes requested!");if(to>datalength-1)abort("only "+datalength+" bytes available! programmer error!");var xhr=new XMLHttpRequest;xhr.open("GET",url,false);if(datalength!==chunkSize)xhr.setRequestHeader("Range","bytes="+from+"-"+to);xhr.responseType="arraybuffer";if(xhr.overrideMimeType){xhr.overrideMimeType("text/plain; charset=x-user-defined")}xhr.send(null);if(!(xhr.status>=200&&xhr.status<300||xhr.status===304))abort("Couldn\'t load "+url+". Status: "+xhr.status);if(xhr.response!==undefined){return new Uint8Array(xhr.response||[])}return intArrayFromString(xhr.responseText||"",true)};var lazyArray=this;lazyArray.setDataGetter(chunkNum=>{var start=chunkNum*chunkSize;var end=(chunkNum+1)*chunkSize-1;end=Math.min(end,datalength-1);if(typeof lazyArray.chunks[chunkNum]=="undefined"){lazyArray.chunks[chunkNum]=doXHR(start,end)}if(typeof lazyArray.chunks[chunkNum]=="undefined")abort("doXHR failed!");return lazyArray.chunks[chunkNum]});if(usesGzip||!datalength){chunkSize=datalength=1;datalength=this.getter(0).length;chunkSize=datalength;out("LazyFiles on gzip forces download of the whole file when length is accessed")}this._length=datalength;this._chunkSize=chunkSize;this.lengthKnown=true}get length(){if(!this.lengthKnown){this.cacheLength()}return this._length}get chunkSize(){if(!this.lengthKnown){this.cacheLength()}return this._chunkSize}}if(globalThis.XMLHttpRequest){if(!ENVIRONMENT_IS_WORKER)abort("Cannot do synchronous binary XHRs outside webworkers in modern browsers. Use --embed-file or --preload-file in emcc");var lazyArray=new LazyUint8Array;var properties={isDevice:false,contents:lazyArray}}else{var properties={isDevice:false,url}}var node=FS.createFile(parent,name,properties,canRead,canWrite);if(properties.contents){node.contents=properties.contents}else if(properties.url){node.contents=null;node.url=properties.url}Object.defineProperties(node,{usedBytes:{get:function(){return this.contents.length}}});var stream_ops={};for(const[key,fn]of Object.entries(node.stream_ops)){stream_ops[key]=(...args)=>{FS.forceLoadFile(node);return fn(...args)}}function writeChunks(stream,buffer,offset,length,position){var contents=stream.node.contents;if(position>=contents.length)return 0;var size=Math.min(contents.length-position,length);if(contents.slice){for(var i=0;i<size;i++){buffer[offset+i]=contents[position+i]}}else{for(var i=0;i<size;i++){buffer[offset+i]=contents.get(position+i)}}return size}stream_ops.read=(stream,buffer,offset,length,position)=>{FS.forceLoadFile(node);return writeChunks(stream,buffer,offset,length,position)};stream_ops.mmap=(stream,length,position,prot,flags)=>{FS.forceLoadFile(node);var ptr=mmapAlloc(length);if(!ptr){throw new FS.ErrnoError(48)}writeChunks(stream,(growMemViews(),HEAP8),ptr,length,position);return{ptr,allocated:true}};node.stream_ops=stream_ops;return node}};var UTF8ToString=(ptr,maxBytesToRead,ignoreNul)=>ptr?UTF8ArrayToString((growMemViews(),HEAPU8),ptr,maxBytesToRead,ignoreNul):"";var SYSCALLS={DEFAULT_POLLMASK:5,calculateAt(dirfd,path,allowEmpty){if(PATH.isAbs(path)){return path}var dir;if(dirfd===-100){dir=FS.cwd()}else{var dirstream=SYSCALLS.getStreamFromFD(dirfd);dir=dirstream.path}if(path.length==0){if(!allowEmpty){throw new FS.ErrnoError(44)}return dir}return dir+"/"+path},writeStat(buf,stat){(growMemViews(),HEAPU32)[buf/4]=stat.dev;(growMemViews(),HEAPU32)[(buf+4)/4]=stat.mode;(growMemViews(),HEAPU64)[(buf+8)/8]=BigInt(stat.nlink);(growMemViews(),HEAPU32)[(buf+16)/4]=stat.uid;(growMemViews(),HEAPU32)[(buf+20)/4]=stat.gid;(growMemViews(),HEAPU32)[(buf+24)/4]=stat.rdev;(growMemViews(),HEAP64)[(buf+32)/8]=BigInt(stat.size);(growMemViews(),HEAP32)[(buf+40)/4]=4096;(growMemViews(),HEAP32)[(buf+44)/4]=stat.blocks;var atime=stat.atime.getTime();var mtime=stat.mtime.getTime();var ctime=stat.ctime.getTime();(growMemViews(),HEAP64)[(buf+48)/8]=BigInt(Math.floor(atime/1e3));(growMemViews(),HEAPU64)[(buf+56)/8]=BigInt(atime%1e3*1e3*1e3);(growMemViews(),HEAP64)[(buf+64)/8]=BigInt(Math.floor(mtime/1e3));(growMemViews(),HEAPU64)[(buf+72)/8]=BigInt(mtime%1e3*1e3*1e3);(growMemViews(),HEAP64)[(buf+80)/8]=BigInt(Math.floor(ctime/1e3));(growMemViews(),HEAPU64)[(buf+88)/8]=BigInt(ctime%1e3*1e3*1e3);(growMemViews(),HEAP64)[(buf+96)/8]=BigInt(stat.ino);return 0},writeStatFs(buf,stats){(growMemViews(),HEAPU32)[(buf+8)/4]=stats.bsize;(growMemViews(),HEAPU32)[(buf+72)/4]=stats.bsize;(growMemViews(),HEAP64)[(buf+16)/8]=BigInt(stats.blocks);(growMemViews(),HEAP64)[(buf+24)/8]=BigInt(stats.bfree);(growMemViews(),HEAP64)[(buf+32)/8]=BigInt(stats.bavail);(growMemViews(),HEAP64)[(buf+40)/8]=BigInt(stats.files);(growMemViews(),HEAP64)[(buf+48)/8]=BigInt(stats.ffree);(growMemViews(),HEAPU32)[(buf+56)/4]=stats.fsid;(growMemViews(),HEAPU32)[(buf+80)/4]=stats.flags;(growMemViews(),HEAPU32)[(buf+64)/4]=stats.namelen},doMsync(addr,stream,len,flags,offset){if(!FS.isFile(stream.node.mode)){throw new FS.ErrnoError(43)}if(flags&2){return 0}var buffer=(growMemViews(),HEAPU8).slice(addr,addr+len);FS.msync(stream,buffer,offset,len,flags)},getStreamFromFD(fd){var stream=FS.getStreamChecked(fd);return stream},varargs:undefined,getStr(ptr){var ret=UTF8ToString(ptr);return ret}};function ___syscall_fcntl64(fd,cmd,varargs){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(3,0,1,fd,cmd,varargs);varargs=bigintToI53Checked(varargs);SYSCALLS.varargs=varargs;try{var stream=SYSCALLS.getStreamFromFD(fd);switch(cmd){case 0:{var arg=syscallGetVarargI();if(arg<0){return-28}while(FS.streams[arg]){arg++}var newStream;newStream=FS.dupStream(stream,arg);return newStream.fd}case 1:case 2:return 0;case 3:return stream.flags;case 4:{var arg=syscallGetVarargI();stream.flags|=arg;return 0}case 5:{var arg=syscallGetVarargP();var offset=0;(growMemViews(),HEAP16)[(arg+offset)/2]=2;return 0}case 6:case 7:return 0}return-28}catch(e){if(typeof FS=="undefined"||!(e.name==="ErrnoError"))throw e;return-e.errno}}function ___syscall_fstat64(fd,buf){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(4,0,1,fd,buf);buf=bigintToI53Checked(buf);try{return SYSCALLS.writeStat(buf,FS.fstat(fd))}catch(e){if(typeof FS=="undefined"||!(e.name==="ErrnoError"))throw e;return-e.errno}}var stringToUTF8=(str,outPtr,maxBytesToWrite)=>stringToUTF8Array(str,(growMemViews(),HEAPU8),outPtr,maxBytesToWrite);function ___syscall_getcwd(buf,size){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(5,0,1,buf,size);buf=bigintToI53Checked(buf);size=bigintToI53Checked(size);try{if(size===0)return-28;var cwd=FS.cwd();var cwdLengthInBytes=lengthBytesUTF8(cwd)+1;if(size<cwdLengthInBytes)return-68;stringToUTF8(cwd,buf,size);return cwdLengthInBytes}catch(e){if(typeof FS=="undefined"||!(e.name==="ErrnoError"))throw e;return-e.errno}}function ___syscall_getdents64(fd,dirp,count){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(6,0,1,fd,dirp,count);dirp=bigintToI53Checked(dirp);count=bigintToI53Checked(count);try{var stream=SYSCALLS.getStreamFromFD(fd);stream.getdents||=FS.readdir(stream.path);var struct_size=280;var pos=0;var off=FS.llseek(stream,0,1);var startIdx=Math.floor(off/struct_size);var endIdx=Math.min(stream.getdents.length,startIdx+Math.floor(count/struct_size));for(var idx=startIdx;idx<endIdx;idx++){var id;var type;var name=stream.getdents[idx];if(name==="."){id=stream.node.id;type=4}else if(name===".."){var lookup=FS.lookupPath(stream.path,{parent:true});id=lookup.node.id;type=4}else{var child;try{child=FS.lookupNode(stream.node,name)}catch(e){if(e?.errno===28){continue}throw e}id=child.id;type=FS.isChrdev(child.mode)?2:FS.isDir(child.mode)?4:FS.isLink(child.mode)?10:8}(growMemViews(),HEAP64)[(dirp+pos)/8]=BigInt(id);(growMemViews(),HEAP64)[(dirp+pos+8)/8]=BigInt((idx+1)*struct_size);(growMemViews(),HEAP16)[(dirp+pos+16)/2]=280;(growMemViews(),HEAP8)[dirp+pos+18]=type;stringToUTF8(name,dirp+pos+19,256);pos+=struct_size}FS.llseek(stream,idx*struct_size,0);return pos}catch(e){if(typeof FS=="undefined"||!(e.name==="ErrnoError"))throw e;return-e.errno}}function ___syscall_ioctl(fd,op,varargs){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(7,0,1,fd,op,varargs);varargs=bigintToI53Checked(varargs);SYSCALLS.varargs=varargs;try{var stream=SYSCALLS.getStreamFromFD(fd);switch(op){case 21509:{if(!stream.tty)return-59;return 0}case 21505:{if(!stream.tty)return-59;if(stream.tty.ops.ioctl_tcgets){var termios=stream.tty.ops.ioctl_tcgets(stream);var argp=syscallGetVarargP();(growMemViews(),HEAP32)[argp/4]=termios.c_iflag||0;(growMemViews(),HEAP32)[(argp+4)/4]=termios.c_oflag||0;(growMemViews(),HEAP32)[(argp+8)/4]=termios.c_cflag||0;(growMemViews(),HEAP32)[(argp+12)/4]=termios.c_lflag||0;for(var i=0;i<32;i++){(growMemViews(),HEAP8)[argp+i+17]=termios.c_cc[i]||0}return 0}return 0}case 21510:case 21511:case 21512:{if(!stream.tty)return-59;return 0}case 21506:case 21507:case 21508:{if(!stream.tty)return-59;if(stream.tty.ops.ioctl_tcsets){var argp=syscallGetVarargP();var c_iflag=(growMemViews(),HEAP32)[argp/4];var c_oflag=(growMemViews(),HEAP32)[(argp+4)/4];var c_cflag=(growMemViews(),HEAP32)[(argp+8)/4];var c_lflag=(growMemViews(),HEAP32)[(argp+12)/4];var c_cc=[];for(var i=0;i<32;i++){c_cc.push((growMemViews(),HEAP8)[argp+i+17])}return stream.tty.ops.ioctl_tcsets(stream.tty,op,{c_iflag,c_oflag,c_cflag,c_lflag,c_cc})}return 0}case 21519:{if(!stream.tty)return-59;var argp=syscallGetVarargP();(growMemViews(),HEAP32)[argp/4]=0;return 0}case 21520:{if(!stream.tty)return-59;return-28}case 21537:case 21531:{var argp=syscallGetVarargP();return FS.ioctl(stream,op,argp)}case 21523:{if(!stream.tty)return-59;if(stream.tty.ops.ioctl_tiocgwinsz){var winsize=stream.tty.ops.ioctl_tiocgwinsz(stream.tty);var argp=syscallGetVarargP();(growMemViews(),HEAP16)[argp/2]=winsize[0];(growMemViews(),HEAP16)[(argp+2)/2]=winsize[1]}return 0}case 21524:{if(!stream.tty)return-59;return 0}case 21515:{if(!stream.tty)return-59;return 0}default:return-28}}catch(e){if(typeof FS=="undefined"||!(e.name==="ErrnoError"))throw e;return-e.errno}}function ___syscall_lstat64(path,buf){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(8,0,1,path,buf);path=bigintToI53Checked(path);buf=bigintToI53Checked(buf);try{path=SYSCALLS.getStr(path);return SYSCALLS.writeStat(buf,FS.lstat(path))}catch(e){if(typeof FS=="undefined"||!(e.name==="ErrnoError"))throw e;return-e.errno}}function ___syscall_newfstatat(dirfd,path,buf,flags){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(9,0,1,dirfd,path,buf,flags);path=bigintToI53Checked(path);buf=bigintToI53Checked(buf);try{path=SYSCALLS.getStr(path);var nofollow=flags&256;var allowEmpty=flags&4096;flags=flags&~6400;path=SYSCALLS.calculateAt(dirfd,path,allowEmpty);return SYSCALLS.writeStat(buf,nofollow?FS.lstat(path):FS.stat(path))}catch(e){if(typeof FS=="undefined"||!(e.name==="ErrnoError"))throw e;return-e.errno}}function ___syscall_openat(dirfd,path,flags,varargs){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(10,0,1,dirfd,path,flags,varargs);path=bigintToI53Checked(path);varargs=bigintToI53Checked(varargs);SYSCALLS.varargs=varargs;try{path=SYSCALLS.getStr(path);path=SYSCALLS.calculateAt(dirfd,path);var mode=varargs?syscallGetVarargI():0;return FS.open(path,flags,mode).fd}catch(e){if(typeof FS=="undefined"||!(e.name==="ErrnoError"))throw e;return-e.errno}}function ___syscall_stat64(path,buf){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(11,0,1,path,buf);path=bigintToI53Checked(path);buf=bigintToI53Checked(buf);try{path=SYSCALLS.getStr(path);return SYSCALLS.writeStat(buf,FS.stat(path))}catch(e){if(typeof FS=="undefined"||!(e.name==="ErrnoError"))throw e;return-e.errno}}var __abort_js=()=>abort("");function __emscripten_init_main_thread_js(tb){tb=bigintToI53Checked(tb);__emscripten_thread_init(tb,!ENVIRONMENT_IS_WORKER,1,!ENVIRONMENT_IS_WEB,5242880,false);PThread.threadInitTLS()}var handleException=e=>{if(e instanceof ExitStatus||e=="unwind"){return EXITSTATUS}quit_(1,e)};var maybeExit=()=>{if(!keepRuntimeAlive()){try{if(ENVIRONMENT_IS_PTHREAD){if(_pthread_self())__emscripten_thread_exit(EXITSTATUS);return}_exit(EXITSTATUS)}catch(e){handleException(e)}}};var callUserCallback=func=>{if(ABORT){return}try{func();maybeExit()}catch(e){handleException(e)}};function __emscripten_thread_mailbox_await(pthread_ptr){pthread_ptr=bigintToI53Checked(pthread_ptr);if(Atomics.waitAsync){var wait=Atomics.waitAsync((growMemViews(),HEAP32),pthread_ptr/4,pthread_ptr);wait.value.then(checkMailbox);var waitingAsync=pthread_ptr+228;Atomics.store((growMemViews(),HEAP32),waitingAsync/4,1)}}var checkMailbox=()=>callUserCallback(()=>{var pthread_ptr=_pthread_self();if(pthread_ptr){__emscripten_thread_mailbox_await(pthread_ptr);__emscripten_check_mailbox()}});function __emscripten_notify_mailbox_postmessage(targetThread,currThreadId){targetThread=bigintToI53Checked(targetThread);currThreadId=bigintToI53Checked(currThreadId);if(targetThread==currThreadId){setTimeout(checkMailbox)}else if(ENVIRONMENT_IS_PTHREAD){postMessage({targetThread,cmd:"checkMailbox"})}else{var worker=PThread.pthreads[targetThread];if(!worker){return}worker.postMessage({cmd:"checkMailbox"})}}var proxiedJSCallArgs=[];function __emscripten_receive_on_main_thread_js(funcIndex,emAsmAddr,callingThread,numCallArgs,args){emAsmAddr=bigintToI53Checked(emAsmAddr);callingThread=bigintToI53Checked(callingThread);args=bigintToI53Checked(args);numCallArgs/=2;proxiedJSCallArgs.length=numCallArgs;var b=args/8;for(var i=0;i<numCallArgs;i++){if((growMemViews(),HEAP64)[b+2*i]){proxiedJSCallArgs[i]=(growMemViews(),HEAP64)[b+2*i+1]}else{proxiedJSCallArgs[i]=(growMemViews(),HEAPF64)[b+2*i+1]}}var func=proxiedFunctionTable[funcIndex];PThread.currentProxiedOperationCallerThread=callingThread;var rtn=func(...proxiedJSCallArgs);PThread.currentProxiedOperationCallerThread=0;if(typeof rtn=="bigint"){rtn=bigintToI53Checked(rtn)}return rtn}function __emscripten_thread_cleanup(thread){thread=bigintToI53Checked(thread);if(!ENVIRONMENT_IS_PTHREAD)cleanupThread(thread);else postMessage({cmd:"cleanupThread",thread})}function __emscripten_thread_set_strongref(thread){thread=bigintToI53Checked(thread);if(ENVIRONMENT_IS_NODE){PThread.pthreads[thread].ref()}}var isLeapYear=year=>year%4===0&&(year%100!==0||year%400===0);var MONTH_DAYS_LEAP_CUMULATIVE=[0,31,60,91,121,152,182,213,244,274,305,335];var MONTH_DAYS_REGULAR_CUMULATIVE=[0,31,59,90,120,151,181,212,243,273,304,334];var ydayFromDate=date=>{var leap=isLeapYear(date.getFullYear());var monthDaysCumulative=leap?MONTH_DAYS_LEAP_CUMULATIVE:MONTH_DAYS_REGULAR_CUMULATIVE;var yday=monthDaysCumulative[date.getMonth()]+date.getDate()-1;return yday};function __localtime_js(time,tmPtr){time=bigintToI53Checked(time);tmPtr=bigintToI53Checked(tmPtr);var date=new Date(time*1e3);(growMemViews(),HEAP32)[tmPtr/4]=date.getSeconds();(growMemViews(),HEAP32)[(tmPtr+4)/4]=date.getMinutes();(growMemViews(),HEAP32)[(tmPtr+8)/4]=date.getHours();(growMemViews(),HEAP32)[(tmPtr+12)/4]=date.getDate();(growMemViews(),HEAP32)[(tmPtr+16)/4]=date.getMonth();(growMemViews(),HEAP32)[(tmPtr+20)/4]=date.getFullYear()-1900;(growMemViews(),HEAP32)[(tmPtr+24)/4]=date.getDay();var yday=ydayFromDate(date)|0;(growMemViews(),HEAP32)[(tmPtr+28)/4]=yday;(growMemViews(),HEAP64)[(tmPtr+40)/8]=BigInt(-(date.getTimezoneOffset()*60));var start=new Date(date.getFullYear(),0,1);var summerOffset=new Date(date.getFullYear(),6,1).getTimezoneOffset();var winterOffset=start.getTimezoneOffset();var dst=(summerOffset!=winterOffset&&date.getTimezoneOffset()==Math.min(winterOffset,summerOffset))|0;(growMemViews(),HEAP32)[(tmPtr+32)/4]=dst}function __mmap_js(len,prot,flags,fd,offset,allocated,addr){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(12,0,1,len,prot,flags,fd,offset,allocated,addr);len=bigintToI53Checked(len);offset=bigintToI53Checked(offset);allocated=bigintToI53Checked(allocated);addr=bigintToI53Checked(addr);try{var stream=SYSCALLS.getStreamFromFD(fd);var res=FS.mmap(stream,len,offset,prot,flags);var ptr=res.ptr;(growMemViews(),HEAP32)[allocated/4]=res.allocated;(growMemViews(),HEAPU64)[addr/8]=BigInt(ptr);return 0}catch(e){if(typeof FS=="undefined"||!(e.name==="ErrnoError"))throw e;return-e.errno}}function __munmap_js(addr,len,prot,flags,fd,offset){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(13,0,1,addr,len,prot,flags,fd,offset);addr=bigintToI53Checked(addr);len=bigintToI53Checked(len);offset=bigintToI53Checked(offset);try{var stream=SYSCALLS.getStreamFromFD(fd);if(prot&2){SYSCALLS.doMsync(addr,stream,len,flags,offset)}}catch(e){if(typeof FS=="undefined"||!(e.name==="ErrnoError"))throw e;return-e.errno}}var __tzset_js=function(timezone,daylight,std_name,dst_name){timezone=bigintToI53Checked(timezone);daylight=bigintToI53Checked(daylight);std_name=bigintToI53Checked(std_name);dst_name=bigintToI53Checked(dst_name);var currentYear=(new Date).getFullYear();var winter=new Date(currentYear,0,1);var summer=new Date(currentYear,6,1);var winterOffset=winter.getTimezoneOffset();var summerOffset=summer.getTimezoneOffset();var stdTimezoneOffset=Math.max(winterOffset,summerOffset);(growMemViews(),HEAPU64)[timezone/8]=BigInt(stdTimezoneOffset*60);(growMemViews(),HEAP32)[daylight/4]=Number(winterOffset!=summerOffset);var extractZone=timezoneOffset=>{var sign=timezoneOffset>=0?"-":"+";var absOffset=Math.abs(timezoneOffset);var hours=String(Math.floor(absOffset/60)).padStart(2,"0");var minutes=String(absOffset%60).padStart(2,"0");return`UTC${sign}${hours}${minutes}`};var winterName=extractZone(winterOffset);var summerName=extractZone(summerOffset);if(summerOffset<winterOffset){stringToUTF8(winterName,std_name,17);stringToUTF8(summerName,dst_name,17)}else{stringToUTF8(winterName,dst_name,17);stringToUTF8(summerName,std_name,17)}};var _emscripten_get_now=()=>performance.timeOrigin+performance.now();var _emscripten_date_now=()=>Date.now();var nowIsMonotonic=1;var checkWasiClock=clock_id=>clock_id>=0&&clock_id<=3;function _clock_time_get(clk_id,ignored_precision,ptime){ignored_precision=bigintToI53Checked(ignored_precision);ptime=bigintToI53Checked(ptime);if(!checkWasiClock(clk_id)){return 28}var now;if(clk_id===0){now=_emscripten_date_now()}else if(nowIsMonotonic){now=_emscripten_get_now()}else{return 52}var nsec=Math.round(now*1e3*1e3);(growMemViews(),HEAP64)[ptime/8]=BigInt(nsec);return 0}var _emscripten_check_blocking_allowed=()=>{};var runtimeKeepalivePush=()=>{runtimeKeepaliveCounter+=1};var _emscripten_exit_with_live_runtime=()=>{runtimeKeepalivePush();throw"unwind"};var jsStackTrace=()=>(new Error).stack.toString();var getCallstack=flags=>{var callstack=jsStackTrace();var lines=callstack.split("\\n");callstack="";var firefoxRe=new RegExp("\\\\s*(.*?)@(.*?):([0-9]+):([0-9]+)");var chromeRe=new RegExp("\\\\s*at (.*?) \\\\((.*):(.*):(.*)\\\\)");for(var line of lines){var symbolName="";var file="";var lineno=0;var column=0;var parts=chromeRe.exec(line);if(parts?.length==5){symbolName=parts[1];file=parts[2];lineno=parts[3];column=parts[4]}else{parts=firefoxRe.exec(line);if(parts?.length>=4){symbolName=parts[1];file=parts[2];lineno=parts[3];column=parts[4]|0}else{callstack+=line+"\\n";continue}}if(symbolName=="_emscripten_log"||symbolName=="_emscripten_get_callstack"){callstack="";continue}if(flags&24){if(flags&64){file=file.substring(file.replace(/\\\\/g,"/").lastIndexOf("/")+1)}callstack+=`    at ${symbolName} (${file}:${lineno}:${column})\\n`}}callstack=callstack.replace(/\\s+$/,"");return callstack};function _emscripten_get_callstack(flags,str,maxbytes){str=bigintToI53Checked(str);var callstack=getCallstack(flags);if(!str||maxbytes<=0){return lengthBytesUTF8(callstack)+1}var bytesWrittenExcludingNull=stringToUTF8(callstack,str,maxbytes);return bytesWrittenExcludingNull+1}var getHeapMax=()=>4294967296;var _emscripten_get_heap_max=()=>BigInt(getHeapMax());var _emscripten_has_asyncify=()=>2;var _emscripten_num_logical_cores=()=>ENVIRONMENT_IS_NODE?require("os").cpus().length:navigator["hardwareConcurrency"];var growMemory=size=>{var oldHeapSize=wasmMemory.buffer.byteLength;var pages=(size-oldHeapSize+65535)/65536|0;try{wasmMemory.grow(BigInt(pages));updateMemoryViews();return 1}catch(e){}};function _emscripten_resize_heap(requestedSize){requestedSize=bigintToI53Checked(requestedSize);var oldSize=(growMemViews(),HEAPU8).length;if(requestedSize<=oldSize){return false}var maxHeapSize=getHeapMax();if(requestedSize>maxHeapSize){return false}for(var cutDown=1;cutDown<=4;cutDown*=2){var overGrownHeapSize=oldSize*(1+.2/cutDown);overGrownHeapSize=Math.min(overGrownHeapSize,requestedSize+100663296);var newSize=Math.min(maxHeapSize,alignMemory(Math.max(requestedSize,overGrownHeapSize),65536));var replacement=growMemory(newSize);if(replacement){return true}}return false}var stringToUTF8OnStack=str=>{var size=lengthBytesUTF8(str)+1;var ret=stackAlloc(size);stringToUTF8(str,ret,size);return ret};var writeI53ToI64=(ptr,num)=>{(growMemViews(),HEAPU32)[ptr/4]=num;var lower=(growMemViews(),HEAPU32)[ptr/4];(growMemViews(),HEAPU32)[(ptr+4)/4]=(num-lower)/4294967296};var stringToNewUTF8=str=>{var size=lengthBytesUTF8(str)+1;var ret=_malloc(size);if(ret)stringToUTF8(str,ret,size);return ret};var readI53FromI64=ptr=>(growMemViews(),HEAPU32)[ptr/4]+(growMemViews(),HEAP32)[(ptr+4)/4]*4294967296;var WebGPU={Internals:{jsObjects:[],jsObjectInsert:(ptr,jsObject)=>{WebGPU.Internals.jsObjects[ptr]=jsObject},bufferOnUnmaps:[],futures:[],futureInsert:(futureId,promise)=>{WebGPU.Internals.futures[futureId]=new Promise(resolve=>promise.finally(()=>resolve(futureId)))}},getJsObject:ptr=>{if(!ptr)return undefined;return WebGPU.Internals.jsObjects[ptr]},importJsAdapter:(obj,parentPtr=0)=>{var ptr=_emwgpuCreateAdapter(parentPtr);WebGPU.Internals.jsObjects[ptr]=obj;return ptr},importJsBindGroup:(obj,parentPtr=0)=>{var ptr=_emwgpuCreateBindGroup(parentPtr);WebGPU.Internals.jsObjects[ptr]=obj;return ptr},importJsBindGroupLayout:(obj,parentPtr=0)=>{var ptr=_emwgpuCreateBindGroupLayout(parentPtr);WebGPU.Internals.jsObjects[ptr]=obj;return ptr},importJsBuffer:(buffer,parentPtr=0)=>{assert(buffer.mapState==="unmapped");var bufferPtr=_emwgpuCreateBuffer(parentPtr);WebGPU.Internals.jsObjectInsert(bufferPtr,buffer);return bufferPtr},importJsCommandBuffer:(obj,parentPtr=0)=>{var ptr=_emwgpuCreateCommandBuffer(parentPtr);WebGPU.Internals.jsObjects[ptr]=obj;return ptr},importJsCommandEncoder:(obj,parentPtr=0)=>{var ptr=_emwgpuCreateCommandEncoder(parentPtr);WebGPU.Internals.jsObjects[ptr]=obj;return ptr},importJsComputePassEncoder:(obj,parentPtr=0)=>{var ptr=_emwgpuCreateComputePassEncoder(parentPtr);WebGPU.Internals.jsObjects[ptr]=obj;return ptr},importJsComputePipeline:(obj,parentPtr=0)=>{var ptr=_emwgpuCreateComputePipeline(parentPtr);WebGPU.Internals.jsObjects[ptr]=obj;return ptr},importJsDevice:(device,parentPtr=0)=>{var queuePtr=_emwgpuCreateQueue(parentPtr);var devicePtr=_emwgpuCreateDevice(parentPtr,queuePtr);WebGPU.Internals.jsObjectInsert(queuePtr,device.queue);WebGPU.Internals.jsObjectInsert(devicePtr,device);return devicePtr},importJsExternalTexture:(obj,parentPtr=0)=>{var ptr=_emwgpuCreateExternalTexture(parentPtr);WebGPU.Internals.jsObjects[ptr]=obj;return ptr},importJsPipelineLayout:(obj,parentPtr=0)=>{var ptr=_emwgpuCreatePipelineLayout(parentPtr);WebGPU.Internals.jsObjects[ptr]=obj;return ptr},importJsQuerySet:(obj,parentPtr=0)=>{var ptr=_emwgpuCreateQuerySet(parentPtr);WebGPU.Internals.jsObjects[ptr]=obj;return ptr},importJsQueue:(obj,parentPtr=0)=>{var ptr=_emwgpuCreateQueue(parentPtr);WebGPU.Internals.jsObjects[ptr]=obj;return ptr},importJsRenderBundle:(obj,parentPtr=0)=>{var ptr=_emwgpuCreateRenderBundle(parentPtr);WebGPU.Internals.jsObjects[ptr]=obj;return ptr},importJsRenderBundleEncoder:(obj,parentPtr=0)=>{var ptr=_emwgpuCreateRenderBundleEncoder(parentPtr);WebGPU.Internals.jsObjects[ptr]=obj;return ptr},importJsRenderPassEncoder:(obj,parentPtr=0)=>{var ptr=_emwgpuCreateRenderPassEncoder(parentPtr);WebGPU.Internals.jsObjects[ptr]=obj;return ptr},importJsRenderPipeline:(obj,parentPtr=0)=>{var ptr=_emwgpuCreateRenderPipeline(parentPtr);WebGPU.Internals.jsObjects[ptr]=obj;return ptr},importJsSampler:(obj,parentPtr=0)=>{var ptr=_emwgpuCreateSampler(parentPtr);WebGPU.Internals.jsObjects[ptr]=obj;return ptr},importJsShaderModule:(obj,parentPtr=0)=>{var ptr=_emwgpuCreateShaderModule(parentPtr);WebGPU.Internals.jsObjects[ptr]=obj;return ptr},importJsSurface:(obj,parentPtr=0)=>{var ptr=_emwgpuCreateSurface(parentPtr);WebGPU.Internals.jsObjects[ptr]=obj;return ptr},importJsTexture:(obj,parentPtr=0)=>{var ptr=_emwgpuCreateTexture(parentPtr);WebGPU.Internals.jsObjects[ptr]=obj;return ptr},importJsTextureView:(obj,parentPtr=0)=>{var ptr=_emwgpuCreateTextureView(parentPtr);WebGPU.Internals.jsObjects[ptr]=obj;return ptr},errorCallback:(callback,type,message,userdata)=>{var sp=stackSave();var messagePtr=stringToUTF8OnStack(message);((a1,a2,a3)=>getWasmTableEntry(callback).call(null,a1,BigInt(a2),BigInt(a3)))(type,BigInt(messagePtr),userdata);stackRestore(sp)},iterateExtensions:(root,handlers)=>{for(var ptr=Number((growMemViews(),HEAPU64)[root/8]);ptr;ptr=Number((growMemViews(),HEAPU64)[ptr/8])){var sType=(growMemViews(),HEAP32)[(ptr+8)/4];var handler=handlers[sType](ptr)}},setStringView:(ptr,data,length)=>{(growMemViews(),HEAPU64)[ptr/8]=BigInt(data);(growMemViews(),HEAPU64)[(ptr+8)/8]=BigInt(length)},makeStringFromStringView:stringViewPtr=>{var ptr=Number((growMemViews(),HEAPU64)[stringViewPtr/8]);var length=Number((growMemViews(),HEAPU64)[(stringViewPtr+8)/8]);return UTF8ToString(ptr,length)},makeStringFromOptionalStringView:stringViewPtr=>{var ptr=Number((growMemViews(),HEAPU64)[stringViewPtr/8]);var length=Number((growMemViews(),HEAPU64)[(stringViewPtr+8)/8]);if(!ptr){if(length===0){return""}return undefined}return UTF8ToString(ptr,length)},makeColor:ptr=>({r:(growMemViews(),HEAPF64)[ptr/8],g:(growMemViews(),HEAPF64)[(ptr+8)/8],b:(growMemViews(),HEAPF64)[(ptr+16)/8],a:(growMemViews(),HEAPF64)[(ptr+24)/8]}),makeExtent3D:ptr=>({width:(growMemViews(),HEAPU32)[ptr/4],height:(growMemViews(),HEAPU32)[(ptr+4)/4],depthOrArrayLayers:(growMemViews(),HEAPU32)[(ptr+8)/4]}),makeOrigin3D:ptr=>({x:(growMemViews(),HEAPU32)[ptr/4],y:(growMemViews(),HEAPU32)[(ptr+4)/4],z:(growMemViews(),HEAPU32)[(ptr+8)/4]}),makeTexelCopyTextureInfo:ptr=>({texture:WebGPU.getJsObject(Number((growMemViews(),HEAPU64)[ptr/8])),mipLevel:(growMemViews(),HEAPU32)[(ptr+8)/4],origin:WebGPU.makeOrigin3D(ptr+12),aspect:WebGPU.TextureAspect[(growMemViews(),HEAP32)[(ptr+24)/4]]}),makeTexelCopyBufferLayout:ptr=>{var bytesPerRow=(growMemViews(),HEAPU32)[(ptr+8)/4];var rowsPerImage=(growMemViews(),HEAPU32)[(ptr+12)/4];return{offset:readI53FromI64(ptr),bytesPerRow:bytesPerRow===4294967295?undefined:bytesPerRow,rowsPerImage:rowsPerImage===4294967295?undefined:rowsPerImage}},makeTexelCopyBufferInfo:ptr=>{var layoutPtr=ptr+0;var bufferCopyView=WebGPU.makeTexelCopyBufferLayout(layoutPtr);bufferCopyView["buffer"]=WebGPU.getJsObject(Number((growMemViews(),HEAPU64)[(ptr+16)/8]));return bufferCopyView},makePassTimestampWrites:ptr=>{if(ptr===0)return undefined;return{querySet:WebGPU.getJsObject(Number((growMemViews(),HEAPU64)[(ptr+8)/8])),beginningOfPassWriteIndex:(growMemViews(),HEAPU32)[(ptr+16)/4],endOfPassWriteIndex:(growMemViews(),HEAPU32)[(ptr+20)/4]}},makePipelineConstants:(constantCount,constantsPtr)=>{if(!constantCount)return;var constants={};for(var i=0;i<constantCount;++i){var entryPtr=constantsPtr+32*i;var key=WebGPU.makeStringFromStringView(entryPtr+8);constants[key]=(growMemViews(),HEAPF64)[(entryPtr+24)/8]}return constants},makePipelineLayout:layoutPtr=>{if(!layoutPtr)return"auto";return WebGPU.getJsObject(layoutPtr)},makeComputeState:ptr=>{if(!ptr)return undefined;var desc={module:WebGPU.getJsObject(Number((growMemViews(),HEAPU64)[(ptr+8)/8])),constants:WebGPU.makePipelineConstants(Number((growMemViews(),HEAPU64)[(ptr+32)/8]),Number((growMemViews(),HEAPU64)[(ptr+40)/8])),entryPoint:WebGPU.makeStringFromOptionalStringView(ptr+16)};return desc},makeComputePipelineDesc:descriptor=>{var desc={label:WebGPU.makeStringFromOptionalStringView(descriptor+8),layout:WebGPU.makePipelineLayout(Number((growMemViews(),HEAPU64)[(descriptor+24)/8])),compute:WebGPU.makeComputeState(descriptor+32)};return desc},makeRenderPipelineDesc:descriptor=>{function makePrimitiveState(psPtr){if(!psPtr)return undefined;return{topology:WebGPU.PrimitiveTopology[(growMemViews(),HEAP32)[(psPtr+8)/4]],stripIndexFormat:WebGPU.IndexFormat[(growMemViews(),HEAP32)[(psPtr+12)/4]],frontFace:WebGPU.FrontFace[(growMemViews(),HEAP32)[(psPtr+16)/4]],cullMode:WebGPU.CullMode[(growMemViews(),HEAP32)[(psPtr+20)/4]],unclippedDepth:!!(growMemViews(),HEAPU32)[(psPtr+24)/4]}}function makeBlendComponent(bdPtr){if(!bdPtr)return undefined;return{operation:WebGPU.BlendOperation[(growMemViews(),HEAP32)[bdPtr/4]],srcFactor:WebGPU.BlendFactor[(growMemViews(),HEAP32)[(bdPtr+4)/4]],dstFactor:WebGPU.BlendFactor[(growMemViews(),HEAP32)[(bdPtr+8)/4]]}}function makeBlendState(bsPtr){if(!bsPtr)return undefined;return{alpha:makeBlendComponent(bsPtr+12),color:makeBlendComponent(bsPtr+0)}}function makeColorState(csPtr){var format=WebGPU.TextureFormat[(growMemViews(),HEAP32)[(csPtr+8)/4]];return format?{format,blend:makeBlendState(Number((growMemViews(),HEAPU64)[(csPtr+16)/8])),writeMask:(growMemViews(),HEAPU32)[(csPtr+24)/4]}:undefined}function makeColorStates(count,csArrayPtr){var states=[];for(var i=0;i<count;++i){states.push(makeColorState(csArrayPtr+32*i))}return states}function makeStencilStateFace(ssfPtr){return{compare:WebGPU.CompareFunction[(growMemViews(),HEAP32)[ssfPtr/4]],failOp:WebGPU.StencilOperation[(growMemViews(),HEAP32)[(ssfPtr+4)/4]],depthFailOp:WebGPU.StencilOperation[(growMemViews(),HEAP32)[(ssfPtr+8)/4]],passOp:WebGPU.StencilOperation[(growMemViews(),HEAP32)[(ssfPtr+12)/4]]}}function makeDepthStencilState(dssPtr){if(!dssPtr)return undefined;return{format:WebGPU.TextureFormat[(growMemViews(),HEAP32)[(dssPtr+8)/4]],depthWriteEnabled:!!(growMemViews(),HEAPU32)[(dssPtr+12)/4],depthCompare:WebGPU.CompareFunction[(growMemViews(),HEAP32)[(dssPtr+16)/4]],stencilFront:makeStencilStateFace(dssPtr+20),stencilBack:makeStencilStateFace(dssPtr+36),stencilReadMask:(growMemViews(),HEAPU32)[(dssPtr+52)/4],stencilWriteMask:(growMemViews(),HEAPU32)[(dssPtr+56)/4],depthBias:(growMemViews(),HEAP32)[(dssPtr+60)/4],depthBiasSlopeScale:(growMemViews(),HEAPF32)[(dssPtr+64)/4],depthBiasClamp:(growMemViews(),HEAPF32)[(dssPtr+68)/4]}}function makeVertexAttribute(vaPtr){return{format:WebGPU.VertexFormat[(growMemViews(),HEAP32)[(vaPtr+8)/4]],offset:readI53FromI64(vaPtr+16),shaderLocation:(growMemViews(),HEAPU32)[(vaPtr+24)/4]}}function makeVertexAttributes(count,vaArrayPtr){var vas=[];for(var i=0;i<count;++i){vas.push(makeVertexAttribute(vaArrayPtr+i*32))}return vas}function makeVertexBuffer(vbPtr){if(!vbPtr)return undefined;var stepMode=WebGPU.VertexStepMode[(growMemViews(),HEAP32)[(vbPtr+8)/4]];var attributeCount=Number((growMemViews(),HEAPU64)[(vbPtr+24)/8]);if(!stepMode&&!attributeCount){return null}return{arrayStride:readI53FromI64(vbPtr+16),stepMode,attributes:makeVertexAttributes(attributeCount,Number((growMemViews(),HEAPU64)[(vbPtr+32)/8]))}}function makeVertexBuffers(count,vbArrayPtr){if(!count)return undefined;var vbs=[];for(var i=0;i<count;++i){vbs.push(makeVertexBuffer(vbArrayPtr+i*40))}return vbs}function makeVertexState(viPtr){if(!viPtr)return undefined;var desc={module:WebGPU.getJsObject(Number((growMemViews(),HEAPU64)[(viPtr+8)/8])),constants:WebGPU.makePipelineConstants(Number((growMemViews(),HEAPU64)[(viPtr+32)/8]),Number((growMemViews(),HEAPU64)[(viPtr+40)/8])),buffers:makeVertexBuffers(Number((growMemViews(),HEAPU64)[(viPtr+48)/8]),Number((growMemViews(),HEAPU64)[(viPtr+56)/8])),entryPoint:WebGPU.makeStringFromOptionalStringView(viPtr+16)};return desc}function makeMultisampleState(msPtr){if(!msPtr)return undefined;return{count:(growMemViews(),HEAPU32)[(msPtr+8)/4],mask:(growMemViews(),HEAPU32)[(msPtr+12)/4],alphaToCoverageEnabled:!!(growMemViews(),HEAPU32)[(msPtr+16)/4]}}function makeFragmentState(fsPtr){if(!fsPtr)return undefined;var desc={module:WebGPU.getJsObject(Number((growMemViews(),HEAPU64)[(fsPtr+8)/8])),constants:WebGPU.makePipelineConstants(Number((growMemViews(),HEAPU64)[(fsPtr+32)/8]),Number((growMemViews(),HEAPU64)[(fsPtr+40)/8])),targets:makeColorStates(Number((growMemViews(),HEAPU64)[(fsPtr+48)/8]),Number((growMemViews(),HEAPU64)[(fsPtr+56)/8])),entryPoint:WebGPU.makeStringFromOptionalStringView(fsPtr+16)};return desc}var desc={label:WebGPU.makeStringFromOptionalStringView(descriptor+8),layout:WebGPU.makePipelineLayout(Number((growMemViews(),HEAPU64)[(descriptor+24)/8])),vertex:makeVertexState(descriptor+32),primitive:makePrimitiveState(descriptor+96),depthStencil:makeDepthStencilState(Number((growMemViews(),HEAPU64)[(descriptor+128)/8])),multisample:makeMultisampleState(descriptor+136),fragment:makeFragmentState(Number((growMemViews(),HEAPU64)[(descriptor+160)/8]))};return desc},fillLimitStruct:(limits,limitsOutPtr)=>{var nextInChainPtr=Number((growMemViews(),HEAPU64)[limitsOutPtr/8]);function setLimitValueU32(name,basePtr,limitOffset,fallbackValue=0){var limitValue=limits[name]??fallbackValue;(growMemViews(),HEAPU32)[(basePtr+limitOffset)/4]=limitValue}function setLimitValueU64(name,basePtr,limitOffset,fallbackValue=0){var limitValue=limits[name]??fallbackValue;writeI53ToI64(basePtr+limitOffset,limitValue)}setLimitValueU32("maxTextureDimension1D",limitsOutPtr,8);setLimitValueU32("maxTextureDimension2D",limitsOutPtr,12);setLimitValueU32("maxTextureDimension3D",limitsOutPtr,16);setLimitValueU32("maxTextureArrayLayers",limitsOutPtr,20);setLimitValueU32("maxBindGroups",limitsOutPtr,24);setLimitValueU32("maxBindGroupsPlusVertexBuffers",limitsOutPtr,28);setLimitValueU32("maxBindingsPerBindGroup",limitsOutPtr,32);setLimitValueU32("maxDynamicUniformBuffersPerPipelineLayout",limitsOutPtr,36);setLimitValueU32("maxDynamicStorageBuffersPerPipelineLayout",limitsOutPtr,40);setLimitValueU32("maxSampledTexturesPerShaderStage",limitsOutPtr,44);setLimitValueU32("maxSamplersPerShaderStage",limitsOutPtr,48);setLimitValueU32("maxStorageBuffersPerShaderStage",limitsOutPtr,52);setLimitValueU32("maxStorageTexturesPerShaderStage",limitsOutPtr,56);setLimitValueU32("maxUniformBuffersPerShaderStage",limitsOutPtr,60);setLimitValueU32("minUniformBufferOffsetAlignment",limitsOutPtr,80);setLimitValueU32("minStorageBufferOffsetAlignment",limitsOutPtr,84);setLimitValueU64("maxUniformBufferBindingSize",limitsOutPtr,64);setLimitValueU64("maxStorageBufferBindingSize",limitsOutPtr,72);setLimitValueU32("maxVertexBuffers",limitsOutPtr,88);setLimitValueU64("maxBufferSize",limitsOutPtr,96);setLimitValueU32("maxVertexAttributes",limitsOutPtr,104);setLimitValueU32("maxVertexBufferArrayStride",limitsOutPtr,108);setLimitValueU32("maxInterStageShaderVariables",limitsOutPtr,112);setLimitValueU32("maxColorAttachments",limitsOutPtr,116);setLimitValueU32("maxColorAttachmentBytesPerSample",limitsOutPtr,120);setLimitValueU32("maxComputeWorkgroupStorageSize",limitsOutPtr,124);setLimitValueU32("maxComputeInvocationsPerWorkgroup",limitsOutPtr,128);setLimitValueU32("maxComputeWorkgroupSizeX",limitsOutPtr,132);setLimitValueU32("maxComputeWorkgroupSizeY",limitsOutPtr,136);setLimitValueU32("maxComputeWorkgroupSizeZ",limitsOutPtr,140);setLimitValueU32("maxComputeWorkgroupsPerDimension",limitsOutPtr,144);setLimitValueU32("maxImmediateSize",limitsOutPtr,148);if(nextInChainPtr!==0){var sType=(growMemViews(),HEAP32)[(nextInChainPtr+8)/4];var compatibilityModeLimitsPtr=nextInChainPtr;setLimitValueU32("maxStorageBuffersInVertexStage",compatibilityModeLimitsPtr,16,limits.maxStorageBuffersPerShaderStage);setLimitValueU32("maxStorageBuffersInFragmentStage",compatibilityModeLimitsPtr,24,limits.maxStorageBuffersPerShaderStage);setLimitValueU32("maxStorageTexturesInVertexStage",compatibilityModeLimitsPtr,20,limits.maxStorageTexturesPerShaderStage);setLimitValueU32("maxStorageTexturesInFragmentStage",compatibilityModeLimitsPtr,28,limits.maxStorageTexturesPerShaderStage)}},fillAdapterInfoStruct:(info,infoStruct)=>{(growMemViews(),HEAPU32)[(infoStruct+88)/4]=info.subgroupMinSize;(growMemViews(),HEAPU32)[(infoStruct+92)/4]=info.subgroupMaxSize;var strs=info.vendor+info.architecture+info.device+info.description;var strPtr=stringToNewUTF8(strs);var vendorLen=lengthBytesUTF8(info.vendor);WebGPU.setStringView(infoStruct+8,strPtr,vendorLen);strPtr+=vendorLen;var architectureLen=lengthBytesUTF8(info.architecture);WebGPU.setStringView(infoStruct+24,strPtr,architectureLen);strPtr+=architectureLen;var deviceLen=lengthBytesUTF8(info.device);WebGPU.setStringView(infoStruct+40,strPtr,deviceLen);strPtr+=deviceLen;var descriptionLen=lengthBytesUTF8(info.description);WebGPU.setStringView(infoStruct+56,strPtr,descriptionLen);strPtr+=descriptionLen;(growMemViews(),HEAP32)[(infoStruct+72)/4]=2;var adapterType=info.isFallbackAdapter?3:4;(growMemViews(),HEAP32)[(infoStruct+76)/4]=adapterType;(growMemViews(),HEAPU32)[(infoStruct+80)/4]=0;(growMemViews(),HEAPU32)[(infoStruct+84)/4]=0},AddressMode:[,"clamp-to-edge","repeat","mirror-repeat"],BlendFactor:[,"zero","one","src","one-minus-src","src-alpha","one-minus-src-alpha","dst","one-minus-dst","dst-alpha","one-minus-dst-alpha","src-alpha-saturated","constant","one-minus-constant","src1","one-minus-src1","src1-alpha","one-minus-src1-alpha"],BlendOperation:[,"add","subtract","reverse-subtract","min","max"],BufferBindingType:[,,"uniform","storage","read-only-storage"],BufferMapState:[,"unmapped","pending","mapped"],CompareFunction:[,"never","less","equal","less-equal","greater","not-equal","greater-equal","always"],CompilationInfoRequestStatus:[,"success","callback-cancelled"],ComponentSwizzle:[,"0","1","r","g","b","a"],CompositeAlphaMode:[,"opaque","premultiplied","unpremultiplied","inherit"],CullMode:[,"none","front","back"],ErrorFilter:[,"validation","out-of-memory","internal"],FeatureLevel:[,"compatibility","core"],FeatureName:{1:"core-features-and-limits",2:"depth-clip-control",3:"depth32float-stencil8",4:"texture-compression-bc",5:"texture-compression-bc-sliced-3d",6:"texture-compression-etc2",7:"texture-compression-astc",8:"texture-compression-astc-sliced-3d",9:"timestamp-query",10:"indirect-first-instance",11:"shader-f16",12:"rg11b10ufloat-renderable",13:"bgra8unorm-storage",14:"float32-filterable",15:"float32-blendable",16:"clip-distances",17:"dual-source-blending",18:"subgroups",19:"texture-formats-tier1",20:"texture-formats-tier2",21:"primitive-index",22:"texture-component-swizzle",327692:"chromium-experimental-unorm16-texture-formats",327729:"chromium-experimental-multi-draw-indirect"},FilterMode:[,"nearest","linear"],FrontFace:[,"ccw","cw"],IndexFormat:[,"uint16","uint32"],InstanceFeatureName:[,"timed-wait-any","shader-source-spirv","multiple-devices-per-adapter"],LoadOp:[,"load","clear"],MipmapFilterMode:[,"nearest","linear"],OptionalBool:["false","true"],PowerPreference:[,"low-power","high-performance"],PredefinedColorSpace:[,"srgb","display-p3"],PrimitiveTopology:[,"point-list","line-list","line-strip","triangle-list","triangle-strip"],QueryType:[,"occlusion","timestamp"],SamplerBindingType:[,,"filtering","non-filtering","comparison"],Status:[,"success","error"],StencilOperation:[,"keep","zero","replace","invert","increment-clamp","decrement-clamp","increment-wrap","decrement-wrap"],StorageTextureAccess:[,,"write-only","read-only","read-write"],StoreOp:[,"store","discard"],SurfaceGetCurrentTextureStatus:[,"success-optimal","success-suboptimal","timeout","outdated","lost","error"],TextureAspect:[,"all","stencil-only","depth-only"],TextureDimension:[,"1d","2d","3d"],TextureFormat:[,"r8unorm","r8snorm","r8uint","r8sint","r16unorm","r16snorm","r16uint","r16sint","r16float","rg8unorm","rg8snorm","rg8uint","rg8sint","r32float","r32uint","r32sint","rg16unorm","rg16snorm","rg16uint","rg16sint","rg16float","rgba8unorm","rgba8unorm-srgb","rgba8snorm","rgba8uint","rgba8sint","bgra8unorm","bgra8unorm-srgb","rgb10a2uint","rgb10a2unorm","rg11b10ufloat","rgb9e5ufloat","rg32float","rg32uint","rg32sint","rgba16unorm","rgba16snorm","rgba16uint","rgba16sint","rgba16float","rgba32float","rgba32uint","rgba32sint","stencil8","depth16unorm","depth24plus","depth24plus-stencil8","depth32float","depth32float-stencil8","bc1-rgba-unorm","bc1-rgba-unorm-srgb","bc2-rgba-unorm","bc2-rgba-unorm-srgb","bc3-rgba-unorm","bc3-rgba-unorm-srgb","bc4-r-unorm","bc4-r-snorm","bc5-rg-unorm","bc5-rg-snorm","bc6h-rgb-ufloat","bc6h-rgb-float","bc7-rgba-unorm","bc7-rgba-unorm-srgb","etc2-rgb8unorm","etc2-rgb8unorm-srgb","etc2-rgb8a1unorm","etc2-rgb8a1unorm-srgb","etc2-rgba8unorm","etc2-rgba8unorm-srgb","eac-r11unorm","eac-r11snorm","eac-rg11unorm","eac-rg11snorm","astc-4x4-unorm","astc-4x4-unorm-srgb","astc-5x4-unorm","astc-5x4-unorm-srgb","astc-5x5-unorm","astc-5x5-unorm-srgb","astc-6x5-unorm","astc-6x5-unorm-srgb","astc-6x6-unorm","astc-6x6-unorm-srgb","astc-8x5-unorm","astc-8x5-unorm-srgb","astc-8x6-unorm","astc-8x6-unorm-srgb","astc-8x8-unorm","astc-8x8-unorm-srgb","astc-10x5-unorm","astc-10x5-unorm-srgb","astc-10x6-unorm","astc-10x6-unorm-srgb","astc-10x8-unorm","astc-10x8-unorm-srgb","astc-10x10-unorm","astc-10x10-unorm-srgb","astc-12x10-unorm","astc-12x10-unorm-srgb","astc-12x12-unorm","astc-12x12-unorm-srgb"],TextureSampleType:[,,"float","unfilterable-float","depth","sint","uint"],TextureViewDimension:[,"1d","2d","2d-array","cube","cube-array","3d"],ToneMappingMode:[,"standard","extended"],VertexFormat:[,"uint8","uint8x2","uint8x4","sint8","sint8x2","sint8x4","unorm8","unorm8x2","unorm8x4","snorm8","snorm8x2","snorm8x4","uint16","uint16x2","uint16x4","sint16","sint16x2","sint16x4","unorm16","unorm16x2","unorm16x4","snorm16","snorm16x2","snorm16x4","float16","float16x2","float16x4","float32","float32x2","float32x3","float32x4","uint32","uint32x2","uint32x3","uint32x4","sint32","sint32x2","sint32x3","sint32x4","unorm10-10-10-2","unorm8x4-bgra"],VertexStepMode:[,"vertex","instance"],WGSLLanguageFeatureName:[,"readonly_and_readwrite_storage_textures","packed_4x8_integer_dot_product","unrestricted_pointer_parameters","pointer_composite_access","uniform_buffer_standard_layout","subgroup_id","texture_and_sampler_let","subgroup_uniformity","texture_formats_tier1"]};var emwgpuStringToInt_DeviceLostReason={undefined:1,unknown:1,destroyed:2};var runtimeKeepalivePop=()=>{runtimeKeepaliveCounter-=1};function _emwgpuAdapterRequestDevice(adapterPtr,futureId,deviceLostFutureId,devicePtr,queuePtr,descriptor){adapterPtr=bigintToI53Checked(adapterPtr);futureId=bigintToI53Checked(futureId);deviceLostFutureId=bigintToI53Checked(deviceLostFutureId);devicePtr=bigintToI53Checked(devicePtr);queuePtr=bigintToI53Checked(queuePtr);descriptor=bigintToI53Checked(descriptor);var adapter=WebGPU.getJsObject(adapterPtr);var desc={};if(descriptor){var requiredFeatureCount=Number((growMemViews(),HEAPU64)[(descriptor+24)/8]);if(requiredFeatureCount){var requiredFeaturesPtr=Number((growMemViews(),HEAPU64)[(descriptor+32)/8]);desc["requiredFeatures"]=Array.from((growMemViews(),HEAPU32).subarray(requiredFeaturesPtr/4,(requiredFeaturesPtr+requiredFeatureCount*4)/4),feature=>WebGPU.FeatureName[feature])}var limitsPtr=Number((growMemViews(),HEAPU64)[(descriptor+40)/8]);if(limitsPtr){var nextInChainPtr=Number((growMemViews(),HEAPU64)[limitsPtr/8]);var requiredLimits={};function setLimitU32IfDefined(name,basePtr,limitOffset,ignoreIfZero=false){var ptr=basePtr+limitOffset;var value=(growMemViews(),HEAPU32)[ptr/4];if(value!=4294967295&&(!ignoreIfZero||value!=0)){requiredLimits[name]=value}}function setLimitU64IfDefined(name,basePtr,limitOffset){var ptr=basePtr+limitOffset;var limitPart1=(growMemViews(),HEAPU32)[ptr/4];var limitPart2=(growMemViews(),HEAPU32)[(ptr+4)/4];if(limitPart1!=4294967295||limitPart2!=4294967295){requiredLimits[name]=readI53FromI64(ptr)}}setLimitU32IfDefined("maxTextureDimension1D",limitsPtr,8);setLimitU32IfDefined("maxTextureDimension2D",limitsPtr,12);setLimitU32IfDefined("maxTextureDimension3D",limitsPtr,16);setLimitU32IfDefined("maxTextureArrayLayers",limitsPtr,20);setLimitU32IfDefined("maxBindGroups",limitsPtr,24);setLimitU32IfDefined("maxBindGroupsPlusVertexBuffers",limitsPtr,28);setLimitU32IfDefined("maxBindingsPerBindGroup",limitsPtr,32);setLimitU32IfDefined("maxDynamicUniformBuffersPerPipelineLayout",limitsPtr,36);setLimitU32IfDefined("maxDynamicStorageBuffersPerPipelineLayout",limitsPtr,40);setLimitU32IfDefined("maxSampledTexturesPerShaderStage",limitsPtr,44);setLimitU32IfDefined("maxSamplersPerShaderStage",limitsPtr,48);setLimitU32IfDefined("maxStorageBuffersPerShaderStage",limitsPtr,52);setLimitU32IfDefined("maxStorageTexturesPerShaderStage",limitsPtr,56);setLimitU32IfDefined("maxUniformBuffersPerShaderStage",limitsPtr,60);setLimitU32IfDefined("minUniformBufferOffsetAlignment",limitsPtr,80);setLimitU32IfDefined("minStorageBufferOffsetAlignment",limitsPtr,84);setLimitU64IfDefined("maxUniformBufferBindingSize",limitsPtr,64);setLimitU64IfDefined("maxStorageBufferBindingSize",limitsPtr,72);setLimitU32IfDefined("maxVertexBuffers",limitsPtr,88);setLimitU64IfDefined("maxBufferSize",limitsPtr,96);setLimitU32IfDefined("maxVertexAttributes",limitsPtr,104);setLimitU32IfDefined("maxVertexBufferArrayStride",limitsPtr,108);setLimitU32IfDefined("maxInterStageShaderVariables",limitsPtr,112);setLimitU32IfDefined("maxColorAttachments",limitsPtr,116);setLimitU32IfDefined("maxColorAttachmentBytesPerSample",limitsPtr,120);setLimitU32IfDefined("maxComputeWorkgroupStorageSize",limitsPtr,124);setLimitU32IfDefined("maxComputeInvocationsPerWorkgroup",limitsPtr,128);setLimitU32IfDefined("maxComputeWorkgroupSizeX",limitsPtr,132);setLimitU32IfDefined("maxComputeWorkgroupSizeY",limitsPtr,136);setLimitU32IfDefined("maxComputeWorkgroupSizeZ",limitsPtr,140);setLimitU32IfDefined("maxComputeWorkgroupsPerDimension",limitsPtr,144);setLimitU32IfDefined("maxImmediateSize",limitsPtr,148,true);if(nextInChainPtr!==0){var sType=(growMemViews(),HEAP32)[(nextInChainPtr+8)/4];var compatibilityModeLimitsPtr=nextInChainPtr;if("maxStorageBuffersInVertexStage"in GPUSupportedLimits.prototype){setLimitU32IfDefined("maxStorageBuffersInVertexStage",compatibilityModeLimitsPtr,16);setLimitU32IfDefined("maxStorageTexturesInVertexStage",compatibilityModeLimitsPtr,20);setLimitU32IfDefined("maxStorageBuffersInFragmentStage",compatibilityModeLimitsPtr,24);setLimitU32IfDefined("maxStorageTexturesInFragmentStage",compatibilityModeLimitsPtr,28)}}desc["requiredLimits"]=requiredLimits}var defaultQueuePtr=Number((growMemViews(),HEAPU64)[(descriptor+48)/8]);if(defaultQueuePtr){var defaultQueueDesc={label:WebGPU.makeStringFromOptionalStringView(defaultQueuePtr+8)};desc["defaultQueue"]=defaultQueueDesc}desc["label"]=WebGPU.makeStringFromOptionalStringView(descriptor+8)}runtimeKeepalivePush();WebGPU.Internals.futureInsert(futureId,adapter.requestDevice(desc).then(device=>{runtimeKeepalivePop();callUserCallback(()=>{WebGPU.Internals.jsObjectInsert(queuePtr,device.queue);WebGPU.Internals.jsObjectInsert(devicePtr,device);devicePtr=BigInt(devicePtr);WebGPU.Internals.futureInsert(deviceLostFutureId,device.lost.then(info=>{callUserCallback(()=>{device.onuncapturederror=ev=>{};var sp=stackSave();var messagePtr=stringToUTF8OnStack(info.message);_emwgpuOnDeviceLostCompleted(deviceLostFutureId,emwgpuStringToInt_DeviceLostReason[info.reason],BigInt(messagePtr));stackRestore(sp)})}));device.onuncapturederror=ev=>{var type=5;if(ev.error instanceof GPUValidationError)type=2;else if(ev.error instanceof GPUOutOfMemoryError)type=3;else if(ev.error instanceof GPUInternalError)type=4;var sp=stackSave();var messagePtr=stringToUTF8OnStack(ev.error.message);_emwgpuOnUncapturedError(BigInt(devicePtr),type,BigInt(messagePtr));stackRestore(sp)};_emwgpuOnRequestDeviceCompleted(futureId,1,BigInt(devicePtr),0n)})},ex=>{runtimeKeepalivePop();callUserCallback(()=>{var sp=stackSave();var messagePtr=stringToUTF8OnStack(ex.message);_emwgpuOnRequestDeviceCompleted(futureId,3,BigInt(devicePtr),BigInt(messagePtr));if(deviceLostFutureId){_emwgpuOnDeviceLostCompleted(deviceLostFutureId,4,BigInt(messagePtr))}stackRestore(sp)})}))}function _emwgpuBufferDestroy(bufferPtr){bufferPtr=bigintToI53Checked(bufferPtr);var buffer=WebGPU.getJsObject(bufferPtr);var onUnmap=WebGPU.Internals.bufferOnUnmaps[bufferPtr];if(onUnmap){for(var i=0;i<onUnmap.length;++i){onUnmap[i]()}delete WebGPU.Internals.bufferOnUnmaps[bufferPtr]}buffer.destroy()}var warnOnce=text=>{warnOnce.shown||={};if(!warnOnce.shown[text]){warnOnce.shown[text]=1;if(ENVIRONMENT_IS_NODE)text="warning: "+text;err(text)}};var _emwgpuBufferGetConstMappedRange=function(bufferPtr,offset,size){bufferPtr=bigintToI53Checked(bufferPtr);offset=bigintToI53Checked(offset);size=bigintToI53Checked(size);var ret=(()=>{var buffer=WebGPU.getJsObject(bufferPtr);if(size==-1)size=undefined;var mapped;try{mapped=buffer.getMappedRange(offset,size)}catch(ex){return 0n}var data=_memalign(16,mapped.byteLength);(growMemViews(),HEAPU8).set(new Uint8Array(mapped),data);WebGPU.Internals.bufferOnUnmaps[bufferPtr].push(()=>_free(data));return data})();return BigInt(ret)};var _emwgpuBufferMapAsync=function(bufferPtr,futureId,mode,offset,size){bufferPtr=bigintToI53Checked(bufferPtr);futureId=bigintToI53Checked(futureId);mode=bigintToI53Checked(mode);offset=bigintToI53Checked(offset);size=bigintToI53Checked(size);var buffer=WebGPU.getJsObject(bufferPtr);WebGPU.Internals.bufferOnUnmaps[bufferPtr]=[];if(size==-1)size=undefined;runtimeKeepalivePush();WebGPU.Internals.futureInsert(futureId,buffer.mapAsync(mode,offset,size).then(()=>{runtimeKeepalivePop();callUserCallback(()=>{_emwgpuOnMapAsyncCompleted(futureId,1,0n)})},ex=>{runtimeKeepalivePop();callUserCallback(()=>{var sp=stackSave();var messagePtr=stringToUTF8OnStack(ex.message);var status=ex.name==="AbortError"?4:ex.name==="OperationError"?3:0;_emwgpuOnMapAsyncCompleted(futureId,status,BigInt(messagePtr));delete WebGPU.Internals.bufferOnUnmaps[bufferPtr]})}))};function _emwgpuBufferUnmap(bufferPtr){bufferPtr=bigintToI53Checked(bufferPtr);var buffer=WebGPU.getJsObject(bufferPtr);var onUnmap=WebGPU.Internals.bufferOnUnmaps[bufferPtr];if(!onUnmap){return}for(var i=0;i<onUnmap.length;++i){onUnmap[i]()}delete WebGPU.Internals.bufferOnUnmaps[bufferPtr];buffer.unmap()}function _emwgpuDelete(ptr){ptr=bigintToI53Checked(ptr);delete WebGPU.Internals.jsObjects[ptr]}function _emwgpuDeviceCreateBuffer(devicePtr,descriptor,bufferPtr){devicePtr=bigintToI53Checked(devicePtr);descriptor=bigintToI53Checked(descriptor);bufferPtr=bigintToI53Checked(bufferPtr);var mappedAtCreation=!!(growMemViews(),HEAPU32)[(descriptor+40)/4];var desc={label:WebGPU.makeStringFromOptionalStringView(descriptor+8),usage:(growMemViews(),HEAPU32)[(descriptor+24)/4],size:readI53FromI64(descriptor+32),mappedAtCreation};var device=WebGPU.getJsObject(devicePtr);var buffer;try{buffer=device.createBuffer(desc)}catch(ex){return false}WebGPU.Internals.jsObjectInsert(bufferPtr,buffer);if(mappedAtCreation){WebGPU.Internals.bufferOnUnmaps[bufferPtr]=[]}return true}function _emwgpuDeviceCreateShaderModule(devicePtr,descriptor,shaderModulePtr){devicePtr=bigintToI53Checked(devicePtr);descriptor=bigintToI53Checked(descriptor);shaderModulePtr=bigintToI53Checked(shaderModulePtr);var nextInChainPtr=Number((growMemViews(),HEAPU64)[descriptor/8]);var sType=(growMemViews(),HEAP32)[(nextInChainPtr+8)/4];var desc={label:WebGPU.makeStringFromOptionalStringView(descriptor+8),code:""};switch(sType){case 2:{desc["code"]=WebGPU.makeStringFromStringView(nextInChainPtr+16);break}}var device=WebGPU.getJsObject(devicePtr);WebGPU.Internals.jsObjectInsert(shaderModulePtr,device.createShaderModule(desc))}var _emwgpuDeviceDestroy=devicePtr=>{const device=WebGPU.getJsObject(devicePtr);device.onuncapturederror=null;device.destroy()};function _emwgpuInstanceRequestAdapter(instancePtr,futureId,options,adapterPtr){instancePtr=bigintToI53Checked(instancePtr);futureId=bigintToI53Checked(futureId);options=bigintToI53Checked(options);adapterPtr=bigintToI53Checked(adapterPtr);var opts;if(options){opts={featureLevel:WebGPU.FeatureLevel[(growMemViews(),HEAP32)[(options+8)/4]],powerPreference:WebGPU.PowerPreference[(growMemViews(),HEAP32)[(options+12)/4]],forceFallbackAdapter:!!(growMemViews(),HEAPU32)[(options+16)/4]};var nextInChainPtr=Number((growMemViews(),HEAPU64)[options/8]);if(nextInChainPtr!==0){var sType=(growMemViews(),HEAP32)[(nextInChainPtr+8)/4];var webxrOptions=nextInChainPtr;opts.xrCompatible=!!(growMemViews(),HEAPU32)[(webxrOptions+16)/4]}}if(!("gpu"in navigator)){var sp=stackSave();var messagePtr=stringToUTF8OnStack("WebGPU not available on this browser (navigator.gpu is not available)");_emwgpuOnRequestAdapterCompleted(futureId,3,BigInt(adapterPtr),BigInt(messagePtr));stackRestore(sp);return}runtimeKeepalivePush();WebGPU.Internals.futureInsert(futureId,navigator.gpu.requestAdapter(opts).then(adapter=>{runtimeKeepalivePop();callUserCallback(()=>{if(adapter){WebGPU.Internals.jsObjectInsert(adapterPtr,adapter);_emwgpuOnRequestAdapterCompleted(futureId,1,BigInt(adapterPtr),0n)}else{var sp=stackSave();var messagePtr=stringToUTF8OnStack("WebGPU not available on this browser (requestAdapter returned null)");_emwgpuOnRequestAdapterCompleted(futureId,3,BigInt(adapterPtr),BigInt(messagePtr));stackRestore(sp)}})},ex=>{runtimeKeepalivePop();callUserCallback(()=>{var sp=stackSave();var messagePtr=stringToUTF8OnStack(ex.message);_emwgpuOnRequestAdapterCompleted(futureId,4,BigInt(adapterPtr),BigInt(messagePtr));stackRestore(sp)})}))}var _emwgpuQueueOnSubmittedWorkDone=function(queuePtr,futureId){queuePtr=bigintToI53Checked(queuePtr);futureId=bigintToI53Checked(futureId);var queue=WebGPU.getJsObject(queuePtr);runtimeKeepalivePush();WebGPU.Internals.futureInsert(futureId,queue.onSubmittedWorkDone().then(()=>{runtimeKeepalivePop();callUserCallback(()=>{_emwgpuOnWorkDoneCompleted(futureId,1)})}))};var _emwgpuWaitAny=function(futurePtr,futureCount,timeoutMSPtr){futurePtr=bigintToI53Checked(futurePtr);futureCount=bigintToI53Checked(futureCount);timeoutMSPtr=bigintToI53Checked(timeoutMSPtr);return Asyncify.handleAsync(async()=>{var promises=[];if(timeoutMSPtr){var timeoutMS=(growMemViews(),HEAP32)[timeoutMSPtr/4];promises.length=futureCount+1;promises[futureCount]=new Promise(resolve=>setTimeout(resolve,timeoutMS,0))}else{promises.length=futureCount}for(var i=0;i<futureCount;++i){var futureId=readI53FromI64(futurePtr+i*8);if(!(futureId in WebGPU.Internals.futures)){return futureId}promises[i]=WebGPU.Internals.futures[futureId]}const firstResolvedFuture=await Promise.race(promises);delete WebGPU.Internals.futures[firstResolvedFuture];return firstResolvedFuture})};_emwgpuWaitAny.isAsync=true;var ENV={};var getExecutableName=()=>thisProgram||"./this.program";var getEnvStrings=()=>{if(!getEnvStrings.strings){var lang=(typeof navigator=="object"&&navigator.language||"C").replace("-","_")+".UTF-8";var env={USER:"web_user",LOGNAME:"web_user",PATH:"/",PWD:"/",HOME:"/home/web_user",LANG:lang,_:getExecutableName()};for(var x in ENV){if(ENV[x]===undefined)delete env[x];else env[x]=ENV[x]}var strings=[];for(var x in env){strings.push(`${x}=${env[x]}`)}getEnvStrings.strings=strings}return getEnvStrings.strings};function _environ_get(__environ,environ_buf){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(14,0,1,__environ,environ_buf);__environ=bigintToI53Checked(__environ);environ_buf=bigintToI53Checked(environ_buf);var bufSize=0;var envp=0;for(var string of getEnvStrings()){var ptr=environ_buf+bufSize;(growMemViews(),HEAPU64)[(__environ+envp)/8]=BigInt(ptr);bufSize+=stringToUTF8(string,ptr,Infinity)+1;envp+=8}return 0}function _environ_sizes_get(penviron_count,penviron_buf_size){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(15,0,1,penviron_count,penviron_buf_size);penviron_count=bigintToI53Checked(penviron_count);penviron_buf_size=bigintToI53Checked(penviron_buf_size);var strings=getEnvStrings();(growMemViews(),HEAPU64)[penviron_count/8]=BigInt(strings.length);var bufSize=0;for(var string of strings){bufSize+=lengthBytesUTF8(string)+1}(growMemViews(),HEAPU64)[penviron_buf_size/8]=BigInt(bufSize);return 0}function _fd_close(fd){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(16,0,1,fd);try{var stream=SYSCALLS.getStreamFromFD(fd);FS.close(stream);return 0}catch(e){if(typeof FS=="undefined"||!(e.name==="ErrnoError"))throw e;return e.errno}}var doReadv=(stream,iov,iovcnt,offset)=>{var ret=0;for(var i=0;i<iovcnt;i++){var ptr=Number((growMemViews(),HEAPU64)[iov/8]);var len=Number((growMemViews(),HEAPU64)[(iov+8)/8]);iov+=16;var curr=FS.read(stream,(growMemViews(),HEAP8),ptr,len,offset);if(curr<0)return-1;ret+=curr;if(curr<len)break;if(typeof offset!="undefined"){offset+=curr}}return ret};function _fd_read(fd,iov,iovcnt,pnum){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(17,0,1,fd,iov,iovcnt,pnum);iov=bigintToI53Checked(iov);iovcnt=bigintToI53Checked(iovcnt);pnum=bigintToI53Checked(pnum);try{var stream=SYSCALLS.getStreamFromFD(fd);var num=doReadv(stream,iov,iovcnt);(growMemViews(),HEAPU64)[pnum/8]=BigInt(num);return 0}catch(e){if(typeof FS=="undefined"||!(e.name==="ErrnoError"))throw e;return e.errno}}function _fd_seek(fd,offset,whence,newOffset){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(18,0,1,fd,offset,whence,newOffset);offset=bigintToI53Checked(offset);newOffset=bigintToI53Checked(newOffset);try{if(isNaN(offset))return 61;var stream=SYSCALLS.getStreamFromFD(fd);FS.llseek(stream,offset,whence);(growMemViews(),HEAP64)[newOffset/8]=BigInt(stream.position);if(stream.getdents&&offset===0&&whence===0)stream.getdents=null;return 0}catch(e){if(typeof FS=="undefined"||!(e.name==="ErrnoError"))throw e;return e.errno}}var doWritev=(stream,iov,iovcnt,offset)=>{var ret=0;for(var i=0;i<iovcnt;i++){var ptr=Number((growMemViews(),HEAPU64)[iov/8]);var len=Number((growMemViews(),HEAPU64)[(iov+8)/8]);iov+=16;var curr=FS.write(stream,(growMemViews(),HEAP8),ptr,len,offset);if(curr<0)return-1;ret+=curr;if(curr<len){break}if(typeof offset!="undefined"){offset+=curr}}return ret};function _fd_write(fd,iov,iovcnt,pnum){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(19,0,1,fd,iov,iovcnt,pnum);iov=bigintToI53Checked(iov);iovcnt=bigintToI53Checked(iovcnt);pnum=bigintToI53Checked(pnum);try{var stream=SYSCALLS.getStreamFromFD(fd);var num=doWritev(stream,iov,iovcnt);(growMemViews(),HEAPU64)[pnum/8]=BigInt(num);return 0}catch(e){if(typeof FS=="undefined"||!(e.name==="ErrnoError"))throw e;return e.errno}}function _random_get(buffer,size){buffer=bigintToI53Checked(buffer);size=bigintToI53Checked(size);try{randomFill((growMemViews(),HEAPU8).subarray(buffer,buffer+size));return 0}catch(e){if(typeof FS=="undefined"||!(e.name==="ErrnoError"))throw e;return e.errno}}function _wgpuAdapterGetInfo(adapterPtr,info){adapterPtr=bigintToI53Checked(adapterPtr);info=bigintToI53Checked(info);var adapter=WebGPU.getJsObject(adapterPtr);WebGPU.fillAdapterInfoStruct(adapter.info,info);return 1}function _wgpuAdapterGetLimits(adapterPtr,limitsOutPtr){adapterPtr=bigintToI53Checked(adapterPtr);limitsOutPtr=bigintToI53Checked(limitsOutPtr);var adapter=WebGPU.getJsObject(adapterPtr);WebGPU.fillLimitStruct(adapter.limits,limitsOutPtr);return 1}function _wgpuAdapterHasFeature(adapterPtr,featureEnumValue){adapterPtr=bigintToI53Checked(adapterPtr);var adapter=WebGPU.getJsObject(adapterPtr);return adapter.features.has(WebGPU.FeatureName[featureEnumValue])}var _wgpuBufferGetSize=function(bufferPtr){bufferPtr=bigintToI53Checked(bufferPtr);var ret=(()=>{var buffer=WebGPU.getJsObject(bufferPtr);return buffer.size})();return BigInt(ret)};var _wgpuCommandEncoderBeginComputePass=function(encoderPtr,descriptor){encoderPtr=bigintToI53Checked(encoderPtr);descriptor=bigintToI53Checked(descriptor);var ret=(()=>{var desc;if(descriptor){desc={label:WebGPU.makeStringFromOptionalStringView(descriptor+8),timestampWrites:WebGPU.makePassTimestampWrites(Number((growMemViews(),HEAPU64)[(descriptor+24)/8]))}}var commandEncoder=WebGPU.getJsObject(encoderPtr);var ptr=_emwgpuCreateComputePassEncoder(0n);WebGPU.Internals.jsObjectInsert(ptr,commandEncoder.beginComputePass(desc));return ptr})();return BigInt(ret)};function _wgpuCommandEncoderCopyBufferToBuffer(encoderPtr,srcPtr,srcOffset,dstPtr,dstOffset,size){encoderPtr=bigintToI53Checked(encoderPtr);srcPtr=bigintToI53Checked(srcPtr);srcOffset=bigintToI53Checked(srcOffset);dstPtr=bigintToI53Checked(dstPtr);dstOffset=bigintToI53Checked(dstOffset);size=bigintToI53Checked(size);var commandEncoder=WebGPU.getJsObject(encoderPtr);var src=WebGPU.getJsObject(srcPtr);var dst=WebGPU.getJsObject(dstPtr);commandEncoder.copyBufferToBuffer(src,srcOffset,dst,dstOffset,size)}var _wgpuCommandEncoderFinish=function(encoderPtr,descriptor){encoderPtr=bigintToI53Checked(encoderPtr);descriptor=bigintToI53Checked(descriptor);var ret=(()=>{var commandEncoder=WebGPU.getJsObject(encoderPtr);var ptr=_emwgpuCreateCommandBuffer(0n);WebGPU.Internals.jsObjectInsert(ptr,commandEncoder.finish());return ptr})();return BigInt(ret)};function _wgpuComputePassEncoderDispatchWorkgroups(passPtr,x,y,z){passPtr=bigintToI53Checked(passPtr);var pass=WebGPU.getJsObject(passPtr);pass.dispatchWorkgroups(x,y,z)}function _wgpuComputePassEncoderEnd(passPtr){passPtr=bigintToI53Checked(passPtr);var pass=WebGPU.getJsObject(passPtr);pass.end()}function _wgpuComputePassEncoderSetBindGroup(passPtr,groupIndex,groupPtr,dynamicOffsetCount,dynamicOffsetsPtr){passPtr=bigintToI53Checked(passPtr);groupPtr=bigintToI53Checked(groupPtr);dynamicOffsetCount=bigintToI53Checked(dynamicOffsetCount);dynamicOffsetsPtr=bigintToI53Checked(dynamicOffsetsPtr);var pass=WebGPU.getJsObject(passPtr);var group=WebGPU.getJsObject(groupPtr);if(dynamicOffsetCount==0){pass.setBindGroup(groupIndex,group)}else{pass.setBindGroup(groupIndex,group,(growMemViews(),HEAPU32),dynamicOffsetsPtr/4,dynamicOffsetCount)}}function _wgpuComputePassEncoderSetPipeline(passPtr,pipelinePtr){passPtr=bigintToI53Checked(passPtr);pipelinePtr=bigintToI53Checked(pipelinePtr);var pass=WebGPU.getJsObject(passPtr);var pipeline=WebGPU.getJsObject(pipelinePtr);pass.setPipeline(pipeline)}var _wgpuComputePipelineGetBindGroupLayout=function(pipelinePtr,groupIndex){pipelinePtr=bigintToI53Checked(pipelinePtr);var ret=(()=>{var pipeline=WebGPU.getJsObject(pipelinePtr);var ptr=_emwgpuCreateBindGroupLayout(0n);WebGPU.Internals.jsObjectInsert(ptr,pipeline.getBindGroupLayout(groupIndex));return ptr})();return BigInt(ret)};var _wgpuDeviceCreateBindGroup=function(devicePtr,descriptor){devicePtr=bigintToI53Checked(devicePtr);descriptor=bigintToI53Checked(descriptor);var ret=(()=>{function makeEntry(entryPtr){var bufferPtr=Number((growMemViews(),HEAPU64)[(entryPtr+16)/8]);var samplerPtr=Number((growMemViews(),HEAPU64)[(entryPtr+40)/8]);var textureViewPtr=Number((growMemViews(),HEAPU64)[(entryPtr+48)/8]);var externalTexturePtr=0;WebGPU.iterateExtensions(entryPtr,{327681:ptr=>{externalTexturePtr=Number((growMemViews(),HEAPU64)[(ptr+16)/8])}});var resource;if(bufferPtr){var size=readI53FromI64(entryPtr+32);if(size==-1)size=undefined;resource={buffer:WebGPU.getJsObject(bufferPtr),offset:readI53FromI64(entryPtr+24),size}}else{resource=WebGPU.getJsObject(samplerPtr||textureViewPtr||externalTexturePtr)}return{binding:(growMemViews(),HEAPU32)[(entryPtr+8)/4],resource}}function makeEntries(count,entriesPtrs){var entries=[];for(var i=0;i<count;++i){entries.push(makeEntry(entriesPtrs+56*i))}return entries}var desc={label:WebGPU.makeStringFromOptionalStringView(descriptor+8),layout:WebGPU.getJsObject(Number((growMemViews(),HEAPU64)[(descriptor+24)/8])),entries:makeEntries(Number((growMemViews(),HEAPU64)[(descriptor+32)/8]),Number((growMemViews(),HEAPU64)[(descriptor+40)/8]))};var device=WebGPU.getJsObject(devicePtr);var ptr=_emwgpuCreateBindGroup(0n);WebGPU.Internals.jsObjectInsert(ptr,device.createBindGroup(desc));return ptr})();return BigInt(ret)};var _wgpuDeviceCreateCommandEncoder=function(devicePtr,descriptor){devicePtr=bigintToI53Checked(devicePtr);descriptor=bigintToI53Checked(descriptor);var ret=(()=>{var desc;if(descriptor){desc={label:WebGPU.makeStringFromOptionalStringView(descriptor+8)}}var device=WebGPU.getJsObject(devicePtr);var ptr=_emwgpuCreateCommandEncoder(0n);WebGPU.Internals.jsObjectInsert(ptr,device.createCommandEncoder(desc));return ptr})();return BigInt(ret)};var _wgpuDeviceCreateComputePipeline=function(devicePtr,descriptor){devicePtr=bigintToI53Checked(devicePtr);descriptor=bigintToI53Checked(descriptor);var ret=(()=>{var desc=WebGPU.makeComputePipelineDesc(descriptor);var device=WebGPU.getJsObject(devicePtr);var ptr=_emwgpuCreateComputePipeline(0n);WebGPU.Internals.jsObjectInsert(ptr,device.createComputePipeline(desc));return ptr})();return BigInt(ret)};function _wgpuInstanceHasWGSLLanguageFeature(instance,featureEnumValue){instance=bigintToI53Checked(instance);if(!("wgslLanguageFeatures"in navigator.gpu)){return false}return navigator.gpu.wgslLanguageFeatures.has(WebGPU.WGSLLanguageFeatureName[featureEnumValue])}var _wgpuQueueSubmit=function(queuePtr,commandCount,commands){queuePtr=bigintToI53Checked(queuePtr);commandCount=bigintToI53Checked(commandCount);commands=bigintToI53Checked(commands);var queue=WebGPU.getJsObject(queuePtr);var cmds=Array.from((growMemViews(),HEAP64).subarray(commands/8,(commands+commandCount*8)/8),id=>WebGPU.getJsObject(id));queue.submit(cmds)};function _wgpuQueueWriteBuffer(queuePtr,bufferPtr,bufferOffset,data,size){queuePtr=bigintToI53Checked(queuePtr);bufferPtr=bigintToI53Checked(bufferPtr);bufferOffset=bigintToI53Checked(bufferOffset);data=bigintToI53Checked(data);size=bigintToI53Checked(size);var queue=WebGPU.getJsObject(queuePtr);var buffer=WebGPU.getJsObject(bufferPtr);var subarray=(growMemViews(),HEAPU8).subarray(data,data+size);queue.writeBuffer(buffer,bufferOffset,subarray,0,size)}var Asyncify={instrumentWasmImports(imports){var importPattern=/^(invoke_.*|__asyncjs__.*)$/;for(let[x,original]of Object.entries(imports)){if(typeof original=="function"){let isAsyncifyImport=original.isAsync||importPattern.test(x);if(isAsyncifyImport){imports[x]=original=new WebAssembly.Suspending(original)}}}},instrumentFunction(original){var wrapper=(...args)=>original(...args);return wrapper},instrumentWasmExports(exports){var exportPattern=/^(wllama_start|wllama_action|main|__main_argc_argv)$/;Asyncify.asyncExports=new Set;var ret={};for(let[x,original]of Object.entries(exports)){if(typeof original=="function"){let isAsyncifyExport=exportPattern.test(x);if(isAsyncifyExport){Asyncify.asyncExports.add(original);original=Asyncify.makeAsyncFunction(original)}var wrapper=Asyncify.instrumentFunction(original);ret[x]=wrapper}else{ret[x]=original}}return ret},asyncExports:null,isAsyncExport(func){return Asyncify.asyncExports?.has(func)},handleAsync:async startAsync=>{runtimeKeepalivePush();try{return await startAsync()}finally{runtimeKeepalivePop()}},handleSleep:startAsync=>Asyncify.handleAsync(()=>new Promise(startAsync)),makeAsyncFunction(original){return WebAssembly.promising(original)}};var getCFunc=ident=>{var func=Module["_"+ident];return func};var writeArrayToMemory=(array,buffer)=>{(growMemViews(),HEAP8).set(array,buffer)};var ccall=(ident,returnType,argTypes,args,opts)=>{var toC={pointer:p=>BigInt(p),string:str=>{var ret=0;if(str!==null&&str!==undefined&&str!==0){ret=stringToUTF8OnStack(str)}return BigInt(ret)},array:arr=>{var ret=stackAlloc(arr.length);writeArrayToMemory(arr,ret);return BigInt(ret)}};function convertReturnValue(ret){if(returnType==="string"){return UTF8ToString(Number(ret))}if(returnType==="pointer")return Number(ret);if(returnType==="boolean")return Boolean(ret);return ret}var func=getCFunc(ident);var cArgs=[];var stack=0;if(args){for(var i=0;i<args.length;i++){var converter=toC[argTypes[i]];if(converter){if(stack===0)stack=stackSave();cArgs[i]=converter(args[i])}else{cArgs[i]=args[i]}}}var ret=func(...cArgs);function onDone(ret){if(stack!==0)stackRestore(stack);return convertReturnValue(ret)}var asyncMode=opts?.async;if(asyncMode)return ret.then(onDone);ret=onDone(ret);return ret};var cwrap=(ident,returnType,argTypes,opts)=>{var numericArgs=!argTypes||argTypes.every(type=>type==="number"||type==="boolean");var numericRet=returnType!=="string";if(numericRet&&numericArgs&&!opts){return getCFunc(ident)}return(...args)=>ccall(ident,returnType,argTypes,args,opts)};var FS_createPath=(...args)=>FS.createPath(...args);var FS_unlink=(...args)=>FS.unlink(...args);var FS_createLazyFile=(...args)=>FS.createLazyFile(...args);var FS_createDevice=(...args)=>FS.createDevice(...args);PThread.init();FS.createPreloadedFile=FS_createPreloadedFile;FS.preloadFile=FS_preloadFile;FS.staticInit();{initMemory();if(Module["noExitRuntime"])noExitRuntime=Module["noExitRuntime"];if(Module["preloadPlugins"])preloadPlugins=Module["preloadPlugins"];if(Module["print"])out=Module["print"];if(Module["printErr"])err=Module["printErr"];if(Module["wasmBinary"])wasmBinary=Module["wasmBinary"];if(Module["arguments"])arguments_=Module["arguments"];if(Module["thisProgram"])thisProgram=Module["thisProgram"];if(Module["preInit"]){if(typeof Module["preInit"]=="function")Module["preInit"]=[Module["preInit"]];while(Module["preInit"].length>0){Module["preInit"].shift()()}}}Module["ENV"]=ENV;Module["mmapAlloc"]=mmapAlloc;Module["wasmMemory"]=wasmMemory;Module["addRunDependency"]=addRunDependency;Module["removeRunDependency"]=removeRunDependency;Module["ccall"]=ccall;Module["cwrap"]=cwrap;Module["FS_preloadFile"]=FS_preloadFile;Module["FS_unlink"]=FS_unlink;Module["FS_createPath"]=FS_createPath;Module["FS_createDevice"]=FS_createDevice;Module["FS"]=FS;Module["FS_createDataFile"]=FS_createDataFile;Module["FS_createLazyFile"]=FS_createLazyFile;Module["MEMFS"]=MEMFS;var proxiedFunctionTable=[_proc_exit,exitOnMainThread,pthreadCreateProxied,___syscall_fcntl64,___syscall_fstat64,___syscall_getcwd,___syscall_getdents64,___syscall_ioctl,___syscall_lstat64,___syscall_newfstatat,___syscall_openat,___syscall_stat64,__mmap_js,__munmap_js,_environ_get,_environ_sizes_get,_fd_close,_fd_read,_fd_seek,_fd_write];function __asyncjs__js_file_read(path_ptr,offset,req_size,out_ptr){return Asyncify.handleAsync(async()=>await _wllama_js_file_read(UTF8ToString(Number(path_ptr)),Number(offset),Number(req_size),Number(out_ptr)))}__asyncjs__js_file_read.sig="jjjjj";var _wllama_malloc,_wllama_start,_wllama_action,_wllama_exit,_wllama_debug,_main,_malloc,_free,_emwgpuCreateBindGroup,_emwgpuCreateBindGroupLayout,_emwgpuCreateCommandBuffer,_emwgpuCreateCommandEncoder,_emwgpuCreateComputePassEncoder,_emwgpuCreateComputePipeline,_emwgpuCreateExternalTexture,_emwgpuCreatePipelineLayout,_emwgpuCreateQuerySet,_emwgpuCreateRenderBundle,_emwgpuCreateRenderBundleEncoder,_emwgpuCreateRenderPassEncoder,_emwgpuCreateRenderPipeline,_emwgpuCreateSampler,_emwgpuCreateSurface,_emwgpuCreateTexture,_emwgpuCreateTextureView,_emwgpuCreateAdapter,_emwgpuCreateBuffer,_emwgpuCreateDevice,_emwgpuCreateQueue,_emwgpuCreateShaderModule,_emwgpuOnDeviceLostCompleted,_emwgpuOnMapAsyncCompleted,_emwgpuOnRequestAdapterCompleted,_emwgpuOnRequestDeviceCompleted,_emwgpuOnWorkDoneCompleted,_emwgpuOnUncapturedError,__emscripten_tls_init,_pthread_self,_emscripten_builtin_memalign,__emscripten_thread_init,__emscripten_thread_crashed,__emscripten_run_js_on_main_thread,__emscripten_thread_free_data,__emscripten_thread_exit,__emscripten_check_mailbox,_memalign,___trap,_emscripten_stack_set_limits,__emscripten_stack_restore,__emscripten_stack_alloc,_emscripten_stack_get_current,__indirect_function_table,wasmTable;function assignWasmExports(wasmExports){_wllama_malloc=Module["_wllama_malloc"]=wasmExports["wllama_malloc"];_wllama_start=Module["_wllama_start"]=wasmExports["wllama_start"];_wllama_action=Module["_wllama_action"]=wasmExports["wllama_action"];_wllama_exit=Module["_wllama_exit"]=wasmExports["wllama_exit"];_wllama_debug=Module["_wllama_debug"]=wasmExports["wllama_debug"];_main=Module["_main"]=wasmExports["main"];_malloc=wasmExports["malloc"];_free=wasmExports["free"];_emwgpuCreateBindGroup=wasmExports["emwgpuCreateBindGroup"];_emwgpuCreateBindGroupLayout=wasmExports["emwgpuCreateBindGroupLayout"];_emwgpuCreateCommandBuffer=wasmExports["emwgpuCreateCommandBuffer"];_emwgpuCreateCommandEncoder=wasmExports["emwgpuCreateCommandEncoder"];_emwgpuCreateComputePassEncoder=wasmExports["emwgpuCreateComputePassEncoder"];_emwgpuCreateComputePipeline=wasmExports["emwgpuCreateComputePipeline"];_emwgpuCreateExternalTexture=wasmExports["emwgpuCreateExternalTexture"];_emwgpuCreatePipelineLayout=wasmExports["emwgpuCreatePipelineLayout"];_emwgpuCreateQuerySet=wasmExports["emwgpuCreateQuerySet"];_emwgpuCreateRenderBundle=wasmExports["emwgpuCreateRenderBundle"];_emwgpuCreateRenderBundleEncoder=wasmExports["emwgpuCreateRenderBundleEncoder"];_emwgpuCreateRenderPassEncoder=wasmExports["emwgpuCreateRenderPassEncoder"];_emwgpuCreateRenderPipeline=wasmExports["emwgpuCreateRenderPipeline"];_emwgpuCreateSampler=wasmExports["emwgpuCreateSampler"];_emwgpuCreateSurface=wasmExports["emwgpuCreateSurface"];_emwgpuCreateTexture=wasmExports["emwgpuCreateTexture"];_emwgpuCreateTextureView=wasmExports["emwgpuCreateTextureView"];_emwgpuCreateAdapter=wasmExports["emwgpuCreateAdapter"];_emwgpuCreateBuffer=wasmExports["emwgpuCreateBuffer"];_emwgpuCreateDevice=wasmExports["emwgpuCreateDevice"];_emwgpuCreateQueue=wasmExports["emwgpuCreateQueue"];_emwgpuCreateShaderModule=wasmExports["emwgpuCreateShaderModule"];_emwgpuOnDeviceLostCompleted=wasmExports["emwgpuOnDeviceLostCompleted"];_emwgpuOnMapAsyncCompleted=wasmExports["emwgpuOnMapAsyncCompleted"];_emwgpuOnRequestAdapterCompleted=wasmExports["emwgpuOnRequestAdapterCompleted"];_emwgpuOnRequestDeviceCompleted=wasmExports["emwgpuOnRequestDeviceCompleted"];_emwgpuOnWorkDoneCompleted=wasmExports["emwgpuOnWorkDoneCompleted"];_emwgpuOnUncapturedError=wasmExports["emwgpuOnUncapturedError"];__emscripten_tls_init=wasmExports["_emscripten_tls_init"];_pthread_self=wasmExports["pthread_self"];_emscripten_builtin_memalign=wasmExports["emscripten_builtin_memalign"];__emscripten_thread_init=wasmExports["_emscripten_thread_init"];__emscripten_thread_crashed=wasmExports["_emscripten_thread_crashed"];__emscripten_run_js_on_main_thread=wasmExports["_emscripten_run_js_on_main_thread"];__emscripten_thread_free_data=wasmExports["_emscripten_thread_free_data"];__emscripten_thread_exit=wasmExports["_emscripten_thread_exit"];__emscripten_check_mailbox=wasmExports["_emscripten_check_mailbox"];_memalign=wasmExports["memalign"];___trap=wasmExports["__trap"];_emscripten_stack_set_limits=wasmExports["emscripten_stack_set_limits"];__emscripten_stack_restore=wasmExports["_emscripten_stack_restore"];__emscripten_stack_alloc=wasmExports["_emscripten_stack_alloc"];_emscripten_stack_get_current=wasmExports["emscripten_stack_get_current"];__indirect_function_table=wasmTable=wasmExports["__indirect_function_table"]}var wasmImports;function assignWasmImports(){wasmImports={__asyncjs__js_file_read,__pthread_create_js:___pthread_create_js,__syscall_fcntl64:___syscall_fcntl64,__syscall_getcwd:___syscall_getcwd,__syscall_getdents64:___syscall_getdents64,__syscall_ioctl:___syscall_ioctl,__syscall_openat:___syscall_openat,__syscall_stat64:___syscall_stat64,_abort_js:__abort_js,_emscripten_init_main_thread_js:__emscripten_init_main_thread_js,_emscripten_notify_mailbox_postmessage:__emscripten_notify_mailbox_postmessage,_emscripten_receive_on_main_thread_js:__emscripten_receive_on_main_thread_js,_emscripten_thread_cleanup:__emscripten_thread_cleanup,_emscripten_thread_mailbox_await:__emscripten_thread_mailbox_await,_emscripten_thread_set_strongref:__emscripten_thread_set_strongref,_localtime_js:__localtime_js,_mmap_js:__mmap_js,_munmap_js:__munmap_js,_tzset_js:__tzset_js,clock_time_get:_clock_time_get,emscripten_check_blocking_allowed:_emscripten_check_blocking_allowed,emscripten_date_now:_emscripten_date_now,emscripten_exit_with_live_runtime:_emscripten_exit_with_live_runtime,emscripten_get_callstack:_emscripten_get_callstack,emscripten_get_heap_max:_emscripten_get_heap_max,emscripten_get_now:_emscripten_get_now,emscripten_has_asyncify:_emscripten_has_asyncify,emscripten_num_logical_cores:_emscripten_num_logical_cores,emscripten_resize_heap:_emscripten_resize_heap,emwgpuAdapterRequestDevice:_emwgpuAdapterRequestDevice,emwgpuBufferDestroy:_emwgpuBufferDestroy,emwgpuBufferGetConstMappedRange:_emwgpuBufferGetConstMappedRange,emwgpuBufferMapAsync:_emwgpuBufferMapAsync,emwgpuBufferUnmap:_emwgpuBufferUnmap,emwgpuDelete:_emwgpuDelete,emwgpuDeviceCreateBuffer:_emwgpuDeviceCreateBuffer,emwgpuDeviceCreateShaderModule:_emwgpuDeviceCreateShaderModule,emwgpuDeviceDestroy:_emwgpuDeviceDestroy,emwgpuInstanceRequestAdapter:_emwgpuInstanceRequestAdapter,emwgpuQueueOnSubmittedWorkDone:_emwgpuQueueOnSubmittedWorkDone,emwgpuWaitAny:_emwgpuWaitAny,environ_get:_environ_get,environ_sizes_get:_environ_sizes_get,exit:_exit,fd_close:_fd_close,fd_read:_fd_read,fd_seek:_fd_seek,fd_write:_fd_write,memory:wasmMemory,random_get:_random_get,wgpuAdapterGetInfo:_wgpuAdapterGetInfo,wgpuAdapterGetLimits:_wgpuAdapterGetLimits,wgpuAdapterHasFeature:_wgpuAdapterHasFeature,wgpuBufferGetSize:_wgpuBufferGetSize,wgpuCommandEncoderBeginComputePass:_wgpuCommandEncoderBeginComputePass,wgpuCommandEncoderCopyBufferToBuffer:_wgpuCommandEncoderCopyBufferToBuffer,wgpuCommandEncoderFinish:_wgpuCommandEncoderFinish,wgpuComputePassEncoderDispatchWorkgroups:_wgpuComputePassEncoderDispatchWorkgroups,wgpuComputePassEncoderEnd:_wgpuComputePassEncoderEnd,wgpuComputePassEncoderSetBindGroup:_wgpuComputePassEncoderSetBindGroup,wgpuComputePassEncoderSetPipeline:_wgpuComputePassEncoderSetPipeline,wgpuComputePipelineGetBindGroupLayout:_wgpuComputePipelineGetBindGroupLayout,wgpuDeviceCreateBindGroup:_wgpuDeviceCreateBindGroup,wgpuDeviceCreateCommandEncoder:_wgpuDeviceCreateCommandEncoder,wgpuDeviceCreateComputePipeline:_wgpuDeviceCreateComputePipeline,wgpuInstanceHasWGSLLanguageFeature:_wgpuInstanceHasWGSLLanguageFeature,wgpuQueueSubmit:_wgpuQueueSubmit,wgpuQueueWriteBuffer:_wgpuQueueWriteBuffer}}function applySignatureConversions(wasmExports){wasmExports=Object.assign({},wasmExports);var makeWrapper___PP=f=>(a0,a1,a2)=>f(a0,BigInt(a1?a1:0),BigInt(a2?a2:0));var makeWrapper_pp=f=>a0=>Number(f(BigInt(a0)));var makeWrapper__p=f=>a0=>f(BigInt(a0));var makeWrapper_p=f=>()=>Number(f());var makeWrapper_ppp=f=>(a0,a1)=>Number(f(BigInt(a0),BigInt(a1)));var makeWrapper__p_____=f=>(a0,a1,a2,a3,a4,a5)=>f(BigInt(a0),a1,a2,a3,a4,a5);var makeWrapper___p_p_=f=>(a0,a1,a2,a3,a4)=>f(a0,BigInt(a1),a2,BigInt(a3),a4);var makeWrapper__pp=f=>(a0,a1)=>f(BigInt(a0),BigInt(a1));wasmExports["main"]=makeWrapper___PP(wasmExports["main"]);wasmExports["malloc"]=makeWrapper_pp(wasmExports["malloc"]);wasmExports["free"]=makeWrapper__p(wasmExports["free"]);wasmExports["pthread_self"]=makeWrapper_p(wasmExports["pthread_self"]);wasmExports["emscripten_builtin_memalign"]=makeWrapper_ppp(wasmExports["emscripten_builtin_memalign"]);wasmExports["_emscripten_thread_init"]=makeWrapper__p_____(wasmExports["_emscripten_thread_init"]);wasmExports["_emscripten_run_js_on_main_thread"]=makeWrapper___p_p_(wasmExports["_emscripten_run_js_on_main_thread"]);wasmExports["_emscripten_thread_free_data"]=makeWrapper__p(wasmExports["_emscripten_thread_free_data"]);wasmExports["_emscripten_thread_exit"]=makeWrapper__p(wasmExports["_emscripten_thread_exit"]);wasmExports["memalign"]=makeWrapper_ppp(wasmExports["memalign"]);wasmExports["emscripten_stack_set_limits"]=makeWrapper__pp(wasmExports["emscripten_stack_set_limits"]);wasmExports["_emscripten_stack_restore"]=makeWrapper__p(wasmExports["_emscripten_stack_restore"]);wasmExports["_emscripten_stack_alloc"]=makeWrapper_pp(wasmExports["_emscripten_stack_alloc"]);wasmExports["emscripten_stack_get_current"]=makeWrapper_p(wasmExports["emscripten_stack_get_current"]);return wasmExports}async function callMain(){var entryFunction=_main;var argc=0;var argv=0;try{var ret=entryFunction(argc,BigInt(argv));ret=await ret;exitJS(ret,true);return ret}catch(e){return handleException(e)}}function run(){if(runDependencies>0){dependenciesFulfilled=run;return}if(ENVIRONMENT_IS_PTHREAD){initRuntime();return}preRun();if(runDependencies>0){dependenciesFulfilled=run;return}async function doRun(){Module["calledRun"]=true;if(ABORT)return;initRuntime();preMain();Module["onRuntimeInitialized"]?.();var noInitialRun=Module["noInitialRun"]||false;if(!noInitialRun)await callMain();postRun()}if(Module["setStatus"]){Module["setStatus"]("Running...");setTimeout(()=>{setTimeout(()=>Module["setStatus"](""),1);doRun()},1)}else{doRun()}}var wasmExports;if(!ENVIRONMENT_IS_PTHREAD){createWasm();run()}\n';

// src/worker.ts
var FILE_READ_REQ_EVENT = "fs.read_req";
var JSPI_STUB = `
if (!WebAssembly.Suspending) {
  // JSPI not available - stubs that keep the import/export tables valid.
  // Suspending wraps imports: identity is fine since async imports won't be called.
  WebAssembly.Suspending = function (fn) {
    // console.log(fn.toString());
    return fn;
  };
  // promising wraps exports: must return a Promise so ccall's ret.then() works.
  WebAssembly.promising = function (fn) {
    return function (...args) {
      try {
        return Promise.resolve(fn(...args));
      } catch (e) {
        return Promise.reject(e);
      }
    };
  };
}
`;
var ProxyToWorker = class {
  // filename -> Blob for async reads
  constructor(resources, nbThread, suppressNativeLog, logger) {
    __publicField(this, "resources");
    __publicField(this, "logger");
    __publicField(this, "suppressNativeLog");
    __publicField(this, "taskQueue", []);
    __publicField(this, "taskId", 1);
    __publicField(this, "resultQueue", []);
    __publicField(this, "busy", false);
    // is the work loop is running?
    __publicField(this, "worker");
    __publicField(this, "multiThread");
    __publicField(this, "nbThread");
    __publicField(this, "useAsyncFile");
    __publicField(this, "fileBlobs", /* @__PURE__ */ new Map());
    this.resources = resources;
    this.nbThread = nbThread;
    this.multiThread = nbThread > 0;
    this.logger = logger;
    this.suppressNativeLog = suppressNativeLog;
    this.useAsyncFile = canUseAsyncFileRead(resources.compat);
  }
  getModuleCode() {
    return __async(this, null, function* () {
      if (!this.resources.jsPath) {
        if (this.resources.compat) {
          throw new Error(
            "compat mode is enabled but no jsPath was provided. Pass a worker JS via setCompat() or install @wllama/wllama-compat."
          );
        }
        return WLLAMA_EMSCRIPTEN_CODE;
      } else if (this.resources.jsPath.code) {
        return this.resources.jsPath.code;
      } else if (isString(this.resources.jsPath)) {
        const response = yield fetch(this.resources.jsPath);
        if (!response.ok) {
          throw new Error(
            `Failed to fetch worker code from ${this.resources.jsPath}`
          );
        }
        return yield response.text();
      } else {
        throw new Error("No JS code provided for worker");
      }
    });
  }
  moduleInit(ggufFiles) {
    return __async(this, null, function* () {
      let moduleCode = JSPI_STUB + (yield this.getModuleCode());
      if (this.resources.noWebGPU) {
        moduleCode = 'try{Object.defineProperty(WorkerNavigator.prototype,"gpu",{get:()=>({requestAdapter:async()=>null})});}catch(e){}' + moduleCode;
      }
      let mainModuleCode = moduleCode.replace("var Module", "var ___Module");
      const runOptions = {
        pathConfig: {
          "wllama.wasm": this.resources.wasmPath
        },
        nbThread: this.nbThread,
        compat: this.resources.compat
      };
      const completeCode = [
        `const RUN_OPTIONS = ${JSON.stringify(runOptions)};`,
        `function wModuleInit() { ${mainModuleCode}; return Module; }`,
        LLAMA_CPP_WORKER_CODE
      ].join(";\n\n");
      this.worker = createWorker(completeCode);
      this.worker.onmessage = this.onRecvMsg.bind(this);
      this.worker.onerror = this.logger.error;
      const res = yield this.pushTask({
        verb: "module.init",
        args: [
          new Blob([moduleCode], { type: "text/javascript" }),
          this.useAsyncFile
        ],
        callbackId: this.taskId++
      });
      const nativeFiles = [];
      for (const file of ggufFiles) {
        const needAllocBuffer = !this.useAsyncFile;
        const id = yield this.fileAlloc(
          file.name,
          file.blob.size,
          needAllocBuffer
        );
        nativeFiles.push(__spreadValues({ id }, file));
        if (this.useAsyncFile) {
          this.fileBlobs.set(file.name, file.blob);
        }
      }
      if (!this.useAsyncFile) {
        yield Promise.all(
          nativeFiles.map((file) => {
            return this.fileWrite(file.id, file.blob);
          })
        );
      }
      return res;
    });
  }
  wllamaStart() {
    return __async(this, null, function* () {
      const result = yield this.pushTask({
        verb: "wllama.start",
        args: [],
        callbackId: this.taskId++
      });
      const parsedResult = this.parseResult(result);
      return parsedResult;
    });
  }
  wllamaAction(name, body) {
    return __async(this, null, function* () {
      const encodedMsg = glueSerialize(body);
      const result = yield this.pushTask({
        verb: "wllama.action",
        args: [name, encodedMsg],
        callbackId: this.taskId++
      });
      const parsedResult = glueDeserialize(result);
      return parsedResult;
    });
  }
  wllamaExit() {
    return __async(this, null, function* () {
      if (this.worker) {
        this.worker.terminate();
      }
    });
  }
  wllamaDebug() {
    return __async(this, null, function* () {
      const result = yield this.pushTask({
        verb: "wllama.debug",
        args: [],
        callbackId: this.taskId++
      });
      return JSON.parse(result);
    });
  }
  ///////////////////////////////////////
  /**
   * Allocate a new file in heapfs
   * @returns fileId, to be used by fileWrite()
   */
  fileAlloc(fileName, size, allocBuffer) {
    return __async(this, null, function* () {
      const result = yield this.pushTask({
        verb: "fs.alloc",
        args: [fileName, size, allocBuffer],
        callbackId: this.taskId++
      });
      return result.fileId;
    });
  }
  /**
   * Write a Blob to heapfs
   */
  fileWrite(fileId, blob) {
    return __async(this, null, function* () {
      const reader = blob.stream().getReader();
      let offset = 0;
      while (true) {
        const { done, value } = yield reader.read();
        if (done) break;
        const size = value.byteLength;
        yield this.pushTask(
          {
            verb: "fs.write",
            args: [fileId, value, offset],
            callbackId: this.taskId++
          },
          // @ts-ignore Type 'ArrayBufferLike' is not assignable to type 'ArrayBuffer'
          [value.buffer]
        );
        offset += size;
      }
    });
  }
  fileReadResponse(name, offset, size) {
    return __async(this, null, function* () {
      var _a;
      try {
        const blob = this.fileBlobs.get(name);
        if (!blob) {
          throw new Error(`blob not found for name="${name}"`);
        }
        const chunk = blob.slice(offset, offset + size);
        const buffer = yield chunk.arrayBuffer();
        this.worker.postMessage(
          { verb: "fs.read_res", args: [buffer] },
          { transfer: [buffer] }
        );
      } catch (err) {
        this.logger.error("fileReadResponse failed, terminating worker:", err);
        (_a = this.worker) == null ? void 0 : _a.terminate();
        this.worker = void 0;
        this.abort(`File read failed: ${err}`, err.stack || "");
      }
    });
  }
  /**
   * Parse JSON result returned by cpp code.
   * Throw new Error if "__exception" is present in the response
   *
   * TODO: get rid of this function once everything is migrated to Glue
   */
  parseResult(result) {
    const parsedResult = JSON.parse(result);
    if (parsedResult && parsedResult["error"]) {
      throw new WllamaRuntimeError("Unknown error, please see console.log", "");
    }
    return parsedResult;
  }
  /**
   * Push a new task to taskQueue
   */
  pushTask(param, buffers) {
    return new Promise((resolve, reject) => {
      this.taskQueue.push({ resolve, reject, param, buffers });
      this.runTaskLoop();
    });
  }
  /**
   * Main loop for processing tasks
   */
  runTaskLoop() {
    return __async(this, null, function* () {
      var _a;
      if (this.busy) {
        return;
      }
      this.busy = true;
      while (true) {
        const task = this.taskQueue.shift();
        if (!task) break;
        this.resultQueue.push(task);
        this.worker.postMessage(
          task.param,
          isSafariMobile() ? void 0 : {
            transfer: (_a = task.buffers) != null ? _a : []
          }
        );
      }
      this.busy = false;
    });
  }
  /**
   * Handle messages from worker
   */
  onRecvMsg(e) {
    if (!e.data) return;
    const { verb, args } = e.data;
    const isCompatBuild = this.resources.compat;
    if (verb && verb.startsWith("console.")) {
      if (this.suppressNativeLog) {
        return;
      }
      if (verb.endsWith("debug")) this.logger.debug(...args);
      if (verb.endsWith("log")) this.logger.log(...args);
      if (verb.endsWith("warn")) this.logger.warn(...args);
      if (verb.endsWith("error")) this.logger.error(...args);
      return;
    } else if (verb === "signal.abort") {
      const [signalType, message, rawStack, originalErr] = args;
      if (originalErr) {
        this.logger.error(originalErr);
      }
      (() => __async(this, null, function* () {
        let stack = "";
        let newMsg = message.replace(
          "Build with -sASSERTIONS for more info.",
          ""
        );
        if (signalType === "abort") {
          newMsg = `(ABORT) ${newMsg}`;
          stack = rawStack.replace(/\|/g, "\n");
        } else if (signalType === "exception") {
          stack = rawStack;
        }
        const decoded = yield Debug.decodeStackTrace(stack, isCompatBuild);
        this.logger.error(`Stack trace (${signalType}):
` + decoded);
        this.abort(newMsg, decoded);
      }))();
      return;
    }
    if (verb === FILE_READ_REQ_EVENT) {
      const [name, offset, size] = args;
      this.fileReadResponse(name, offset, size).catch(() => {
      });
      return;
    }
    const { callbackId, result, err } = e.data;
    if (callbackId) {
      const idx = this.resultQueue.findIndex(
        (t) => t.param.callbackId === callbackId
      );
      if (idx !== -1) {
        const waitingTask = this.resultQueue.splice(idx, 1)[0];
        if (err) waitingTask.reject(err);
        else waitingTask.resolve(result);
      } else {
        this.logger.error(
          `Cannot find waiting task with callbackId = ${callbackId}`
        );
      }
    }
  }
  abort(text, stack) {
    const error = new WllamaRuntimeError(
      text.length == 0 ? "(unknown error)" : text,
      stack
    );
    while (this.resultQueue.length > 0) {
      const waitingTask = this.resultQueue.pop();
      if (!waitingTask) break;
      waitingTask.reject(error);
    }
    while (this.taskQueue.length > 0) {
      const pendingTask = this.taskQueue.pop();
      if (!pendingTask) break;
      pendingTask.reject(error);
    }
  }
};

// src/huggingface.ts
var HF_BASE = "https://huggingface.co";
var DEFAULT_QUANTS = ["Q4_K_M", "Q8_0"];
function fetchRepoFiles(repo, token) {
  return __async(this, null, function* () {
    var _a;
    const url = `${HF_BASE}/api/models/${repo}/tree/main?recursive=true`;
    const headers = { Accept: "application/json" };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    const res = yield fetch(url, { headers });
    if (!res.ok) {
      let msg = res.statusText;
      try {
        msg = (_a = (yield res.json()).error) != null ? _a : msg;
      } catch (e) {
      }
      throw new Error(`HF API error (${res.status}): ${msg}`);
    }
    return res.json();
  });
}
function firstShardPath(files, path) {
  const m = path.match(/^(.+)-(\d{5})-of-(\d{5})\.gguf$/i);
  if (!m) return path;
  const first = `${m[1]}-00001-of-${m[3]}.gguf`;
  return files.some((f) => f.path === first) ? first : path;
}
function selectFile(files, quant, mmprojOnly) {
  const candidates = files.filter((f) => {
    if (f.type !== "file" || !f.path.toLowerCase().endsWith(".gguf"))
      return false;
    const ismmproj = f.path.toLowerCase().includes("mmproj");
    return mmprojOnly ? ismmproj : !ismmproj;
  });
  if (candidates.length === 0) return null;
  if (quant) {
    const upper = quant.toUpperCase();
    const match = candidates.find((f) => f.path.toUpperCase().includes(upper));
    if (match) return firstShardPath(candidates, match.path);
    return null;
  }
  for (const q of DEFAULT_QUANTS) {
    const match = candidates.find((f) => f.path.toUpperCase().includes(q));
    if (match) return firstShardPath(candidates, match.path);
  }
  return firstShardPath(candidates, candidates[0].path);
}
function getHFModelSource(config) {
  return __async(this, null, function* () {
    const { repo, file, quant, mmprojFile, mmprojQuant, hfToken } = config;
    const files = yield fetchRepoFiles(repo, hfToken);
    const modelPath = file != null ? file : selectFile(files, quant, false);
    if (!modelPath) {
      throw new Error(`No GGUF file found in repo "${repo}"`);
    }
    const source = {
      url: `${HF_BASE}/${repo}/resolve/main/${modelPath}`
    };
    if (mmprojFile || mmprojQuant !== void 0) {
      const mmpath = mmprojFile != null ? mmprojFile : selectFile(files, mmprojQuant, true);
      if (mmpath) {
        source.mmprojUrl = `${HF_BASE}/${repo}/resolve/main/${mmpath}`;
      }
    }
    if (hfToken) {
      const params = new URLSearchParams({ token: hfToken });
      source.url += `?${params}`;
      if (source.mmprojUrl) {
        source.mmprojUrl += `?${params}`;
      }
    }
    return source;
  });
}
function getHFFileSHA256(url, headers) {
  return __async(this, null, function* () {
    if (!url.includes("/resolve/")) return void 0;
    const rawUrl = url.replace("/resolve/", "/raw/");
    try {
      const text = yield fetch(rawUrl, { headers }).then((r) => r.text());
      const match = text.match(/^oid sha256:([0-9a-f]{64})$/m);
      return match ? match[1] : void 0;
    } catch (e) {
      return void 0;
    }
  });
}

// src/storage/opfs.ts
var OPFSBackend = class {
  isSupported() {
    var _a;
    return typeof navigator !== "undefined" && "storage" in navigator && !!((_a = navigator.storage) == null ? void 0 : _a.getDirectory);
  }
  read(key) {
    return __async(this, null, function* () {
      try {
        const cacheDir = yield getCacheDir();
        const fileHandle = yield cacheDir.getFileHandle(key);
        return yield fileHandle.getFile();
      } catch (e) {
        return null;
      }
    });
  }
  write(key, stream) {
    return __async(this, null, function* () {
      const writable = yield openWritable(key);
      yield writable.truncate(0);
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = yield reader.read();
          if (done) break;
          yield writable.write(value);
        }
      } finally {
        yield writable.close();
      }
    });
  }
  getSize(key) {
    return __async(this, null, function* () {
      try {
        const cacheDir = yield getCacheDir();
        const fileHandle = yield cacheDir.getFileHandle(key);
        const file = yield fileHandle.getFile();
        return file.size;
      } catch (e) {
        return -1;
      }
    });
  }
  list() {
    return __async(this, null, function* () {
      const cacheDir = yield getCacheDir();
      const result = [];
      try {
        for (var iter = __forAwait(cacheDir.entries()), more, temp, error; more = !(temp = yield iter.next()).done; more = false) {
          const [name, handle] = temp.value;
          if (handle.kind === "file") {
            const file = yield handle.getFile();
            result.push({ key: name, size: file.size });
          }
        }
      } catch (temp) {
        error = [temp];
      } finally {
        try {
          more && (temp = iter.return) && (yield temp.call(iter));
        } finally {
          if (error)
            throw error[0];
        }
      }
      return result;
    });
  }
  delete(key) {
    return __async(this, null, function* () {
      try {
        const cacheDir = yield getCacheDir();
        yield cacheDir.removeEntry(key);
      } catch (e) {
        if ((e == null ? void 0 : e.name) !== "NotFoundError") throw e;
      }
    });
  }
};
function getCacheDir() {
  return __async(this, null, function* () {
    const opfsRoot = yield navigator.storage.getDirectory();
    return opfsRoot.getDirectoryHandle("cache", { create: true });
  });
}
function openWritable(fileName) {
  return __async(this, null, function* () {
    const worker = createWorker(OPFS_UTILS_WORKER_CODE);
    let pResolve;
    let pReject;
    worker.onmessage = (e) => {
      if (e.data.ok) pResolve(null);
      else if (e.data.err) pReject(e.data.err);
    };
    worker.onerror = (e) => {
      var _a;
      return pReject == null ? void 0 : pReject((_a = e.message) != null ? _a : e);
    };
    const workerExec = (data) => new Promise((resolve, reject) => {
      pResolve = resolve;
      pReject = reject;
      worker.postMessage(
        data,
        isSafariMobile() ? void 0 : { transfer: "buf" in data && data.buf ? [data.buf.buffer] : [] }
      );
    });
    yield workerExec({ action: "open", filename: fileName });
    return {
      truncate: () => __async(this, null, function* () {
      }),
      write: (value) => workerExec({ action: "write", buf: value }),
      close: () => __async(this, null, function* () {
        yield workerExec({ action: "close" });
        worker.terminate();
      })
    };
  });
}

// src/storage/cos.ts
function makeHash(key) {
  return { algorithm: "SHA-256", value: key };
}
var COSInternalBackend = class {
  isSupported() {
    return typeof navigator !== "undefined" && "crossOriginStorage" in navigator;
  }
  // IMPORTANT: key must be SHA-256 hash of the data
  read(key) {
    return __async(this, null, function* () {
      try {
        const handle = yield navigator.crossOriginStorage.requestFileHandle(
          makeHash(key)
        );
        return handle.getFile();
      } catch (e) {
        return null;
      }
    });
  }
  // IMPORTANT: key must be SHA-256 hash of the data
  write(key, stream) {
    return __async(this, null, function* () {
      const handle = yield navigator.crossOriginStorage.requestFileHandle(
        makeHash(key),
        { create: true }
      );
      const writable = yield handle.createWritable();
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = yield reader.read();
          if (done) break;
          yield writable.write(value);
        }
      } finally {
        yield writable.close();
      }
    });
  }
  // IMPORTANT: key must be SHA-256 hash of the data
  getSize(key) {
    return __async(this, null, function* () {
      try {
        const handle = yield navigator.crossOriginStorage.requestFileHandle(
          makeHash(key)
        );
        const file = yield handle.getFile();
        return file.size;
      } catch (e) {
        return -1;
      }
    });
  }
  list() {
    return __async(this, null, function* () {
      throw new Error("not implemented");
    });
  }
  delete(_key) {
    return __async(this, null, function* () {
      throw new Error("not implemented");
    });
  }
};
var COSBackend = class {
  constructor() {
    __publicField(this, "cos", new COSInternalBackend());
    __publicField(this, "priv", new OPFSBackend());
  }
  isSupported() {
    return this.priv.isSupported();
  }
  read(key, hint) {
    return __async(this, null, function* () {
      if ((hint == null ? void 0 : hint.sha256) && this.cos.isSupported()) {
        const blob = yield this.cos.read(hint.sha256);
        if (blob) return blob;
      }
      return this.priv.read(key);
    });
  }
  write(key, stream, hint) {
    return __async(this, null, function* () {
      if ((hint == null ? void 0 : hint.sha256) && this.cos.isSupported()) {
        yield this.cos.write(hint.sha256, stream);
      } else {
        yield this.priv.write(key, stream);
      }
    });
  }
  getSize(key, hint) {
    return __async(this, null, function* () {
      if ((hint == null ? void 0 : hint.sha256) && this.cos.isSupported()) {
        const size = yield this.cos.getSize(hint.sha256);
        if (size !== -1) return size;
      }
      return this.priv.getSize(key);
    });
  }
  list() {
    return __async(this, null, function* () {
      return this.priv.list();
    });
  }
  delete(key) {
    return __async(this, null, function* () {
      return this.priv.delete(key);
    });
  }
};

// src/cache-manager.ts
var PREFIX_METADATA = "__metadata__";
var POLYFILL_ETAG = "polyfill_for_older_version";
function hintFromMetadata(metadata) {
  if (!metadata) return void 0;
  if (metadata.sha256) return { sha256: metadata.sha256 };
  return void 0;
}
var CacheManager = class {
  /**
   * @param backends Array of storage backends to use, in order of preference ; if first is available, use it, otherwise try the next one.
   */
  constructor(backends = [new COSBackend()]) {
    __publicField(this, "sb");
    for (const backend of backends) {
      if (backend.isSupported()) {
        this.sb = backend;
        return;
      }
    }
    throw new Error("No supported storage backend found");
  }
  /**
   * Convert a given URL into a storage key.
   *
   * Format: `${hashSHA1(fullURL)}_${fileName}`
   */
  getNameFromURL(url) {
    return __async(this, null, function* () {
      return urlToFileName(url, "");
    });
  }
  /**
   * @deprecated Use `download()` instead
   *
   * Write a new file to cache. This will overwrite existing file.
   *
   * @param name The file name returned by `getNameFromURL()` or `list()`
   */
  write(name, stream, metadata) {
    return __async(this, null, function* () {
      yield this.sb.write(name, stream);
      yield this.writeMetadata(name, metadata);
    });
  }
  download(_0) {
    return __async(this, arguments, function* (url, options = {}) {
      var _a, _b, _c, _d;
      const fileKey = yield urlToFileName(url, "");
      const sha256 = yield getHFFileSHA256(url, (_a = options.headers) != null ? _a : {});
      const hint = sha256 ? { sha256 } : void 0;
      const cachedSize = yield this.sb.getSize(fileKey, hint);
      if (cachedSize !== -1) {
        const metadata2 = yield this.readMetadata(fileKey);
        if ((metadata2 == null ? void 0 : metadata2.originalURL) === url && metadata2.originalSize === cachedSize) {
          return;
        }
        const head = yield fetch(url, __spreadValues({
          method: "HEAD"
        }, options.headers ? { headers: options.headers } : {}));
        const originalSize = parseInt(
          (_b = head.headers.get("content-length")) != null ? _b : "0",
          10
        );
        const etag2 = (head.headers.get("etag") || "").replace(
          /[^A-Za-z0-9]/g,
          ""
        );
        if (originalSize > 0 && originalSize === cachedSize) {
          yield this.writeMetadata(fileKey, __spreadValues({
            originalURL: url,
            originalSize,
            etag: etag2,
            sha256
          }, (_c = options.metadataAdditional) != null ? _c : {}));
          return;
        }
        yield this.sb.delete(fileKey);
        yield this.sb.delete(`${PREFIX_METADATA}${fileKey}`);
      }
      const response = yield fetch(url, __spreadValues(__spreadValues({}, options.headers ? { headers: options.headers } : {}), options.signal ? { signal: options.signal } : {}));
      if (!response.ok || !response.body) {
        throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
      }
      const contentLength = response.headers.get("content-length");
      const etag = (response.headers.get("etag") || "").replace(
        /[^A-Za-z0-9]/g,
        ""
      );
      const total = parseInt(contentLength != null ? contentLength : "0", 10);
      const progressCallback = options.progressCallback;
      let loaded = 0;
      let lastProgressAt = 0;
      const progressStream = new TransformStream({
        transform(chunk, controller) {
          loaded += chunk.byteLength;
          if (progressCallback) {
            const now = Date.now();
            if (now - lastProgressAt > 100) {
              lastProgressAt = now;
              progressCallback({ loaded, total });
            }
          }
          controller.enqueue(chunk);
        },
        flush() {
          progressCallback == null ? void 0 : progressCallback({ loaded, total: total || loaded });
        }
      });
      const metadata = __spreadValues({
        originalURL: url,
        originalSize: total,
        etag
      }, (_d = options.metadataAdditional) != null ? _d : {});
      if (sha256) {
        metadata.sha256 = sha256;
      }
      yield this.sb.write(
        fileKey,
        response.body.pipeThrough(progressStream),
        hint
      );
      yield this.writeMetadata(fileKey, metadata);
    });
  }
  /**
   * Open a file in cache for reading
   *
   * @param nameOrURL The file name returned by `getNameFromURL()` or `list()`, or the original URL of the remote file
   * @returns Blob, or null if file does not exist
   */
  open(nameOrURL) {
    return __async(this, null, function* () {
      const hint1 = hintFromMetadata(yield this.getMetadata(nameOrURL));
      const direct = yield this.sb.read(nameOrURL, hint1);
      if (direct) return direct;
      const key = yield urlToFileName(nameOrURL, "");
      const hint2 = hintFromMetadata(yield this.getMetadata(key));
      return this.sb.read(key, hint2);
    });
  }
  /**
   * Get the size of a file in stored cache
   *
   * NOTE: in case the download is stopped mid-way (i.e. user close browser tab), the file maybe corrupted, size maybe different from `metadata.originalSize`
   *
   * @param name The file name returned by `getNameFromURL()` or `list()`
   * @returns number of bytes, or -1 if file does not exist
   */
  getSize(name) {
    return __async(this, null, function* () {
      const hint = hintFromMetadata(yield this.getMetadata(name));
      return this.sb.getSize(name, hint);
    });
  }
  /**
   * Get metadata of a cached file
   */
  getMetadata(name) {
    return __async(this, null, function* () {
      const metadata = yield this.readMetadata(name);
      if (metadata) return metadata;
      const cachedSize = yield this.sb.getSize(name);
      return cachedSize > 0 ? (
        // files created by older version of wllama don't have metadata; polyfill it
        {
          etag: POLYFILL_ETAG,
          originalSize: cachedSize,
          originalURL: ""
        }
      ) : (
        // cached file not found
        null
      );
    });
  }
  /**
   * Same as `getMetadata()`, but without polyfill. Returns null if the file has no metadata.
   */
  readMetadata(name) {
    return __async(this, null, function* () {
      const blob = yield this.sb.read(`${PREFIX_METADATA}${name}`);
      if (!blob) return null;
      try {
        return yield new Response(blob).json();
      } catch (e) {
        return null;
      }
    });
  }
  /**
   * List all files currently in cache
   */
  list() {
    return __async(this, null, function* () {
      const all = yield this.sb.list();
      const metadataMap = {};
      for (const { key } of all) {
        if (key.startsWith(PREFIX_METADATA)) {
          const blob = yield this.sb.read(key);
          if (blob) {
            const meta = yield new Response(blob).json().catch(() => null);
            metadataMap[key.slice(PREFIX_METADATA.length)] = meta;
          }
        }
      }
      const result = [];
      for (const { key, size } of all) {
        if (!key.startsWith(PREFIX_METADATA)) {
          result.push({
            name: key,
            size,
            metadata: metadataMap[key] || {
              originalSize: size,
              originalURL: "",
              etag: ""
            }
          });
        }
      }
      return result;
    });
  }
  /**
   * Clear all files currently in cache
   */
  clear() {
    return __async(this, null, function* () {
      yield this.deleteMany(() => true);
    });
  }
  /**
   * Delete a single file in cache
   *
   * @param nameOrURL Can be either an URL or a name returned by `getNameFromURL()` or `list()`
   */
  delete(nameOrURL) {
    return __async(this, null, function* () {
      const name2 = yield this.getNameFromURL(nameOrURL);
      yield this.deleteMany(
        (entry) => entry.name === nameOrURL || entry.name === name2
      );
    });
  }
  /**
   * Delete multiple files in cache.
   *
   * @param predicate A predicate like `array.filter(item => boolean)`
   */
  deleteMany(predicate) {
    return __async(this, null, function* () {
      const list = yield this.list();
      for (const item of list) {
        if (predicate(item)) {
          yield this.sb.delete(item.name);
          yield this.sb.delete(`${PREFIX_METADATA}${item.name}`);
        }
      }
    });
  }
  /**
   * Write the metadata of the file to disk.
   */
  writeMetadata(name, metadata) {
    return __async(this, null, function* () {
      const blob = new Blob([JSON.stringify(metadata)], { type: "text/plain" });
      yield this.sb.write(`${PREFIX_METADATA}${name}`, blob.stream());
    });
  }
};
var cache_manager_default = CacheManager;
function urlToFileName(url, prefix) {
  return __async(this, null, function* () {
    const hashBuffer = yield crypto.subtle.digest(
      "SHA-1",
      new TextEncoder().encode(url)
    );
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${prefix}${hashHex}_${url.split("/").pop()}`;
  });
}

// src/model-manager.ts
var DEFAULT_PARALLEL_DOWNLOADS = 3;
var ModelValidationStatus = /* @__PURE__ */ ((ModelValidationStatus2) => {
  ModelValidationStatus2["VALID"] = "valid";
  ModelValidationStatus2["INVALID"] = "invalid";
  ModelValidationStatus2["DELETED"] = "deleted";
  return ModelValidationStatus2;
})(ModelValidationStatus || {});
var Model = class {
  constructor(modelManager, url, mmprojUrl, savedFiles) {
    __publicField(this, "modelManager");
    /**
     * URL to the GGUF file (in case it contains multiple shards, the URL should point to the first shard)
     *
     * This URL will be used to identify the model in the cache. There can't be 2 models with the same URL.
     */
    __publicField(this, "url");
    /**
     * URL to mmproj file, if exists
     */
    __publicField(this, "mmprojUrl");
    /**
     * Size in bytes (total size of all shards).
     *
     * A value of -1 means the model is deleted from the cache. You must call `ModelManager.downloadModel` to re-download the model.
     */
    __publicField(this, "size");
    /**
     * List of all shards in the cache, sorted by original URL (ascending order)
     */
    __publicField(this, "files");
    this.modelManager = modelManager;
    this.url = url;
    this.mmprojUrl = mmprojUrl;
    if (savedFiles) {
      this.files = this.getAllFiles(savedFiles);
      this.size = sumArr(this.files.map((f) => f.metadata.originalSize));
    } else {
      this.files = [];
      this.size = 0;
    }
  }
  /**
   * Open and get a list of all shards as Blobs
   */
  open() {
    return __async(this, null, function* () {
      if (this.size === -1) {
        throw new WllamaError(
          `Model is deleted from the cache; Call ModelManager.downloadModel to re-download the model`,
          "load_error"
        );
      }
      const blobs = [];
      for (const file of this.files) {
        const blob = yield this.modelManager.cacheManager.open(file.name);
        if (!blob) {
          throw new Error(
            `Failed to open file ${file.name}; Hint: the model may be invalid, please refresh it`
          );
        }
        blobs.push(blob);
      }
      return blobs;
    });
  }
  /**
   * Validate the model files.
   *
   * If the model is invalid, the model manager will not be able to use it. You must call `refresh` to re-download the model.
   *
   * Cases that model is invalid:
   * - The model is deleted from the cache
   * - The model files are missing (or the download is interrupted)
   */
  validate() {
    let nbShards = ModelManager.parseModelUrl(this.url).length;
    if (this.mmprojUrl) {
      nbShards += 1;
    }
    if (this.size === -1) {
      return "deleted" /* DELETED */;
    }
    if (this.size < 16 || this.files.length !== nbShards) {
      return "invalid" /* INVALID */;
    }
    for (const file of this.files) {
      if (!file.metadata || file.metadata.originalSize !== file.size) {
        return "invalid" /* INVALID */;
      }
    }
    return "valid" /* VALID */;
  }
  /**
   * In case the model is invalid, call this function to re-download the model
   */
  refresh() {
    return __async(this, arguments, function* (options = {}) {
      var _a;
      const urls = ModelManager.parseModelUrl(this.url);
      if (this.mmprojUrl) {
        urls.push(this.mmprojUrl);
      }
      const works = urls.map((url, index) => ({
        url,
        index
      }));
      this.modelManager.logger.debug("Downloading model files:", urls);
      const nParallel = (_a = this.modelManager.params.parallelDownloads) != null ? _a : DEFAULT_PARALLEL_DOWNLOADS;
      const totalSize = yield this.getTotalDownloadSize(urls);
      const loadedSize = [];
      const worker = () => __async(this, null, function* () {
        while (works.length > 0) {
          const w = works.shift();
          if (!w) break;
          yield this.modelManager.cacheManager.download(w.url, __spreadProps(__spreadValues({}, options), {
            metadataAdditional: {
              originalURL: w.url,
              mmprojURL: this.mmprojUrl
            },
            progressCallback: ({ loaded }) => {
              var _a2;
              loadedSize[w.index] = loaded;
              (_a2 = options.progressCallback) == null ? void 0 : _a2.call(options, {
                loaded: sumArr(loadedSize),
                total: totalSize
              });
            }
          }));
        }
      });
      const promises = [];
      for (let i = 0; i < nParallel; i++) {
        promises.push(worker());
        loadedSize.push(0);
      }
      yield Promise.all(promises);
      this.files = this.getAllFiles(yield this.modelManager.cacheManager.list());
      this.size = this.files.reduce((acc, f) => acc + f.metadata.originalSize, 0);
    });
  }
  /**
   * Remove the model from the cache
   */
  remove() {
    return __async(this, null, function* () {
      this.files = this.getAllFiles(yield this.modelManager.cacheManager.list());
      yield this.modelManager.cacheManager.deleteMany(
        (f) => !!this.files.find((file) => file.name === f.name)
      );
      this.size = -1;
    });
  }
  getAllFiles(savedFiles) {
    const allUrls = new Set(ModelManager.parseModelUrl(this.url));
    if (this.mmprojUrl) {
      allUrls.add(this.mmprojUrl);
    }
    const allFiles = [];
    for (const url of allUrls) {
      const file = savedFiles.find((f) => f.metadata.originalURL === url);
      if (!file) {
        throw new Error(`Model file not found: ${url}`);
      }
      allFiles.push(file);
    }
    allFiles.sort(
      (a, b) => a.metadata.originalURL.localeCompare(b.metadata.originalURL)
    );
    return allFiles;
  }
  getTotalDownloadSize(urls) {
    return __async(this, null, function* () {
      const responses = yield Promise.all(
        urls.map((url) => fetch(url, { method: "HEAD" }))
      );
      const sizes = responses.map(
        (res) => Number(res.headers.get("content-length") || "0")
      );
      return sumArr(sizes);
    });
  }
};
var ModelManager = class _ModelManager {
  constructor(params = {}) {
    // The CacheManager singleton, can be accessed by user
    __publicField(this, "cacheManager");
    __publicField(this, "params");
    __publicField(this, "logger");
    this.cacheManager = params.cacheManager || new cache_manager_default();
    this.params = params;
    this.logger = params.logger || console;
  }
  /**
   * Parses a model URL and returns an array of URLs based on the following patterns:
   * - If the input URL is an array, it returns the array itself.
   * - If the input URL is a string in the `gguf-split` format, it returns an array containing the URL of each shard in ascending order.
   * - Otherwise, it returns an array containing the input URL as a single element array.
   * @param modelUrl URL or list of URLs
   */
  static parseModelUrl(modelUrl) {
    var _a;
    if (Array.isArray(modelUrl)) {
      return modelUrl;
    }
    const urlPartsRegex = /-(\d{5})-of-(\d{5})\.gguf(?:\?.*)?$/;
    const queryMatch = modelUrl.match(/\.gguf(\?.*)?$/);
    const queryParams = (_a = queryMatch == null ? void 0 : queryMatch[1]) != null ? _a : "";
    const matches = modelUrl.match(urlPartsRegex);
    if (!matches) {
      return [modelUrl];
    }
    const baseURL = modelUrl.replace(urlPartsRegex, "");
    const total = matches[2];
    const paddedShardIds = Array.from(
      { length: Number(total) },
      (_, index) => (index + 1).toString().padStart(5, "0")
    );
    return paddedShardIds.map(
      (current) => `${baseURL}-${current}-of-${total}.gguf${queryParams}`
    );
  }
  /**
   * Get all models in the cache
   */
  getModels() {
    return __async(this, arguments, function* (opts = {}) {
      const cachedFiles = yield this.cacheManager.list();
      let models = [];
      for (const file of cachedFiles) {
        if (!file.metadata.originalURL) continue;
        const shards = _ModelManager.parseModelUrl(file.metadata.originalURL);
        const mmprojUrl = file.metadata.mmprojURL;
        const isFirstShard = shards.length === 1 || shards[0] === file.metadata.originalURL;
        if (isFirstShard) {
          models.push(
            new Model(this, file.metadata.originalURL, mmprojUrl, cachedFiles)
          );
        }
      }
      if (!opts.includeInvalid) {
        models = models.filter(
          (m) => m.validate() === "valid" /* VALID */
        );
      }
      return models;
    });
  }
  /**
   * Download a model from the given URL.
   *
   * The URL must end with `.gguf`
   */
  downloadModel(_0) {
    return __async(this, arguments, function* (sourceOrURL, options = {}) {
      const source = isString(sourceOrURL) ? { url: sourceOrURL } : sourceOrURL;
      if (!isValidGgufFile(source.url)) {
        throw new WllamaError(
          `Invalid model URL: ${source.url}; URL must ends with ".gguf"`,
          "download_error"
        );
      }
      const model = new Model(this, source.url, source.mmprojUrl);
      const validity = model.validate();
      if (validity !== "valid" /* VALID */) {
        yield model.refresh(options);
      }
      return model;
    });
  }
  /**
   * Get a model from the cache or download it if it's not available.
   */
  getModelOrDownload(_0) {
    return __async(this, arguments, function* (source, options = {}) {
      var _a;
      const models = yield this.getModels();
      const model = models.find((m) => m.url === source.url);
      if (model) {
        (_a = options.progressCallback) == null ? void 0 : _a.call(options, { loaded: model.size, total: model.size });
        return model;
      }
      return this.downloadModel(source, options);
    });
  }
  /**
   * Remove all models from the cache
   */
  clear() {
    return __async(this, null, function* () {
      yield this.cacheManager.clear();
    });
  }
};

// src/types/types.ts
var LogLevel = /* @__PURE__ */ ((LogLevel2) => {
  LogLevel2[LogLevel2["DEBUG"] = 1] = "DEBUG";
  LogLevel2[LogLevel2["INFO"] = 2] = "INFO";
  LogLevel2[LogLevel2["WARN"] = 3] = "WARN";
  LogLevel2[LogLevel2["ERROR"] = 4] = "ERROR";
  return LogLevel2;
})(LogLevel || {});

// src/wasm-from-cdn.ts
var WasmCompatFromCDN = {
  worker: new URL("./compat/wllama.js", import.meta.url).href,
  wasm: new URL("./compat/wllama.wasm", import.meta.url).href
};

// src/wllama.ts
var LoggerWithoutDebug = __spreadProps(__spreadValues({}, console), {
  debug: () => {
  }
});
var WllamaError = class extends Error {
  constructor(message, type = "unknown_error") {
    super(message);
    __publicField(this, "type");
    this.type = type;
  }
};
var WllamaAbortError = class extends Error {
  constructor() {
    super("Operation aborted");
    __publicField(this, "name", "AbortError");
  }
};
var WllamaRuntimeError = class extends Error {
  constructor(message, stack) {
    super(message);
    __publicField(this, "name", "RuntimeError");
    __publicField(this, "stack");
    this.stack = stack;
  }
};
var Wllama = class {
  constructor(pathConfig, wllamaConfig = {}) {
    // The CacheManager and ModelManager are singleton, can be accessed by user
    __publicField(this, "cacheManager");
    __publicField(this, "modelManager");
    __publicField(this, "compat", null);
    __publicField(this, "proxy", null);
    __publicField(this, "config");
    __publicField(this, "pathConfig");
    __publicField(this, "useMultiThread", false);
    __publicField(this, "nbThreads", 1);
    __publicField(this, "useEmbeddings", false);
    __publicField(this, "useRerank", false);
    // available when loaded
    __publicField(this, "loadedContextInfo", null);
    __publicField(this, "seed");
    __publicField(this, "bosToken", -1);
    __publicField(this, "eosToken", -1);
    __publicField(this, "eotToken", -1);
    __publicField(this, "eogTokens", /* @__PURE__ */ new Set());
    __publicField(this, "addBosToken", false);
    __publicField(this, "addEosToken", false);
    __publicField(this, "mediaMarker");
    __publicField(this, "chatTemplate");
    __publicField(this, "metadata");
    __publicField(this, "hasEncoder", false);
    __publicField(this, "decoderStartToken", -1);
    // note: we overlay instead of using llama-server default_template_kwargs, because we cannot transfer complex data structure via GLUE
    // overlay allow mixed data type or nested structure for kwargs
    __publicField(this, "chatTemplateKwargs", {});
    var _a, _b, _c;
    checkEnvironmentCompatible();
    if (!pathConfig) throw new WllamaError("AssetsPathConfig is required");
    this.pathConfig = pathConfig;
    this.config = wllamaConfig;
    this.cacheManager = (_a = wllamaConfig.cacheManager) != null ? _a : new cache_manager_default();
    this.modelManager = (_c = wllamaConfig.modelManager) != null ? _c : new ModelManager({
      cacheManager: this.cacheManager,
      logger: (_b = wllamaConfig.logger) != null ? _b : console,
      parallelDownloads: wllamaConfig.parallelDownloads,
      allowOffline: wllamaConfig.allowOffline
    });
    this.setCompat("default");
  }
  logger() {
    var _a;
    return (_a = this.config.logger) != null ? _a : console;
  }
  checkModelLoaded() {
    if (!this.isModelLoaded()) {
      throw new WllamaError(
        "loadModel() is not yet called",
        "model_not_loaded"
      );
    }
  }
  /**
   * Get the libllama version string, e.g. "b6327-4d74393".
   *
   * @returns version string embedded at build time.
   */
  static getLibllamaVersion() {
    return LIBLLAMA_VERSION;
  }
  /**
   * Set compatibility options for Wllama.
   * @param compat Set to null to disable compatibility, or 'default' to use the default compat resources from CDN.
   * @param mode 'safari' by default; If set to 'firefox_safari', the compat mode will **also** be enabled on Firefox, which will significantly degrade the performance but allow using WebGPU on Firefox.
   */
  setCompat(compat, mode = "safari") {
    if (mode === "safari") {
      if (isFirefox()) {
        this.compat = null;
        return;
      }
    }
    this.compat = compat === "default" ? WasmCompatFromCDN : compat;
  }
  /**
   * Check if the model is loaded via `loadModel()`
   */
  isModelLoaded() {
    return !!this.proxy && !!this.metadata;
  }
  /**
   * Get token ID associated to BOS (begin of sentence) token.
   *
   * NOTE: This can only being used after `loadModel` is called.
   *
   * @returns -1 if the model is not loaded.
   */
  getBOS() {
    return this.bosToken;
  }
  /**
   * Get token ID associated to EOS (end of sentence) token.
   *
   * NOTE: This can only being used after `loadModel` is called.
   *
   * @returns -1 if the model is not loaded.
   */
  getEOS() {
    return this.eosToken;
  }
  /**
   * Get token ID associated to EOT (end of turn) token.
   *
   * NOTE: This can only being used after `loadModel` is called.
   *
   * @returns -1 if the model is not loaded.
   */
  getEOT() {
    return this.eotToken;
  }
  /**
   * Check if a given token is end-of-generation token (e.g. EOS, EOT, etc.)
   *
   * @param token the token ID to be checked
   * @returns true if the token is EOS, EOT, or any other end-of-generation tokens
   */
  isTokenEOG(token) {
    return token === this.eosToken || token === this.eotToken || this.eogTokens.has(token);
  }
  /**
   * Get token ID associated to token used by decoder, to start generating output sequence(only usable for encoder-decoder architecture). In other words, encoder uses normal BOS and decoder uses this token.
   *
   * NOTE: This can only being used after `loadModel` is called.
   *
   * @returns -1 if the model is not loaded.
   */
  getDecoderStartToken() {
    return this.decoderStartToken;
  }
  /**
   * Get model hyper-parameters and metadata
   *
   * NOTE: This can only being used after `loadModel` is called.
   *
   * @returns ModelMetadata
   */
  getModelMetadata() {
    this.checkModelLoaded();
    return this.metadata;
  }
  /**
   * Check if we're currently using multi-thread build.
   *
   * NOTE: This can only being used after `loadModel` is called.
   *
   * @returns true if multi-thread is used.
   */
  isMultithread() {
    this.checkModelLoaded();
    return this.useMultiThread;
  }
  /**
   * Get number of threads used in the current context.
   *
   * NOTE: This can only being used after `loadModel` is called.
   *
   * @returns number of threads
   */
  getNumThreads() {
    this.checkModelLoaded();
    return this.useMultiThread ? this.nbThreads : 1;
  }
  /**
   * Check if the current model uses encoder-decoder architecture
   *
   * NOTE: This can only being used after `loadModel` is called.
   *
   * @returns true if multi-thread is used.
   */
  isEncoderDecoderArchitecture() {
    this.checkModelLoaded();
    return this.hasEncoder;
  }
  /**
   * Must we add BOS token to the tokenized sequence?
   *
   * NOTE: This can only being used after `loadModel` is called.
   *
   * @returns true if BOS token must be added to the sequence
   */
  mustAddBosToken() {
    this.checkModelLoaded();
    return this.addBosToken;
  }
  /**
   * Must we add EOS token to the tokenized sequence?
   *
   * NOTE: This can only being used after `loadModel` is called.
   *
   * @returns true if EOS token must be added to the sequence
   */
  mustAddEosToken() {
    this.checkModelLoaded();
    return this.addEosToken;
  }
  /**
   * Get the jinja chat template comes with the model. It only available if the original model (before converting to gguf) has the template in `tokenizer_config.json`
   *
   * NOTE: This can only being used after `loadModel` is called.
   *
   * @returns the jinja template. null if there is no template in gguf
   */
  getChatTemplate() {
    var _a;
    this.checkModelLoaded();
    return (_a = this.chatTemplate) != null ? _a : null;
  }
  /**
   * Check if WebGPU is supported by the current environment.
   * @returns true if WebGPU is supported
   */
  isSupportWebGPU() {
    return isSupportWebGPU();
  }
  /**
   * Load model from a given URL (or a list of URLs, in case the model is splitted into smaller files)
   * - If the model already been downloaded (via `downloadModel()`), then we will use the cached model
   * - Else, we download the model from internet
   * @param modelSourceOrURL
   * @param params
   */
  loadModelFromUrl(_0) {
    return __async(this, arguments, function* (modelSourceOrURL, params = {}) {
      var _a;
      const source = isString(modelSourceOrURL) ? { url: modelSourceOrURL } : modelSourceOrURL;
      const useCache = (_a = params.useCache) != null ? _a : true;
      const model = useCache ? yield this.modelManager.getModelOrDownload(source, params) : yield this.modelManager.downloadModel(source, params);
      const blobs = yield model.open();
      return yield this.loadModel(blobs, params);
    });
  }
  /**
   * Load model from a given Hugging Face model ID and file path.
   *
   * @param hfOptions
   * @param params
   */
  loadModelFromHF(_0) {
    return __async(this, arguments, function* (hfOptions, params = {}) {
      const source = yield getHFModelSource(hfOptions);
      return yield this.loadModelFromUrl(source, params);
    });
  }
  /**
   * Load model from a given list of Blob.
   *
   * You can pass multiple buffers into the function (in case the model contains multiple shards).
   *
   * @param ggufBlobsOrModel Can be either list of Blobs (in case you use local file), or a Model object (in case you use ModelManager)
   * @param params LoadModelParams
   */
  loadModel(_0) {
    return __async(this, arguments, function* (ggufBlobsOrModel, params = {}) {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j;
      const blobs = ggufBlobsOrModel instanceof Model ? yield ggufBlobsOrModel.open() : [...ggufBlobsOrModel];
      if (blobs.some((b) => b.size === 0)) {
        throw new WllamaError(
          "Input model (or splits) must be non-empty Blob or File",
          "load_error"
        );
      }
      if (!this.pathConfig["default"]) {
        throw new WllamaError(
          '"default" is missing from pathConfig',
          "load_error"
        );
      }
      if (this.proxy) {
        throw new WllamaError("Module is already initialized", "load_error");
      }
      const supportMultiThread = yield isSupportMultiThread();
      const hwConccurency = Math.floor((navigator.hardwareConcurrency || 1) / 2);
      const nbThreads = (_a = params.n_threads) != null ? _a : hwConccurency;
      this.nbThreads = nbThreads;
      this.useMultiThread = supportMultiThread && nbThreads > 1;
      const workerResources = this.getWorkerResources();
      if (params.n_gpu_layers === 0) {
        workerResources.noWebGPU = true;
      }
      this.proxy = new ProxyToWorker(
        workerResources,
        this.useMultiThread ? nbThreads : 0,
        // 0 means disable pthread
        (_b = this.config.suppressNativeLog) != null ? _b : false,
        this.logger()
      );
      let logLevel = (_c = params.log_level) != null ? _c : 2 /* INFO */;
      if (this.config.suppressNativeLog) {
        logLevel = 9999;
      }
      const modelFiles = yield prepareBlobs(blobs);
      yield this.proxy.moduleInit(modelFiles.all);
      this.logger().debug("Calling wllamaStart...");
      const startResult = yield this.proxy.wllamaStart();
      if (!startResult.success) {
        throw new WllamaError(
          `Error while calling start function, result = ${startResult}`
        );
      }
      this.logger().debug("Loading model...");
      const loadResult = yield this.proxy.wllamaAction("load", {
        _name: "load_req",
        log_level: logLevel,
        // if async read is not supported, use mmap; refer to README-dev.md for more details
        use_mmap: !canUseAsyncFileRead(workerResources.compat),
        use_mlock: false,
        n_gpu_layers: (_d = params.n_gpu_layers) != null ? _d : 99999,
        n_ctx: (_e = params.n_ctx) != null ? _e : 1024,
        n_threads: this.useMultiThread ? nbThreads : 1,
        n_ctx_auto: false,
        // not supported for now
        mmproj_path: modelFiles.mmproj ? `/models/${MMPROJ_FILE_NAME}` : void 0,
        model_paths: modelFiles.llm.map((f) => `models/${f.name}`),
        embeddings: params.embeddings,
        offload_kqv: params.offload_kqv,
        n_batch: params.n_batch,
        n_ubatch: params.n_ubatch,
        pooling_type: params.pooling_type,
        rope_scaling_type: params.rope_scaling_type,
        rope_freq_base: params.rope_freq_base,
        rope_freq_scale: params.rope_freq_scale,
        yarn_ext_factor: params.yarn_ext_factor,
        yarn_attn_factor: params.yarn_attn_factor,
        yarn_beta_fast: params.yarn_beta_fast,
        yarn_beta_slow: params.yarn_beta_slow,
        yarn_orig_ctx: params.yarn_orig_ctx,
        cache_type_k: params.cache_type_k,
        cache_type_v: params.cache_type_v,
        // with unified KV, all sequences share one n_ctx cache, so each request can still use the full context
        n_parallel: (_f = params.n_parallel) != null ? _f : 4,
        kv_unified: (_g = params.kv_unified) != null ? _g : true,
        flash_attn: params.flash_attn,
        swa_full: params.swa_full,
        chat_template: params.chat_template,
        jinja: params.jinja,
        reasoning: params.reasoning,
        image_min_tokens: params.image_min_tokens,
        image_max_tokens: params.image_max_tokens,
        warmup: params.warmup,
        no_kv_offload: params.no_kv_offload,
        mmproj_offload: params.mmproj_offload,
        cont_batching: params.cont_batching,
        n_keep: params.n_keep,
        ctx_shift: params.ctx_shift,
        cache_idle_slots: params.cache_idle_slots,
        n_cache_reuse: params.n_cache_reuse,
        lora_paths: (_h = params.lora_adapters) == null ? void 0 : _h.map((a) => a.path),
        lora_scales: (_i = params.lora_adapters) == null ? void 0 : _i.map((a) => {
          var _a2;
          return (_a2 = a.scale) != null ? _a2 : 1;
        }),
        lora_init_without_apply: params.lora_init_without_apply,
        spec_draft_model: params.spec_draft_model,
        spec_draft_ngl: params.spec_draft_ngl,
        spec_draft_n_max: params.spec_draft_n_max,
        spec_draft_n_min: params.spec_draft_n_min,
        spec_draft_p_min: params.spec_draft_p_min,
        spec_draft_threads: params.spec_draft_threads,
        spec_draft_threads_batch: params.spec_draft_threads_batch,
        kv_overrides_keys: params.kv_overrides ? Object.keys(params.kv_overrides) : void 0,
        kv_overrides_vals: params.kv_overrides ? Object.values(params.kv_overrides) : void 0,
        reasoning_budget_tokens: params.reasoning_budget_tokens,
        reasoning_budget_message: params.reasoning_budget_message,
        reasoning_format: params.reasoning_format,
        skip_chat_parsing: params.skip_chat_parsing,
        prefill_assistant: params.prefill_assistant
      });
      const loadedCtxInfo = __spreadProps(__spreadValues({}, loadResult), {
        metadata: {}
      });
      for (let i = 0; i < loadResult.metadata_key.length; i++) {
        loadedCtxInfo.metadata[loadResult.metadata_key[i]] = loadResult.metadata_val[i];
      }
      this.seed = params.seed;
      this.bosToken = loadedCtxInfo.token_bos;
      this.eosToken = loadedCtxInfo.token_eos;
      this.eotToken = loadedCtxInfo.token_eot;
      this.useEmbeddings = !!params.embeddings;
      this.useRerank = params.pooling_type == "rank";
      this.metadata = {
        hparams: {
          nVocab: loadedCtxInfo.n_vocab,
          nCtxTrain: loadedCtxInfo.n_ctx_train,
          nEmbd: loadedCtxInfo.n_embd,
          nLayer: loadedCtxInfo.n_layer
        },
        meta: loadedCtxInfo.metadata
      };
      this.hasEncoder = !!loadedCtxInfo.has_encoder;
      this.decoderStartToken = loadedCtxInfo.token_decoder_start;
      this.addBosToken = loadedCtxInfo.add_bos_token;
      this.addEosToken = loadedCtxInfo.add_eos_token;
      this.chatTemplate = loadedCtxInfo.metadata["tokenizer.chat_template"];
      this.loadedContextInfo = loadedCtxInfo;
      this.eogTokens = new Set(loadedCtxInfo.list_tokens_eog);
      this.mediaMarker = loadedCtxInfo.media_marker;
      this.chatTemplateKwargs = (_j = params.default_template_kwargs) != null ? _j : {};
      this.logger().debug({ loadedCtxInfo });
    });
  }
  getLoadedContextInfo() {
    this.checkModelLoaded();
    if (!this.loadedContextInfo) {
      throw new WllamaError("Loaded context info is not available");
    }
    return __spreadValues({}, this.loadedContextInfo);
  }
  //////////////////////////////////////////////
  // High level API
  /**
   * Calculate embedding vector for a given text.
   * By default, BOS and EOS tokens will be added automatically. You can use the "skipBOS" and "skipEOS" option to disable it.
   * @param options OAI-compatible embedding creation options
   * @returns OAI-compatible embedding response
   */
  createEmbedding(options) {
    return __async(this, null, function* () {
      this.checkModelLoaded();
      if (!this.useEmbeddings) {
        throw new WllamaError(
          "Embeddings is not enabled. Please set it via LoadModelParams.embeddings"
        );
      }
      const result = yield this.proxy.wllamaAction(
        "embedding",
        {
          _name: "embd_req",
          data_json: JSON.stringify(options),
          files: []
          // TODO: support file input
        }
      );
      if (!result.success) {
        throw new WllamaError(
          "Model failed to start inference",
          "inference_error"
        );
      }
      return yield this.getResponse(options, false, result.req_id);
    });
  }
  /**
   * Rerank a list of documents against a query.
   * Requires the model to be loaded with embeddings: true and pooling_type: 'rank'.
   * @param options Reranking options (query, documents, top_n)
   * @returns Reranking response with relevance scores sorted highest first
   */
  createRerank(options) {
    return __async(this, null, function* () {
      var _a, _b;
      this.checkModelLoaded();
      if (!this.useEmbeddings || !this.useRerank) {
        throw new WllamaError(
          "Rerank is not enabled. Please set it via LoadModelParams: embeddings = true and pooling_type = rank"
        );
      }
      const top_n = (_a = options.top_n) != null ? _a : options.documents.length;
      let totalTokens = 0;
      const rawResults = [];
      for (let i = 0; i < options.documents.length; i++) {
        const result = yield this.proxy.wllamaAction("rerank", {
          _name: "rrnk_req",
          data_json: JSON.stringify({
            query: options.query,
            document: options.documents[i]
          })
        });
        if (!result.success) {
          throw new WllamaError(
            "Model failed to start reranking",
            "inference_error"
          );
        }
        const { score, tokens_evaluated } = yield this.getSingleResult(result.req_id, "reranking");
        totalTokens += tokens_evaluated;
        rawResults.push({ index: i, score });
      }
      rawResults.sort((a, b) => b.score - a.score);
      return {
        model: (_b = this.getModelMetadata().meta["general.name"]) != null ? _b : "",
        object: "list",
        usage: { prompt_tokens: totalTokens, total_tokens: totalTokens },
        results: rawResults.slice(0, top_n).map(({ index, score }) => ({
          index,
          relevance_score: score
        }))
      };
    });
  }
  /**
   * Answer typed questions about a state, using a decision model (TypeSafe-compatible System One API).
   * Image input is not supported yet.
   * @param options The state and the questions
   * @returns The answer of each question
   */
  createSystemOne(options) {
    return __async(this, null, function* () {
      this.checkModelLoaded();
      const result = yield this.proxy.wllamaAction(
        "systemone",
        {
          _name: "sys1_req",
          data_json: JSON.stringify(options)
        }
      );
      if (!result.success) {
        throw new WllamaError(
          "Model failed to start systemone",
          "inference_error"
        );
      }
      return yield this.getSingleResult(
        result.req_id,
        "systemone"
      );
    });
  }
  createChatCompletion(options) {
    return __async(this, null, function* () {
      var _a;
      if (Object.keys(this.chatTemplateKwargs).length > 0) {
        options = __spreadProps(__spreadValues({}, options), {
          chat_template_kwargs: __spreadValues(__spreadValues({}, this.chatTemplateKwargs), (_a = options.chat_template_kwargs) != null ? _a : {})
        });
      }
      if (options.stream && options.onData) {
        yield this.createCompletionImpl(options);
      } else if (options.stream) {
        return yield this.createCompletionGenerator(options);
      } else {
        return yield this.createCompletionImpl(__spreadProps(__spreadValues({}, options), { stream: false }));
      }
    });
  }
  createCompletion(options) {
    return __async(this, null, function* () {
      if (options.stream && options.onData) {
        yield this.createCompletionImpl(options);
      } else if (options.stream) {
        return yield this.createCompletionGenerator(options);
      } else {
        return yield this.createCompletionImpl(__spreadProps(__spreadValues({}, options), { stream: false }));
      }
    });
  }
  /**
   * Private implementation of createCompletion
   */
  createCompletionImpl(options) {
    return __async(this, null, function* () {
      this.checkModelLoaded();
      const isStream = !!options.stream;
      const isChat = !!options.messages;
      const customOpt = {};
      if (this.seed !== void 0) {
        customOpt.seed = this.seed;
      }
      let files = [];
      if (isChat) {
        const tmp = this.prepareMultimodalInput(
          options
        );
        options = tmp.params;
        files = tmp.files;
      }
      const result = yield this.proxy.wllamaAction(
        "completion",
        {
          _name: "cmpl_req",
          is_chat: isChat,
          data_json: JSON.stringify(__spreadValues(__spreadValues({}, options), customOpt)),
          files: files.map((f) => new Uint8Array(f))
        }
      );
      if (!result.success) {
        throw new WllamaError(
          "Model failed to start inference",
          "inference_error"
        );
      }
      return yield this.getResponse(
        options,
        isStream,
        result.req_id
      );
    });
  }
  /**
   * Same with `createCompletion`, but returns an async iterator instead.
   * Only called when stream=true and no onData is provided.
   */
  createCompletionGenerator(options) {
    return new Promise((resolve) => {
      const createGenerator = cbToAsyncIter(
        (callback) => {
          this.createCompletionImpl(__spreadProps(__spreadValues({}, options), {
            onData: (chunk) => callback(chunk)
          })).then(() => callback(void 0, true)).catch((err) => callback(void 0, false, err));
        }
      );
      resolve(createGenerator());
    });
  }
  /**
   * Whether the currently loaded model supports a specific input modality (e.g. image or audio).
   * @param modality
   * @returns
   */
  supportInputModality(modality) {
    this.checkModelLoaded();
    if (modality === "image") {
      return !!this.loadedContextInfo.has_image_input;
    } else if (modality === "audio") {
      return !!this.loadedContextInfo.has_audio_input;
    } else {
      throw new WllamaError(
        "Unsupported modality: " + modality,
        "unknown_error"
      );
    }
  }
  /**
   * Unload the model and free all memory.
   *
   * Note: This function will NOT crash if model is not yet loaded
   */
  exit() {
    return __async(this, null, function* () {
      var _a;
      yield (_a = this.proxy) == null ? void 0 : _a.wllamaExit();
      this.proxy = null;
    });
  }
  /**
   * [FOR DEBUGGING ONLY] Run ggml backend ops tests without loading any model.
   *
   * Initializes the wasm runtime, executes `test-backend-ops` with the given args, then shuts down.
   *
   * For more info, please refer to guides/debug.md
   *
   * @param args Arguments forwarded to test-backend-ops (e.g. ["-o", "ADD"])
   * @returns retcode (0 = all tests passed) and success flag
   */
  testBackendOps() {
    return __async(this, arguments, function* (args = []) {
      var _a;
      if (!this.pathConfig["default"]) {
        throw new WllamaError(
          '"default" is missing from pathConfig',
          "load_error"
        );
      }
      if (!(yield isSupportMultiThread())) {
        throw new WllamaError(
          "Multi-threading is required to run backend ops tests, but it is not supported in the current environment."
        );
      }
      const tmpProxy = new ProxyToWorker(
        this.getWorkerResources(),
        0,
        // single-thread; no model needed
        (_a = this.config.suppressNativeLog) != null ? _a : false,
        this.logger()
      );
      try {
        yield tmpProxy.moduleInit([]);
        const startResult = yield tmpProxy.wllamaStart();
        if (!startResult.success) {
          throw new WllamaError(
            `Error while calling start function, result = ${startResult}`
          );
        }
        const result = yield tmpProxy.wllamaAction(
          "test_backend_ops",
          { _name: "tbop_req", args: ["test-backend-ops", ...args] }
        );
        return { retcode: result.retcode, success: result.success };
      } finally {
        yield tmpProxy.wllamaExit();
      }
    });
  }
  //////////////////////////////////////////////
  // Low level API
  // TODO: add back
  /**
   * get debug info
   */
  _getDebugInfo() {
    return __async(this, null, function* () {
      this.checkModelLoaded();
      return yield this.proxy.wllamaDebug();
    });
  }
  //////////////////////////////////////////////
  // Utils
  jsonDecode(data_json) {
    try {
      return JSON.parse(data_json);
    } catch (e) {
      this.logger().error("Failed to parse JSON:", data_json);
      throw new WllamaError("Failed to parse model output", "inference_error");
    }
  }
  prepareMultimodalInput(params) {
    const msg = params.messages;
    const msgNew = [];
    const files = [];
    for (const m of msg) {
      if (Array.isArray(m.content)) {
        const newContent = [];
        for (const c of m.content) {
          if (c.type === "text") {
            newContent.push(c);
          } else {
            if (!this.mediaMarker) {
              throw new WllamaError(
                "Media marker is undefined",
                "inference_error"
              );
            }
            files.push(c.data);
            newContent.push({
              type: "text",
              text: this.mediaMarker
            });
          }
        }
        msgNew.push(__spreadProps(__spreadValues({}, m), {
          content: newContent
        }));
      } else {
        msgNew.push(m);
      }
    }
    return {
      params: __spreadProps(__spreadValues({}, params), {
        messages: msgNew
      }),
      files
    };
  }
  // release the slot occupied by the request; cancelling an already-finished request is a no-op
  cancelRequest(reqId) {
    return __async(this, null, function* () {
      try {
        yield this.proxy.wllamaAction("cancel", {
          _name: "cncl_req",
          req_id: reqId
        });
      } catch (e) {
        this.logger().warn("Failed to cancel request", reqId, e);
      }
    });
  }
  getSingleResult(reqId, task) {
    return __async(this, null, function* () {
      let completed = false;
      try {
        while (true) {
          const chunk = yield this.proxy.wllamaAction(
            "get_result",
            { _name: "gres_req", req_id: reqId }
          );
          const jsonString = chunk.data_json;
          if (jsonString && jsonString.length > 0) {
            if (chunk.is_error) {
              const jsonData = this.jsonDecode(jsonString);
              throw new WllamaError(
                jsonData.message || `Unknown ${task} error`,
                "inference_error"
              );
            }
            completed = true;
            return this.jsonDecode(jsonString);
          }
          if (!chunk.has_more) {
            completed = true;
            break;
          }
        }
        throw new WllamaError(`No ${task} result received`, "inference_error");
      } finally {
        if (!completed) {
          yield this.cancelRequest(reqId);
        }
      }
    });
  }
  getResponse(options, isStream, reqId) {
    return __async(this, null, function* () {
      var _a, _b;
      let finalResult = null;
      let completed = false;
      try {
        while (true) {
          if ((_a = options.abortSignal) == null ? void 0 : _a.aborted) {
            throw new WllamaAbortError();
          }
          const result_chunk = yield this.proxy.wllamaAction(
            "get_result",
            {
              _name: "gres_req",
              req_id: reqId
            }
          );
          const jsonString = result_chunk.data_json;
          if (!jsonString || jsonString.length === 0) {
            if (!result_chunk.has_more) {
              completed = true;
              break;
            } else {
              continue;
            }
          }
          if (jsonString == "null") {
            continue;
          }
          let jsonData = this.jsonDecode(jsonString);
          finalResult = jsonData;
          if (result_chunk.is_error) {
            this.logger().error("Model returned an error:", jsonData);
            throw new WllamaError(
              jsonData.message || "Unknown inference error",
              "inference_error"
            );
          }
          if (isStream) {
            if (!Array.isArray(jsonData)) {
              jsonData = [jsonData];
            }
            for (const chunk of jsonData) {
              (_b = options.onData) == null ? void 0 : _b.call(options, chunk);
              finalResult = chunk;
            }
          }
          if (!result_chunk.has_more) {
            completed = true;
            break;
          }
        }
      } finally {
        if (!completed) {
          yield this.cancelRequest(reqId);
        }
      }
      return finalResult;
    });
  }
  getWorkerResources() {
    const workerResources = {
      wasmPath: absoluteUrl(this.pathConfig["default"]),
      compat: false
    };
    if (needCompat()) {
      if (!this.compat) {
        this.logger().warn(
          "Not using compat mode" + (isFirefox() ? " (expected on Firefox - WebGPU will be disabled)" : "")
        );
      } else {
        const isUsingDefault = this.compat.worker === WasmCompatFromCDN.worker && this.compat.wasm === WasmCompatFromCDN.wasm;
        if (isUsingDefault) {
          this.logger().warn(
            "Compatibility mode is activated, using resources from CDN. To use local resources, please refer to @wllama/wllama-compat package."
          );
          this.logger().warn(
            "IMPORTANT: Performance will be significantly degraded in compatibility mode."
          );
        }
        workerResources.wasmPath = absoluteUrl(this.compat.wasm);
        workerResources.jsPath = this.compat.worker;
        workerResources.compat = true;
      }
    }
    if (isFirefox()) {
      if (workerResources.compat) {
        this.logger().warn(
          'Using compat mode on Firefox, performance will be significantly degraded; Consider enabling "javascript.options.wasm_js_promise_integration" in "about:config".'
        );
      } else if (!isSupportJSPI()) {
        this.logger().warn(
          'WebGPU is disabled on Firefox due to missing JSPI support. Please consider enabling compat mode, or enabling "javascript.options.wasm_js_promise_integration" in "about:config".'
        );
      }
    }
    return workerResources;
  }
};
export {
  CacheManager,
  LogLevel,
  LoggerWithoutDebug,
  Model,
  ModelManager,
  ModelValidationStatus,
  POLYFILL_ETAG,
  Wllama,
  WllamaAbortError,
  WllamaError,
  WllamaRuntimeError,
  getHFFileSHA256,
  getHFModelSource,
  isValidGgufFile
};
