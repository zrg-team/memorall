const NodePolyfillPlugin = require('node-polyfill-webpack-plugin');
const path = require('path');

// Stub path for Node.js-only modules that cannot run in a browser context.
// Modules that import child_process, fs, etc. will receive an empty object.
const EMPTY_MODULE = path.resolve(__dirname, 'src/utils/empty-module.cjs');

module.exports = {
  output: {
    // Extension pages and lazy chunks are always served from the extension root.
    // Avoid runtime public-path inference from injected browser automation scripts.
    publicPath: '/',
  },
  commands: {
    dev: {
      chromiumBinary: process.env.CHROME_PATH,
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // node: protocol imports - rspack/webpack 5 treats these as separate specifiers
      'node:async_hooks': EMPTY_MODULE,
      'node:child_process': EMPTY_MODULE,
      'node:fs': EMPTY_MODULE,
      'node:fs/promises': EMPTY_MODULE,
      'node:path': require.resolve('path-browserify'),
      'node:stream': require.resolve('stream-browserify'),
      'node:process': require.resolve('process/browser'),
      'node:util': require.resolve('util'),
      'node:url': require.resolve('url'),
      'node:events': require.resolve('events'),
      'node:os': require.resolve('os-browserify/browser'),
      'node:crypto': require.resolve('crypto-browserify'),
      'node:buffer': require.resolve('buffer'),
      'node:http': require.resolve('stream-http'),
      'node:https': require.resolve('https-browserify'),
      'node:zlib': require.resolve('browserify-zlib'),
      'node:assert': require.resolve('assert'),
      'node:net': EMPTY_MODULE,
      'node:tls': EMPTY_MODULE,
      'node:vm': require.resolve('vm-browserify'),
    },
    fallback: {
      "fs": false,
      "path": require.resolve("path-browserify"),
      "crypto": require.resolve("crypto-browserify"),
      "stream": require.resolve("stream-browserify"),
      "buffer": require.resolve("buffer"),
      "process": require.resolve("process/browser"),
      "util": require.resolve("util"),
      "url": require.resolve("url"),
      "querystring": require.resolve("querystring-es3"),
      "events": require.resolve("events"),
      "os": require.resolve("os-browserify/browser"),
      "assert": require.resolve("assert"),
      "zlib": require.resolve("browserify-zlib"),
      "http": require.resolve("stream-http"),
      "https": require.resolve("https-browserify"),
      "vm": require.resolve("vm-browserify"),
      "net": false,
      "tls": false,
      "child_process": false,
      "async_hooks": false
    }
  },
  plugins: [
    new NodePolyfillPlugin({
      excludeAliases: ['console']
    })
  ]
};
