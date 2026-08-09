import type { Page, TestInfo } from "@playwright/test";
import { test, expect } from "./fixtures";
import { runSandboxOperation } from "./sandbox-job";

test.describe.configure({ mode: "serial" });

const attachRuntimeLogs = async (page: Page, testInfo: TestInfo) => {
	try {
		const result = await runSandboxOperation<{ logs: unknown[] }>(
			page,
			"runtime.getLogs",
			{ limit: 200 },
			15_000,
		);
		await testInfo.attach("sandbox-runtime.log", {
			body: Buffer.from(JSON.stringify(result.logs, null, 2), "utf8"),
			contentType: "application/json",
		});
	} catch (error) {
		await testInfo.attach("sandbox-runtime.log", {
			body: Buffer.from(String(error), "utf8"),
			contentType: "text/plain",
		});
	}
};

test(
	"@network installs and imports a pinned npm dependency",
	async ({ extensionPage }, testInfo) => {
		try {
			const install = await runSandboxOperation<{
				success: boolean;
				installed: Record<string, string>;
			}>(extensionPage, "npm.install", {
				packageSpec: "lodash@4.17.21",
				save: true,
			});
			expect(install.success).toBe(true);
			const execution = await runSandboxOperation<{
				status: string;
				result: string;
			}>(extensionPage, "runtime.executeCode", {
				code: "module.exports = require('lodash').get({ value: 8 }, 'value')",
			});
			expect(execution).toMatchObject({
				status: "ok",
				result: expect.stringContaining("8"),
			});
		} finally {
			await attachRuntimeLogs(extensionPage, testInfo);
		}
	},
);

test("@network installs package.json and lists resolved versions", async ({ extensionPage }) => {
	await runSandboxOperation(extensionPage, "fs.writeFile", {
		path: "/package.json",
		content: JSON.stringify({
			dependencies: { lodash: "4.17.21", nanoid: "5.1.5" },
		}),
	});
	await runSandboxOperation(extensionPage, "npm.installFromPackageJson", {});
	const listed = await runSandboxOperation<{ packages: Record<string, string> }>(
		extensionPage,
		"npm.list",
		undefined,
	);
	expect(listed.packages.nanoid).toContain("5.1.5");
	expect(listed.packages.lodash).toContain("4.17.21");
});

test("@network fetches HTTPS from inside the sandbox", async ({ extensionPage }) => {
	const response = await runSandboxOperation<{ status: number; body: string }>(
		extensionPage,
		"network.fetch",
		{
			url: "https://registry.npmjs.org/lodash/4.17.21",
			responseType: "json",
			timeoutMs: 30_000,
		},
	);
	expect(response.status).toBe(200);
	expect(response.body).toContain('"version": "4.17.21"');
});

test("@network renders a package-backed preview", async ({
	extensionContext,
	extensionPage,
}) => {
	await runSandboxOperation(extensionPage, "fs.writeFile", {
		path: "/projects/sandbox-e2e/package-preview.js",
		content:
			"const http=require('http');const get=require('lodash/get');http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<main>'+get({page:{title:'Package preview'}},'page.title')+'</main>')}).listen(4174);",
	});
	await runSandboxOperation(extensionPage, "server.start", {
		kind: "express",
		port: 4174,
		rootDir: "/projects/sandbox-e2e",
		entryPath: "/projects/sandbox-e2e/package-preview.js",
	});
	const response = await runSandboxOperation<{ status: number; body: string }>(
		extensionPage,
		"server.request",
		{ port: 4174, path: "/", responseType: "html" },
	);
	expect(response).toMatchObject({
		status: 200,
		body: expect.stringContaining("Package preview"),
	});
	const rendered = await runSandboxOperation<{ url: string }>(
		extensionPage,
		"server.renderUrl",
		{ port: 4174, path: "/" },
	);
	const previewPage = await extensionContext.newPage();
	await previewPage.goto(rendered.url);
	await expect(previewPage.getByText("Package preview", { exact: true })).toBeVisible();
	await previewPage.close();
});
