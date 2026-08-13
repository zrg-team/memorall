import {
	WORKSPACES_MOUNT_ROOT,
	vfsBoolState,
	mountedWorkspaceDirectories,
	normalizePath,
	dirname,
	isWorkspacePath,
} from "../core/sandbox-vfs.js";
import {
	FRAMEWORK_TEMPLATES,
	TEMPLATE_INSTALL_SPECS,
} from "../core/sandbox-templates.js";
import {
	ensureContainer,
	ensureServerBridgeReady,
	loadAlmostNodeLib,
	normalizeServerPath,
	pushRuntimeLog,
	rememberInstalledPackages,
	resolveResponseType,
	resolveServerBaseUrl,
	runtimeState,
	stopServerState,
	toServerInfo,
	waitForExpressStartup,
} from "./shared.js";

const unregisterBridgeServer = (bridge, port) => {
	if (bridge && typeof bridge.unregisterServer === "function") {
		bridge.unregisterServer(port);
	}
};

const closeTrackedExpressServer = async (containerInstance, port) => {
	const trackedServer =
		containerInstance?.trackedExpressServers?.get?.(port) ??
		containerInstance?.expressServers?.get?.(port) ??
		containerInstance?.servers?.get?.(port);
	if (!trackedServer || typeof trackedServer.close !== "function") {
		return;
	}
	await new Promise((resolve) => trackedServer.close(resolve));
};

const scaffoldTemplate = (containerInstance, templateName, rootDir) => {
	const files = FRAMEWORK_TEMPLATES[templateName];
	if (!files) {
		throw new Error(`Unknown template: ${templateName}`);
	}
	const root = normalizePath(rootDir || "/");

	if (isWorkspacePath(root) && !vfsBoolState.workspaceMountLoaded) {
		vfsBoolState.workspaceMountLoaded = true;
		mountedWorkspaceDirectories.add(WORKSPACES_MOUNT_ROOT);
	}

	const createdFiles = [];
	for (const [relPath, content] of Object.entries(files)) {
		const rel = relPath.startsWith("/") ? relPath.slice(1) : relPath;
		const fullPath = normalizePath(`${root}/${rel}`);
		try {
			if (containerInstance.vfs.existsSync(fullPath)) continue;
		} catch (error) {
			console.warn("[template] existsSync failed, continuing with write", error);
		}

		const parentDir = dirname(fullPath);
		try {
			containerInstance.vfs.mkdirSync(parentDir, { recursive: true });
		} catch (error) {
			console.warn("[template] mkdirSync failed, continuing", error);
		}

		containerInstance.vfs.writeFileSync(fullPath, content);
		createdFiles.push(fullPath);
	}

	pushRuntimeLog(
		"info",
		`Scaffolded template "${templateName}" into ${root}: ${createdFiles.length} files`,
	);
	return createdFiles;
};

const installTemplatePackages = async (containerInstance, templateName) => {
	const packageSpecs = TEMPLATE_INSTALL_SPECS[templateName];
	if (!Array.isArray(packageSpecs)) return;
	for (const packageSpec of packageSpecs) {
		const installed = await containerInstance.npm.install(packageSpec, {});
		rememberInstalledPackages(installed);
	}
};

const isFolderEmpty = (containerInstance, rootDir) => {
	try {
		const entries = containerInstance.vfs.readdirSync(rootDir);
		return !entries || entries.length === 0;
	} catch {
		return true;
	}
};

const detectServerKind = (containerInstance, rootDir, requestedKind) => {
	let kind = requestedKind === "auto" ? undefined : requestedKind;
	if (kind) {
		return kind;
	}

	const hasFile = (name) => {
		try {
			return containerInstance.vfs.existsSync(normalizePath(`${rootDir}/${name}`));
		} catch {
			return false;
		}
	};

	if (
		hasFile("next.config.js") ||
		hasFile("next.config.ts") ||
		hasFile("next.config.mjs")
	) {
		kind = "next";
	} else if (
		hasFile("vite.config.js") ||
		hasFile("vite.config.ts") ||
		hasFile("vite.config.mjs")
	) {
		kind = "vite";
	} else {
		kind = "express";
	}

	pushRuntimeLog("info", `Auto-detected server kind: ${kind} for ${rootDir}`);
	return kind;
};

const VITE_EXTENSIONLESS_RESOLVE_EXTENSIONS = [
	".jsx",
	".tsx",
	".ts",
	".js",
	".mjs",
	".json",
	".css",
];

const hasPathExtension = (pathname) => {
	const basename = pathname.split("/").pop() || "";
	return basename.lastIndexOf(".") > 0;
};

const isExistingFile = (vfs, path) => {
	try {
		return vfs.existsSync(path) && !vfs.statSync(path).isDirectory();
	} catch {
		return false;
	}
};

const toViteFsPath = (rootDir, pathname) =>
	normalizePath(rootDir === "/" ? pathname : `${rootDir}/${pathname}`);

const resolveViteExtensionlessModulePath = (vfs, rootDir, requestPath) => {
	let url;
	try {
		url = new URL(requestPath, "http://localhost");
	} catch {
		return requestPath;
	}

	const pathname = url.pathname;
	if (pathname === "/" || pathname.endsWith("/") || hasPathExtension(pathname)) {
		return requestPath;
	}

	const fsBasePath = toViteFsPath(rootDir, pathname);
	if (isExistingFile(vfs, fsBasePath)) {
		return requestPath;
	}

	for (const extension of VITE_EXTENSIONLESS_RESOLVE_EXTENSIONS) {
		if (isExistingFile(vfs, `${fsBasePath}${extension}`)) {
			return `${pathname}${extension}${url.search}${url.hash}`;
		}
	}

	for (const extension of VITE_EXTENSIONLESS_RESOLVE_EXTENSIONS) {
		const indexPath = normalizePath(`${fsBasePath}/index${extension}`);
		if (isExistingFile(vfs, indexPath)) {
			return `${pathname}/index${extension}${url.search}${url.hash}`;
		}
	}

	return requestPath;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const decodeBodyText = (body) => {
	if (!body) return "";
	if (typeof body === "string") return body;
	if (body instanceof ArrayBuffer) return textDecoder.decode(body);
	if (ArrayBuffer.isView(body)) return textDecoder.decode(body);
	return String(body);
};

const encodeTextBody = (text) => textEncoder.encode(text);

const createTextResponse = ({
	body,
	contentType,
	statusCode = 200,
	statusMessage = "OK",
	headers = {},
}) => {
	const bytes = encodeTextBody(body);
	return {
		statusCode,
		statusMessage,
		headers: {
			...headers,
			"Content-Type": contentType,
			"Content-Length": String(bytes.length),
			"Cache-Control": "no-cache",
		},
		body: bytes,
	};
};

const createViteTransformErrorResponse = (message) =>
	createTextResponse({
		contentType: "application/javascript; charset=utf-8",
		headers: { "X-Transform-Error": "true" },
		body: `// Transform Error: ${message}\nconsole.error(${JSON.stringify(message)});`,
	});

const createWorkspaceMaterializationMissResponse = (path) =>
	createTextResponse({
		body: `Workspace file not materialized: ${path}`,
		contentType: "text/plain; charset=utf-8",
		statusCode: 404,
		statusMessage: "Not Found",
		headers: { "X-Transform-Error": "true" },
	});

const isViteCssModuleRequest = (headers) => {
	const dest =
		headers?.["sec-fetch-dest"] ??
		headers?.["Sec-Fetch-Dest"] ??
		headers?.["SEC-FETCH-DEST"] ??
		"";
	return dest === "script" || dest === "empty" || dest === "";
};

const hasTailwindProjectConfig = (vfs, rootDir) =>
	[
		"tailwind.config.js",
		"tailwind.config.cjs",
		"tailwind.config.mjs",
		"tailwind.config.ts",
	].some((name) => isExistingFile(vfs, normalizePath(`${rootDir}/${name}`)));

const readTextIfExists = (vfs, path) => {
	try {
		if (!isExistingFile(vfs, path)) return "";
		return decodeBodyText(vfs.readFileSync(path));
	} catch {
		return "";
	}
};

const walkProjectFiles = (vfs, dirPath, extensions, maxFiles = 250) => {
	const files = [];
	const visit = (currentPath) => {
		if (files.length >= maxFiles) return;
		let entries = [];
		try {
			entries = vfs.readdirSync(currentPath);
		} catch {
			return;
		}
		for (const entry of entries) {
			if (files.length >= maxFiles) return;
			if (entry === "node_modules" || entry === ".git" || entry === "dist") {
				continue;
			}
			const fullPath = normalizePath(`${currentPath}/${entry}`);
			try {
				const stat = vfs.statSync(fullPath);
				if (stat.isDirectory()) {
					visit(fullPath);
				} else if (extensions.some((extension) => fullPath.endsWith(extension))) {
					files.push(fullPath);
				}
			} catch {}
		}
	};
	visit(dirPath);
	return files;
};

const collectTailwindClasses = (vfs, rootDir) => {
	const files = walkProjectFiles(vfs, rootDir, [
		".html",
		".js",
		".jsx",
		".ts",
		".tsx",
	]);
	const classes = new Set();
	const tokenPattern = /[A-Za-z0-9_:[\]./%#-]+/g;
	for (const file of files) {
		const content = readTextIfExists(vfs, file);
		for (const match of content.matchAll(tokenPattern)) {
			const token = match[0];
			if (
				token.includes("-") ||
				token.includes(":") ||
				token.includes("[") ||
				[
					"container",
					"flex",
					"grid",
					"hidden",
					"block",
					"inline-flex",
					"items-center",
				].includes(token)
			) {
				classes.add(token);
			}
		}
	}
	return classes;
};

const escapeCssClass = (className) =>
	className.replace(/[^A-Za-z0-9_-]/g, (char) => `\\${char}`);

const colorValue = (name) => {
	const [rawName, opacity] = name.split("/");
	const colors = {
		background: "var(--background)",
		foreground: "var(--foreground)",
		card: "var(--card)",
		"card-foreground": "var(--card-foreground)",
		popover: "var(--popover)",
		"popover-foreground": "var(--popover-foreground)",
		primary: "var(--primary)",
		"primary-foreground": "var(--primary-foreground)",
		secondary: "var(--secondary)",
		"secondary-foreground": "var(--secondary-foreground)",
		muted: "var(--muted)",
		"muted-foreground": "var(--muted-foreground)",
		accent: "var(--accent)",
		"accent-foreground": "var(--accent-foreground)",
		destructive: "var(--destructive)",
		"destructive-foreground": "var(--destructive-foreground)",
		border: "var(--border)",
		input: "var(--input)",
		ring: "var(--ring)",
		transparent: "0 0% 0% / 0",
		white: "0 0% 100%",
		black: "0 0% 0%",
		"slate-50": "210 40% 98%",
		"slate-100": "210 40% 96.1%",
		"slate-200": "214.3 31.8% 91.4%",
		"slate-500": "215.4 16.3% 46.9%",
		"slate-900": "222.2 47.4% 11.2%",
		"gray-50": "210 20% 98%",
		"gray-100": "220 14.3% 95.9%",
		"gray-500": "220 8.9% 46.1%",
		"gray-900": "220.9 39.3% 11%",
		"red-500": "0 84.2% 60.2%",
		"red-600": "0 72.2% 50.6%",
		"orange-500": "24.6 95% 53.1%",
		"amber-500": "37.7 92.1% 50.2%",
		"yellow-500": "45.4 93.4% 47.5%",
		"green-500": "142.1 70.6% 45.3%",
		"emerald-500": "160.1 84.1% 39.4%",
		"blue-500": "217.2 91.2% 59.8%",
		"blue-600": "221.2 83.2% 53.3%",
		"indigo-500": "238.7 83.5% 66.7%",
		"purple-500": "270.7 91% 65.1%",
		"pink-500": "330.4 81.2% 60.4%",
	};
	if (rawName?.startsWith("[") && rawName.endsWith("]")) {
		return rawName.slice(1, -1);
	}
	const value = colors[rawName];
	if (!value) return null;
	if (value.includes("/")) return `hsl(${value})`;
	if (opacity) return `hsl(${value} / ${Number(opacity) / 100})`;
	return `hsl(${value})`;
};

const remScale = (value) => {
	const scale = {
		0: "0",
		0.5: "0.125rem",
		1: "0.25rem",
		1.5: "0.375rem",
		2: "0.5rem",
		2.5: "0.625rem",
		3: "0.75rem",
		4: "1rem",
		5: "1.25rem",
		6: "1.5rem",
		8: "2rem",
		9: "2.25rem",
		10: "2.5rem",
		12: "3rem",
		16: "4rem",
	};
	return scale[value] ?? null;
};

const sizeValue = (value) => {
	if (value === "full") return "100%";
	if (value === "screen") return "100vh";
	if (value === "xl") return "36rem";
	if (value === "none") return "none";
	if (value?.startsWith("[") && value.endsWith("]")) return value.slice(1, -1);
	return remScale(value);
};

const utilityDeclarations = (utility) => {
	const staticUtilities = {
		"pointer-events-none": "pointer-events: none;",
		"cursor-not-allowed": "cursor: not-allowed;",
		"mx-auto": "margin-left: auto; margin-right: auto;",
		block: "display: block;",
		flex: "display: flex;",
		"inline-flex": "display: inline-flex;",
		grid: "display: grid;",
		hidden: "display: none;",
		"flex-col": "flex-direction: column;",
		"items-center": "align-items: center;",
		"justify-center": "justify-content: center;",
		"justify-between": "justify-content: space-between;",
		"whitespace-nowrap": "white-space: nowrap;",
		"rounded-md": "border-radius: calc(var(--radius) - 2px);",
		"rounded-lg": "border-radius: var(--radius);",
		"rounded-sm": "border-radius: calc(var(--radius) - 4px);",
		"rounded-full": "border-radius: 9999px;",
		border: "border-width: 1px;",
		"border-0": "border-width: 0;",
		"bg-transparent": "background-color: transparent;",
		"font-medium": "font-weight: 500;",
		"font-semibold": "font-weight: 600;",
		"font-bold": "font-weight: 700;",
		"leading-none": "line-height: 1;",
		"tracking-tight": "letter-spacing: 0;",
		"text-left": "text-align: left;",
		"text-center": "text-align: center;",
		"text-right": "text-align: right;",
		"underline-offset-4": "text-underline-offset: 4px;",
		underline: "text-decoration-line: underline;",
		"outline-none": "outline: 2px solid transparent; outline-offset: 2px;",
		"ring-1": "box-shadow: 0 0 0 1px var(--tw-ring-color, hsl(var(--ring)));",
		shadow: "box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);",
		"shadow-sm": "box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);",
		"transition-colors": "transition-property: color, background-color, border-color, text-decoration-color, fill, stroke; transition-duration: 150ms;",
		"space-y-1.5": "> :not([hidden]) ~ :not([hidden]) { margin-top: 0.375rem; }",
		"space-y-4": "> :not([hidden]) ~ :not([hidden]) { margin-top: 1rem; }",
	};
	if (staticUtilities[utility]) return staticUtilities[utility];

	const gridMatch = utility.match(/^grid-cols-(\d+)$/);
	if (gridMatch) {
		return `grid-template-columns: repeat(${gridMatch[1]}, minmax(0, 1fr));`;
	}

	const colSpanMatch = utility.match(/^col-span-(\d+)$/);
	if (colSpanMatch) return `grid-column: span ${colSpanMatch[1]} / span ${colSpanMatch[1]};`;

	const colorMatch = utility.match(/^(bg|text|border|placeholder:text|ring)-(.+)$/);
	if (colorMatch) {
		const color = colorValue(colorMatch[2]);
		if (!color) return "";
		if (colorMatch[1] === "bg") return `background-color: ${color};`;
		if (colorMatch[1] === "text") return `color: ${color};`;
		if (colorMatch[1] === "border") return `border-color: ${color};`;
		if (colorMatch[1] === "placeholder:text") return `color: ${color};`;
		if (colorMatch[1] === "ring") return `--tw-ring-color: ${color};`;
	}

	const spacingMatch = utility.match(/^(p|px|py|pt|m|gap)-(.+)$/);
	if (spacingMatch) {
		const value = remScale(spacingMatch[2]);
		if (!value) return "";
		const props = {
			p: ["padding"],
			px: ["padding-left", "padding-right"],
			py: ["padding-top", "padding-bottom"],
			pt: ["padding-top"],
			m: ["margin"],
			gap: ["gap"],
		}[spacingMatch[1]];
		return props.map((prop) => `${prop}: ${value};`).join(" ");
	}

	const sizeMatch = utility.match(/^(h|w|min-h|min-w|max-w)-(.+)$/);
	if (sizeMatch) {
		const value = sizeValue(sizeMatch[2]);
		if (!value) return "";
		const props = {
			h: "height",
			w: "width",
			"min-h": "min-height",
			"min-w": "min-width",
			"max-w": "max-width",
		};
		return `${props[sizeMatch[1]]}: ${value};`;
	}

	const textSizeMatch = utility.match(/^text-(xs|sm|base|lg|xl|2xl)$/);
	if (textSizeMatch) {
		const sizes = {
			xs: "0.75rem; line-height: 1rem;",
			sm: "0.875rem; line-height: 1.25rem;",
			base: "1rem; line-height: 1.5rem;",
			lg: "1.125rem; line-height: 1.75rem;",
			xl: "1.25rem; line-height: 1.75rem;",
			"2xl": "1.5rem; line-height: 2rem;",
		};
		return `font-size: ${sizes[textSizeMatch[1]]}`;
	}

	const opacityMatch = utility.match(/^opacity-(\d+)$/);
	if (opacityMatch) return `opacity: ${Number(opacityMatch[1]) / 100};`;

	return "";
};

const variantSelector = (className) => {
	const parts = className.split(":");
	const utility = parts.pop();
	let selector = `.${escapeCssClass(className)}`;
	const pseudo = [];
	for (const variant of parts) {
		if (variant === "hover") pseudo.push(":hover");
		if (variant === "focus-visible") pseudo.push(":focus-visible");
		if (variant === "disabled") pseudo.push(":disabled");
		if (variant === "file") selector += "::file-selector-button";
		if (variant === "placeholder") selector += "::placeholder";
		if (variant === "peer-disabled") selector = `.peer:disabled ~ ${selector}`;
	}
	return { selector: `${selector}${pseudo.join("")}`, utility };
};

const generateTailwindUtilities = (classes) => {
	const rules = [];
	for (const className of Array.from(classes).sort()) {
		const { selector, utility } = variantSelector(className);
		const declarations = utilityDeclarations(utility);
		if (!declarations) continue;
		if (declarations.startsWith("> ")) {
			rules.push(`${selector} ${declarations}`);
		} else {
			rules.push(`${selector} { ${declarations} }`);
		}
	}
	return rules.join("\n");
};

const expandApplyDirectives = (css) =>
	css.replace(/@apply\s+([^;]+);/g, (_match, classList) => {
		const declarations = String(classList)
			.trim()
			.split(/\s+/)
			.map((className) => utilityDeclarations(className))
			.filter(Boolean)
			.join(" ");
		return declarations || "";
	});

const processTailwindCss = ({ vfs, rootDir, cssPath, cssSource }) => {
	const classes = collectTailwindClasses(vfs, rootDir);
	const baseCss = `*, ::before, ::after { box-sizing: border-box; border-width: 0; border-style: solid; border-color: hsl(var(--border)); }\nhtml { line-height: 1.5; -webkit-text-size-adjust: 100%; }\nbody { margin: 0; }\nbutton, input, textarea { font: inherit; }\nbutton { cursor: pointer; }\nbutton:disabled { cursor: default; }\n`;
	const utilitiesCss = generateTailwindUtilities(classes);
	return expandApplyDirectives(cssSource)
		.replace(/@tailwind\s+base\s*;/g, baseCss)
		.replace(/@tailwind\s+components\s*;/g, "")
		.replace(/@tailwind\s+utilities\s*;/g, utilitiesCss)
		.replace(/@import\s+["']tailwindcss["'];?/g, `${baseCss}\n${utilitiesCss}`);
};

const createViteTailwindProcessor = (vfs, rootDir) => {
	const cache = new Map();
	const hashProject = (cssPath, cssSource) => {
		const files = walkProjectFiles(vfs, rootDir, [
			".html",
			".js",
			".jsx",
			".ts",
			".tsx",
			".css",
		]);
		const parts = [cssPath, cssSource];
		for (const file of files.sort()) {
			parts.push(file, readTextIfExists(vfs, file));
		}
		return parts.join("\n---memorall-tailwind---\n");
	};
	return {
		clear: () => cache.clear(),
		shouldProcess: (cssSource) =>
			cssSource.includes("@tailwind") ||
			cssSource.includes("@import 'tailwindcss'") ||
			cssSource.includes('@import "tailwindcss"') ||
			hasTailwindProjectConfig(vfs, rootDir),
		process: ({ cssPath, cssSource }) => {
			const key = hashProject(cssPath, cssSource);
			if (cache.has(key)) return cache.get(key);
			const processed = processTailwindCss({ vfs, rootDir, cssPath, cssSource });
			cache.set(key, processed);
			return processed;
		},
	};
};

const createCssModuleResponse = (cssPath, css) =>
	createTextResponse({
		contentType: "application/javascript; charset=utf-8",
		body: `const css = ${JSON.stringify(css)};\nlet style = document.querySelector('style[data-vite-dev-id=${JSON.stringify(cssPath)}]');\nif (!style) {\n  style = document.createElement('style');\n  style.setAttribute('data-vite-dev-id', ${JSON.stringify(cssPath)});\n  document.head.appendChild(style);\n}\nstyle.textContent = css;\nexport default css;\n`,
	});

const dirnamePath = (path) => {
	const normalized = path.split("?")[0].split("#")[0];
	const index = normalized.lastIndexOf("/");
	return index <= 0 ? "/" : normalized.slice(0, index);
};

const relativeModuleSpecifierFromPath = (fromPath, targetPath) => {
	const fromParts = dirnamePath(fromPath).split("/").filter(Boolean);
	const toParts = normalizePath(targetPath).split("/").filter(Boolean);

	while (
		fromParts.length > 0 &&
		toParts.length > 0 &&
		fromParts[0] === toParts[0]
	) {
		fromParts.shift();
		toParts.shift();
	}

	const prefix = fromParts.map(() => "..");
	const relative = [...prefix, ...toParts].join("/");
	return relative.startsWith(".") ? relative : `./${relative}`;
};

const toViteUrlPath = (rootDir, fsPath) => {
	const normalizedRoot = normalizePath(rootDir || "/");
	const normalizedPath = normalizePath(fsPath);
	if (normalizedRoot !== "/" && normalizedPath.startsWith(`${normalizedRoot}/`)) {
		return normalizePath(normalizedPath.slice(normalizedRoot.length));
	}
	return normalizedPath;
};

const toViteRequestPath = (rootDir, requestPath) => {
	let url;
	try {
		url = new URL(requestPath, "http://localhost");
	} catch {
		return requestPath;
	}
	const normalizedRoot = normalizePath(rootDir || "/");
	const normalizedPath = normalizePath(url.pathname);
	if (normalizedRoot !== "/" && normalizedPath.startsWith(`${normalizedRoot}/`)) {
		const vitePath = normalizePath(normalizedPath.slice(normalizedRoot.length));
		return `${vitePath}${url.search}${url.hash}`;
	}
	return requestPath;
};

const stripJsonComments = (content) =>
	content
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/.*$/gm, "$1");

const parseJsonConfig = (content) => {
	try {
		return JSON.parse(stripJsonComments(content));
	} catch {
		return null;
	}
};

const quotePattern = String.raw`["']([^"']+)["']`;

const extractJsStringProperty = (content, propertyName) => {
	const match = content.match(
		new RegExp(`(?:${propertyName}|["']${propertyName}["'])\\s*:\\s*${quotePattern}`),
	);
	return match?.[1] ?? undefined;
};

const extractBalancedObjectLiteral = (content, propertyName) => {
	const propertyIndex = content.search(
		new RegExp(`(?:${propertyName}|["']${propertyName}["'])\\s*:`),
	);
	if (propertyIndex < 0) return null;
	const braceStart = content.indexOf("{", propertyIndex);
	if (braceStart < 0) return null;
	let depth = 0;
	let quote = "";
	let escaped = false;
	for (let index = braceStart; index < content.length; index++) {
		const char = content[index];
		if (quote) {
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === quote) {
				quote = "";
			}
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			continue;
		}
		if (char === "{") depth++;
		if (char === "}") {
			depth--;
			if (depth === 0) return content.slice(braceStart, index + 1);
		}
	}
	return null;
};

const parseJsStringMap = (content, propertyName) => {
	const objectLiteral = extractBalancedObjectLiteral(content, propertyName);
	if (!objectLiteral) return {};
	const entries = {};
	const entryPattern = new RegExp(
		`${quotePattern}\\s*:\\s*(?:\\[\\s*)?${quotePattern}`,
		"g",
	);
	for (const match of objectLiteral.matchAll(entryPattern)) {
		entries[match[1]] = [match[2]];
	}
	return entries;
};

const parseJsConfig = (content) => {
	const normalized = stripJsonComments(content);
	const compilerOptionsLiteral =
		extractBalancedObjectLiteral(normalized, "compilerOptions") ?? normalized;
	const compilerOptions = {
		baseUrl: extractJsStringProperty(compilerOptionsLiteral, "baseUrl"),
		paths: parseJsStringMap(compilerOptionsLiteral, "paths"),
	};
	return { compilerOptions };
};

const firstStringValue = (value) => {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		return value.map(firstStringValue).find(Boolean);
	}
	if (value && typeof value === "object") {
		for (const key of ["browser", "import", "module", "default"]) {
			const resolved = firstStringValue(value[key]);
			if (resolved) return resolved;
		}
		for (const nested of Object.values(value)) {
			const resolved = firstStringValue(nested);
			if (resolved) return resolved;
		}
	}
	return undefined;
};

const configFileCandidates = [
	"jsconfig.json",
	"tsconfig.json",
	"jsconfig.js",
	"tsconfig.js",
	"jsconfig.ts",
	"tsconfig.ts",
];

const resolveProjectPath = (rootDir, baseDir, target) => {
	if (!target || target.startsWith("http:") || target.startsWith("https:")) {
		return null;
	}
	const withoutWildcard = target.replace(/\*.*$/, "").replace(/\/$/, "");
	if (!withoutWildcard || withoutWildcard === ".") {
		return normalizePath(baseDir || rootDir);
	}
	if (withoutWildcard.startsWith("/")) return normalizePath(withoutWildcard);
	return normalizePath(`${baseDir || rootDir}/${withoutWildcard}`);
};

const buildPathAliasRule = ({ key, target, rootDir, baseDir }) => {
	const starIndex = key.indexOf("*");
	const keyPrefix = starIndex >= 0 ? key.slice(0, starIndex) : key;
	const keySuffix = starIndex >= 0 ? key.slice(starIndex + 1) : "";
	const targetStarIndex = target.indexOf("*");
	const targetPrefix =
		targetStarIndex >= 0 ? target.slice(0, targetStarIndex) : target;
	const targetSuffix = targetStarIndex >= 0 ? target.slice(targetStarIndex + 1) : "";
	const resolvedPrefix = resolveProjectPath(rootDir, baseDir, targetPrefix);
	if (!resolvedPrefix) return null;
	return { key, keyPrefix, keySuffix, resolvedPrefix, targetSuffix };
};

const createPackageAliasRules = (vfs, rootDir) => {
	const packageJsonPath = normalizePath(`${rootDir}/package.json`);
	const pkg = parseJsonConfig(readTextIfExists(vfs, packageJsonPath)) ?? {};
	const rules = [];
	for (const fieldName of ["_moduleAliases", "moduleAliases", "alias"]) {
		const aliases = pkg[fieldName];
		if (!aliases || typeof aliases !== "object" || Array.isArray(aliases)) {
			continue;
		}
		for (const [key, value] of Object.entries(aliases)) {
			const target = firstStringValue(value);
			if (!target) continue;
			const rule = buildPathAliasRule({
				key,
				target,
				rootDir,
				baseDir: rootDir,
			});
			if (rule) rules.push(rule);
		}
	}

	if (pkg.imports && typeof pkg.imports === "object") {
		for (const [key, value] of Object.entries(pkg.imports)) {
			const target = firstStringValue(value);
			if (!target || !(target.startsWith(".") || target.startsWith("/"))) {
				continue;
			}
			const rule = buildPathAliasRule({
				key,
				target,
				rootDir,
				baseDir: rootDir,
			});
			if (rule) rules.push(rule);
		}
	}
	return rules;
};

const createConfigAliasRules = (vfs, rootDir) => {
	const rules = [];
	for (const fileName of configFileCandidates) {
		const configPath = normalizePath(`${rootDir}/${fileName}`);
		const content = readTextIfExists(vfs, configPath);
		if (!content) continue;
		const config = fileName.endsWith(".json")
			? parseJsonConfig(content)
			: parseJsConfig(content);
		const compilerOptions = config?.compilerOptions;
		if (!compilerOptions || typeof compilerOptions !== "object") continue;
		const baseUrl =
			typeof compilerOptions.baseUrl === "string"
				? normalizePath(`${rootDir}/${compilerOptions.baseUrl}`)
				: rootDir;
		const paths = compilerOptions.paths;
		if (!paths || typeof paths !== "object") continue;
		for (const [key, rawTargets] of Object.entries(paths)) {
			const target = firstStringValue(rawTargets);
			if (!target) continue;
			const rule = buildPathAliasRule({
				key,
				target,
				rootDir,
				baseDir: baseUrl,
			});
			if (rule) rules.push(rule);
		}
	}
	return rules;
};

const createConfigBaseUrls = (vfs, rootDir) => {
	const baseUrls = [];
	for (const fileName of configFileCandidates) {
		const configPath = normalizePath(`${rootDir}/${fileName}`);
		const content = readTextIfExists(vfs, configPath);
		if (!content) continue;
		const config = fileName.endsWith(".json")
			? parseJsonConfig(content)
			: parseJsConfig(content);
		const compilerOptions = config?.compilerOptions;
		if (!compilerOptions || typeof compilerOptions !== "object") continue;
		if (typeof compilerOptions.baseUrl === "string") {
			baseUrls.push(normalizePath(`${rootDir}/${compilerOptions.baseUrl}`));
		}
	}
	return Array.from(new Set(baseUrls));
};

const pathExistsWithViteResolution = (vfs, path) => {
	if (isExistingFile(vfs, path)) return true;
	for (const extension of VITE_EXTENSIONLESS_RESOLVE_EXTENSIONS) {
		if (isExistingFile(vfs, `${path}${extension}`)) return true;
	}
	for (const extension of VITE_EXTENSIONLESS_RESOLVE_EXTENSIONS) {
		if (isExistingFile(vfs, normalizePath(`${path}/index${extension}`))) {
			return true;
		}
	}
	return false;
};

const resolveViteUrlWithExtension = (vfs, rootDir, urlPath) => {
	const normalizedUrlPath = normalizePath(urlPath);
	const fsBasePath = toViteFsPath(rootDir, normalizedUrlPath);
	if (isExistingFile(vfs, fsBasePath)) return normalizedUrlPath;

	for (const extension of VITE_EXTENSIONLESS_RESOLVE_EXTENSIONS) {
		if (isExistingFile(vfs, `${fsBasePath}${extension}`)) {
			return `${normalizedUrlPath}${extension}`;
		}
	}

	for (const extension of VITE_EXTENSIONLESS_RESOLVE_EXTENSIONS) {
		const indexPath = normalizePath(`${fsBasePath}/index${extension}`);
		if (isExistingFile(vfs, indexPath)) {
			return normalizePath(`${normalizedUrlPath}/index${extension}`);
		}
	}

	return normalizedUrlPath;
};

const createViteImportResolver = (vfs, rootDir) => {
	let cachedSignature = "";
	let cachedRules = [];
	let cachedBaseUrls = [];
	const configSignature = () =>
		[
			readTextIfExists(vfs, normalizePath(`${rootDir}/package.json`)),
			...configFileCandidates.map((fileName) =>
				readTextIfExists(vfs, normalizePath(`${rootDir}/${fileName}`)),
			),
		].join("\n---memorall-alias-config---\n");
	const getRules = () => {
		const nextSignature = configSignature();
		if (nextSignature === cachedSignature) return cachedRules;
		cachedSignature = nextSignature;
		cachedRules = [
			...createConfigAliasRules(vfs, rootDir),
			...createPackageAliasRules(vfs, rootDir),
			buildPathAliasRule({
				key: "@/*",
				target: "./src/*",
				rootDir,
				baseDir: rootDir,
			}),
		].sort((left, right) => right.keyPrefix.length - left.keyPrefix.length);
		cachedRules = cachedRules.filter(Boolean);
		cachedBaseUrls = createConfigBaseUrls(vfs, rootDir);
		return cachedRules;
	};
	const resolveAlias = (specifier) => {
		for (const rule of getRules()) {
			if (!specifier.startsWith(rule.keyPrefix)) continue;
			if (rule.keySuffix && !specifier.endsWith(rule.keySuffix)) continue;
			if (
				!rule.key.includes("*") &&
				specifier !== rule.key &&
				!specifier.startsWith(`${rule.key}/`)
			) {
				continue;
			}
			const middle = rule.key.includes("*")
				? specifier.slice(
						rule.keyPrefix.length,
						rule.keySuffix
							? specifier.length - rule.keySuffix.length
							: specifier.length,
					)
				: specifier === rule.key
					? ""
					: specifier.slice(rule.key.length + 1);
			const joined = middle
				? `${rule.resolvedPrefix}/${middle}${rule.targetSuffix}`
				: `${rule.resolvedPrefix}${rule.targetSuffix}`;
			return normalizePath(joined);
		}
		return null;
	};
	const resolveBaseUrlImport = (specifier) => {
		getRules();
		for (const baseUrl of cachedBaseUrls) {
			const candidate = normalizePath(`${baseUrl}/${specifier}`);
			if (pathExistsWithViteResolution(vfs, candidate)) {
				return candidate;
			}
		}
		return null;
	};
	const resolveLocal = (specifier, ownerPath) => {
		if (
			!specifier ||
			specifier.startsWith("http:") ||
			specifier.startsWith("https:") ||
			specifier.startsWith("data:") ||
			specifier.startsWith("blob:") ||
			specifier.startsWith("chrome-extension:") ||
			specifier.startsWith("/__virtual__")
		) {
			return null;
		}
		if (specifier.startsWith("./") || specifier.startsWith("../")) {
			return resolveViteUrlWithExtension(
				vfs,
				rootDir,
				normalizePath(`${dirnamePath(ownerPath)}/${specifier}`),
			);
		}
		if (specifier.startsWith("/")) {
			return resolveViteUrlWithExtension(
				vfs,
				rootDir,
				toViteUrlPath(rootDir, specifier),
			);
		}
		const resolved = resolveAlias(specifier) ?? resolveBaseUrlImport(specifier);
		return resolved
			? resolveViteUrlWithExtension(vfs, rootDir, toViteUrlPath(rootDir, resolved))
			: null;
	};
	return {
		clear: () => {
			cachedSignature = "";
			cachedRules = [];
			cachedBaseUrls = [];
		},
		rewrite: (code, ownerPath) => rewriteViteLocalImports(code, ownerPath, resolveLocal),
	};
};

const rewriteViteLocalImports = (code, ownerPath, resolveLocal) => {
	const rewriteSpecifier = (specifier) => {
		const resolved = resolveLocal(specifier, ownerPath);
		if (!resolved) return specifier;
		return relativeModuleSpecifierFromPath(ownerPath, resolved);
	};

	let rewritten = code.replace(
		/\b((?:import|export)[\s\S]*?\bfrom)\s*(['"])([^'"]+)\2/g,
		(_match, prefix, quote, specifier) =>
			`${prefix} ${quote}${rewriteSpecifier(specifier)}${quote}`,
	);
	rewritten = rewritten.replace(
		/\b(import)\s*(['"])([^'"]+)\2/g,
		(_match, keyword, quote, specifier) =>
			`${keyword} ${quote}${rewriteSpecifier(specifier)}${quote}`,
	);
	rewritten = rewritten.replace(
		/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
		(_match, quote, specifier) =>
			`import(${quote}${rewriteSpecifier(specifier)}${quote})`,
	);
	return rewritten;
};

const isJavaScriptResponse = (path, contentType, headers = {}) => {
	const normalizedContentType = String(contentType || "").toLowerCase();
	return (
		normalizedContentType.includes("javascript") ||
		normalizedContentType.includes("ecmascript") ||
		headers?.["X-Transformed"] === "true" ||
		headers?.["x-transformed"] === "true" ||
		/\.(jsx?|tsx?|mjs|cjs)(?:[?#].*)?$/i.test(path)
	);
};

const getServerOrThrow = (port) => {
	const server = runtimeState.servers.get(port);
	if (!server) {
		throw new Error(`Server not found on port ${port}`);
	}
	if (typeof server.handleRequest !== "function") {
		throw new Error(`No request handler for server on port ${port}`);
	}
	return server;
};

const createViteServerState = async ({
	containerInstance,
	bridge,
	port,
	hostname,
	rootDir,
}) => {
	const almostNodeLib = await loadAlmostNodeLib();
	if (typeof almostNodeLib.ViteDevServer !== "function") {
		throw new Error("ViteDevServer is not available in runtime bundle");
	}
	const viteServer = new almostNodeLib.ViteDevServer(containerInstance.vfs, {
		port,
		hostname,
		root: rootDir,
	});
	const tailwindProcessor = createViteTailwindProcessor(
		containerInstance.vfs,
		rootDir,
	);
	const importResolver = createViteImportResolver(containerInstance.vfs, rootDir);
	await viteServer.start();
	return {
		stop: async () => {
			await viteServer.stop();
			unregisterBridgeServer(bridge, port);
		},
		handleRequest: async (method, path, headers, body) => {
			const viteRequestPath = toViteRequestPath(rootDir, path);
			const resolvedPath = resolveViteExtensionlessModulePath(
				containerInstance.vfs,
				rootDir,
				viteRequestPath,
			);
			const pathname = new URL(resolvedPath, "http://localhost").pathname;
			if (pathname.endsWith(".css")) {
				const cssPath = toViteFsPath(rootDir, pathname);
				try {
					const cssSource = readTextIfExists(containerInstance.vfs, cssPath);
					if (cssSource && tailwindProcessor.shouldProcess(cssSource)) {
						const css = tailwindProcessor.process({ cssPath, cssSource });
						return isViteCssModuleRequest(headers)
							? createCssModuleResponse(cssPath, css)
							: createTextResponse({
									contentType: "text/css; charset=utf-8",
									body: css,
								});
					}
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					return createViteTransformErrorResponse(
						`Tailwind CSS processing failed for ${cssPath}: ${message}`,
					);
				}
			}

			const response = await viteServer.handleRequest(
				method,
				resolvedPath,
				headers,
				body,
			);
			if ((response.statusCode ?? 200) === 404) {
				const fsPath = toViteFsPath(rootDir, pathname);
				if (isWorkspacePath(fsPath)) {
					return createWorkspaceMaterializationMissResponse(fsPath);
				}
			}
			const contentType =
				response.headers?.["Content-Type"] ??
				response.headers?.["content-type"] ??
				"";
			if (response.body && isJavaScriptResponse(pathname, contentType, response.headers)) {
				const code = decodeBodyText(response.body);
				const rewritten = importResolver.rewrite(code, pathname);
				if (rewritten !== code) {
					return createTextResponse({
						body: rewritten,
						contentType: "application/javascript; charset=utf-8",
						statusCode: response.statusCode ?? 200,
						statusMessage: response.statusMessage ?? "OK",
						headers: response.headers ?? {},
					});
				}
			}
			return response;
		},
		notifyFileChange: async (path) => {
			if (/\.(css|jsx?|tsx?)$/.test(path)) {
				tailwindProcessor.clear();
			}
			if (
				/(?:package\.json|[jt]sconfig\.(?:json|js|ts))$/.test(path)
			) {
				importResolver.clear();
			}
			if (typeof viteServer.handleFileChange === "function") {
				await viteServer.handleFileChange(path);
			}
		},
	};
};

const createNextServerState = async ({
	containerInstance,
	bridge,
	port,
	hostname,
	rootDir,
}) => {
	const almostNodeLib = await loadAlmostNodeLib();
	if (typeof almostNodeLib.NextDevServer !== "function") {
		throw new Error("NextDevServer is not available in runtime bundle");
	}
	const nextServer = new almostNodeLib.NextDevServer(containerInstance.vfs, {
		port,
		hostname,
		root: rootDir,
	});
	await nextServer.start();
	return {
		stop: async () => {
			await nextServer.stop();
			unregisterBridgeServer(bridge, port);
		},
		handleRequest: (method, path, headers, body) =>
			nextServer.handleRequest(method, path, headers, body),
		notifyFileChange: async (path) => {
			if (typeof nextServer.handleFileChange === "function") {
				await nextServer.handleFileChange(path);
			}
		},
	};
};

const createExpressServerState = async ({
	containerInstance,
	bridge,
	port,
	rootDir,
	entryPath,
}) => {
	if (!bridge || typeof bridge.handleRequest !== "function") {
		throw new Error("Server bridge is not ready for express requests");
	}
	const normalizedEntryPath = normalizePath(entryPath || `${rootDir}/server.js`);
	await containerInstance.runFile(normalizedEntryPath);
	const started = await waitForExpressStartup(bridge, port, 3_000);
	if (!started) {
		pushRuntimeLog(
			"warn",
			`Express startup probe did not confirm readiness for port ${port}; continuing with optimistic server state`,
		);
	}
	return {
		stop: async () => {
			await closeTrackedExpressServer(containerInstance, port);
			unregisterBridgeServer(bridge, port);
		},
		handleRequest: (method, path, headers, body) =>
			bridge.handleRequest(port, method, path, headers, body),
	};
};

const getHeaderCaseInsensitive = (headers, name) => {
	if (!headers || typeof headers !== "object") return undefined;
	const target = String(name).toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (String(key).toLowerCase() === target) {
			return value;
		}
	}
	return undefined;
};

const decodeResponseBodyPreview = (body, maxChars = 300) => {
	try {
		if (typeof body === "string") {
			return body.slice(0, maxChars);
		}
		if (body instanceof ArrayBuffer) {
			return new TextDecoder().decode(body).slice(0, maxChars);
		}
		if (ArrayBuffer.isView(body)) {
			return new TextDecoder().decode(body).slice(0, maxChars);
		}
	} catch {}
	return "";
};

const logSwResponseDiagnostics = (normalizedPath, responseData) => {
	const body = responseData.body;
	const bodyType = typeof body;
	const isArrayBuffer = body instanceof ArrayBuffer;
	const isView = ArrayBuffer.isView(body);
	const isString = bodyType === "string";
	const byteLength = isArrayBuffer
		? body.byteLength
		: isView
			? body.byteLength
			: isString
				? body.length
				: body == null
					? 0
					: -1;
	const preview = decodeResponseBodyPreview(body);
	console.log(`[server.handleSwRequest] handleRequest ${normalizedPath}`, responseData);
	console.log(
		`[server.handleSwRequest] responseData statusCode=${responseData.statusCode} body typeof=${bodyType} isArrayBuffer=${isArrayBuffer} isView=${isView} isString=${isString} byteLen=${byteLength}`,
		preview ? `body preview: ${preview}` : "(no preview)",
	);
};

const logResponseFailure = (method, normalizedPath, responseData) => {
	const errorBody = decodeResponseBodyPreview(responseData.body, 2000);
	const transformError =
		getHeaderCaseInsensitive(responseData.headers, "x-transform-error") ===
		"true";
	const isRecoverableWorkspaceMiss =
		transformError &&
		errorBody.includes("Workspace file not materialized:");
	const level = isRecoverableWorkspaceMiss ? "warn" : "error";
	const consoleFn = isRecoverableWorkspaceMiss ? console.warn : console.error;
	consoleFn(
		`[server.handleSwRequest] ${method} ${normalizedPath} → ${responseData.statusCode ?? 200} ${responseData.statusMessage ?? ""}`,
		errorBody || "(no body)",
	);
	pushRuntimeLog(
		level,
		`Server ${level}: ${method} ${normalizedPath} → ${responseData.statusCode ?? 200}: ${errorBody.slice(0, 500) || "(no body)"}`,
	);
};

const toBodyBytes = (rawBody) => {
	if (!rawBody) {
		return new Uint8Array(0);
	}
	if (rawBody instanceof ArrayBuffer) {
		return new Uint8Array(rawBody);
	}
	if (ArrayBuffer.isView(rawBody)) {
		return new Uint8Array(
			rawBody.buffer,
			rawBody.byteOffset,
			rawBody.byteLength,
		);
	}
	if (typeof rawBody === "string") {
		return new TextEncoder().encode(rawBody);
	}
	console.warn(
		"[server.handleSwRequest] unknown body type, body will be empty:",
		typeof rawBody,
		rawBody,
	);
	return new Uint8Array(0);
};

const encodeBodyBase64 = (rawBody) => {
	const bodyBytes = toBodyBytes(rawBody);
	if (bodyBytes.length === 0) return "";
	const chunkSize = 8192;
	let binary = "";
	for (let i = 0; i < bodyBytes.length; i += chunkSize) {
		binary += String.fromCharCode(
			...bodyBytes.subarray(i, Math.min(i + chunkSize, bodyBytes.length)),
		);
	}
	return btoa(binary);
};

const isPathWithinRoot = (rootDir, path) => {
	const normalizedRoot = normalizePath(rootDir || "/");
	const normalizedPath = normalizePath(path);
	return (
		normalizedRoot === "/" ||
		normalizedPath === normalizedRoot ||
		normalizedPath.startsWith(`${normalizedRoot}/`)
	);
};

export const notifyWorkspaceFileChanges = async (paths = []) => {
	const uniquePaths = Array.from(
		new Set(
			paths
				.filter((path) => typeof path === "string" && path.length > 0)
				.map((path) => normalizePath(path)),
		),
	);
	if (uniquePaths.length === 0) {
		return;
	}

	for (const server of runtimeState.servers.values()) {
		if (typeof server.notifyFileChange !== "function") {
			continue;
		}
		for (const path of uniquePaths) {
			if (!isPathWithinRoot(server.rootDir, path)) {
				continue;
			}
			try {
				await server.notifyFileChange(path);
			} catch (error) {
				pushRuntimeLog(
					"warn",
					`Hot reload notify failed for server :${server.port} (${path}): ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}
};

export const startServerOperation = async (payload) => {
	const containerInstance = await ensureContainer();
	const port = payload.port;
	const hostname = payload.hostname;
	const rootDir = normalizePath(payload.rootDir || "/projects/app");

	let createdFiles = [];
	if (isFolderEmpty(containerInstance, rootDir) && payload.template) {
		createdFiles = scaffoldTemplate(containerInstance, payload.template, rootDir);
		if (payload.autoInstall !== false) {
			await installTemplatePackages(containerInstance, payload.template);
		}
	}

	const kind = detectServerKind(containerInstance, rootDir, payload.kind);
	await stopServerState(port);

	const bridge = await ensureServerBridgeReady(containerInstance);
	const serverFactoryParams = {
		containerInstance,
		bridge,
		port,
		hostname,
		rootDir,
		entryPath: payload.entryPath,
	};
	const serverImpl =
		kind === "vite"
			? await createViteServerState(serverFactoryParams)
			: kind === "next"
				? await createNextServerState(serverFactoryParams)
				: await createExpressServerState(serverFactoryParams);

	const url = resolveServerBaseUrl(bridge, port);
	const state = {
		kind,
		port,
		url,
		renderUrl: url,
		rootDir,
		stop: serverImpl.stop,
		handleRequest: serverImpl.handleRequest,
		notifyFileChange: serverImpl.notifyFileChange,
	};
	runtimeState.servers.set(port, state);
	return { ...toServerInfo(state), createdFiles };
};

export const stopServerOperation = async (payload) => {
	await stopServerState(payload.port);
	return { port: payload.port };
};

export const listServersOperation = async () => ({
	servers: Array.from(runtimeState.servers.values()).map(toServerInfo),
});

export const renderServerUrlOperation = async (payload) => {
	const server = getServerOrThrow(payload.port);
	const url =
		server.url.replace(/\/?$/, "") + normalizeServerPath(payload.path || "/");
	return { port: payload.port, url };
};

export const requestServerOperation = async (payload) => {
	const server = getServerOrThrow(payload.port);
	const path = normalizeServerPath(payload.path || "/");
	const url = server.url.replace(/\/?$/, "") + path;
	const bodyBuffer = payload.body
		? new TextEncoder().encode(payload.body).buffer
		: null;
	const responseData = await server.handleRequest(
		payload.method ?? "GET",
		path,
		payload.headers ?? {},
		bodyBuffer,
	);
	const contentType =
		responseData.headers?.["content-type"] ??
		responseData.headers?.["Content-Type"] ??
		"";
	const responseType = resolveResponseType(
		contentType,
		payload.responseType ?? "auto",
	);
	const bodyText = responseData.body
		? new TextDecoder().decode(responseData.body)
		: "";
	const body =
		responseType === "json"
			? JSON.stringify(JSON.parse(bodyText), null, 2)
			: bodyText;
	return {
		port: payload.port,
		url,
		status: responseData.statusCode ?? 200,
		ok: (responseData.statusCode ?? 200) < 400,
		contentType,
		responseType,
		headers: responseData.headers ?? {},
		body,
	};
};

export const handleSwRequestOperation = async (payload) => {
	const { id, port, method, path, headers, body } = payload;
	console.log(
		`[server.handleSwRequest] id=${id} port=${port} method=${method} path=${path}`,
	);
	const server = getServerOrThrow(port);
	const normalizedPath = normalizeServerPath(path || "/");
	const responseData = await server.handleRequest(
		method ?? "GET",
		normalizedPath,
		headers ?? {},
		body ?? null,
	);

	logSwResponseDiagnostics(normalizedPath, responseData);

	const isTransformError =
		getHeaderCaseInsensitive(responseData.headers, "x-transform-error") ===
		"true";
	if ((responseData.statusCode ?? 200) >= 400 || isTransformError) {
		logResponseFailure(method, normalizedPath, responseData);
	}

	return {
		statusCode: responseData.statusCode ?? 200,
		statusMessage: responseData.statusMessage ?? "OK",
		headers: responseData.headers ?? {},
		bodyBase64: encodeBodyBase64(responseData.body),
	};
};
