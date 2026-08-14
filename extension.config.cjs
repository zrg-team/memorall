const NodePolyfillPlugin = require("node-polyfill-webpack-plugin");
const { BannerPlugin } = require("@rspack/core");
const path = require("node:path");

// Extension pages cannot execute CommonJS `require` calls. Extension.js 4 is
// permissive by default and externalizes unresolved bare CommonJS imports,
// which can leave runtime calls such as `require("source-map-js")` in MV3
// pages. Make the bundler resolve them (or fail the build) instead.
process.env.EXTENSION_STRICT_REFS ??= "true";

// Stub path for Node.js-only modules that cannot run in a browser context.
// Modules that import child_process, fs, etc. receive an empty object.
const EMPTY_MODULE = path.resolve(__dirname, "src/utils/empty-module.cjs");

const browserCommonJsShim = new BannerPlugin({
	banner:
		'/* MEMORALL_BROWSER_REQUIRE_SHIM */\nvar require = globalThis.__memorallBrowserRequire || (globalThis.__memorallBrowserRequire = function(request) { if (request === "canvas" || request === "source-map-js" || request === "url") return {}; throw new Error("Unsupported browser CommonJS request: " + request); });',
	raw: true,
});

const aliases = {
	"@": path.resolve(__dirname, "src"),
	canvas: false,
	"source-map-js": require.resolve("source-map-js"),
	url: require.resolve("url"),
	// Extension.js 4's TS-first extension aliasing otherwise resolves this
	// package's published index.ts instead of its compiled CommonJS main.
	unicount: path.resolve(__dirname, "src/utils/unicount.cjs"),
	"node:async_hooks": EMPTY_MODULE,
	"node:child_process": EMPTY_MODULE,
	"node:fs": EMPTY_MODULE,
	"node:fs/promises": EMPTY_MODULE,
	"node:path": require.resolve("path-browserify"),
	"node:stream": require.resolve("stream-browserify"),
	"node:process": require.resolve("process/browser"),
	"node:util": require.resolve("util"),
	"node:url": require.resolve("url"),
	"node:events": require.resolve("events"),
	"node:os": require.resolve("os-browserify/browser"),
	"node:crypto": require.resolve("crypto-browserify"),
	"node:buffer": require.resolve("buffer"),
	"node:http": require.resolve("stream-http"),
	"node:https": require.resolve("https-browserify"),
	"node:zlib": require.resolve("browserify-zlib"),
	"node:assert": require.resolve("assert"),
	"node:net": EMPTY_MODULE,
	"node:tls": EMPTY_MODULE,
	"node:vm": require.resolve("vm-browserify"),
};

const fallbacks = {
	canvas: false,
	fs: false,
	path: require.resolve("path-browserify"),
	crypto: require.resolve("crypto-browserify"),
	stream: require.resolve("stream-browserify"),
	buffer: require.resolve("buffer"),
	process: require.resolve("process/browser"),
	util: require.resolve("util"),
	url: require.resolve("url"),
	querystring: require.resolve("querystring-es3"),
	events: require.resolve("events"),
	os: require.resolve("os-browserify/browser"),
	assert: require.resolve("assert"),
	zlib: require.resolve("browserify-zlib"),
	http: require.resolve("stream-http"),
	https: require.resolve("https-browserify"),
	vm: require.resolve("vm-browserify"),
	net: false,
	tls: false,
	child_process: false,
	async_hooks: false,
};

module.exports = {
	commands: {
		dev: {
			chromiumBinary: process.env.CHROME_PATH,
		},
	},
	// Extension.js 4 accepts bundler customization through this hook. Keeping
	// Extension.js' generated values first preserves its internal plugins and
	// aliases while applying Memorall's browser-runtime compatibility layer.
	config: (config) => ({
		...config,
		entry: {
			...config.entry,
			// public/offscreen.html is a copied MV3 document, so Extension.js 4 no
			// longer discovers its TypeScript module as an HTML entry automatically.
			"scripts/offscreen": path.resolve(__dirname, "scripts/offscreen.ts"),
		},
		// The v4 default externalizer can preserve bare CommonJS requires in the
		// emitted page even with strict references enabled. Browser pages have no
		// CommonJS loader, so let Rspack resolve every JavaScript dependency.
		externals: [],
		output: {
			...config.output,
			// Extension pages and lazy chunks are always served from the extension root.
			publicPath: "/",
		},
		resolve: {
			...config.resolve,
			alias: {
				...config.resolve?.alias,
				...aliases,
			},
			fallback: {
				...config.resolve?.fallback,
				...fallbacks,
			},
		},
		plugins: [
			...(config.plugins ?? []),
			// SheetJS and PostCSS contain guarded optional CommonJS requests. Rspack
			// preserves the three false-valued browser remaps below even when normal
			// externals are disabled. Supply the browser-field semantics ({}) before
			// any emitted module executes and reject every unexpected request.
			browserCommonJsShim,
			new NodePolyfillPlugin({ excludeAliases: ["console"] }),
		],
	}),
};
