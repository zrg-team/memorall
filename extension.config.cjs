const NodePolyfillPlugin = require('node-polyfill-webpack-plugin');
const path = require('path');

module.exports = {
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
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
