import { describe, expect, it } from "vitest";

import { isLocalServerUrl, resolveWebBrowserMode } from "../browser-mode";

const APP = "chrome-extension://abcdef";

describe("where a web page opens", () => {
	it("opens a public site in a window, even when an iframe is asked for", () => {
		const url = "https://www.nhatot.com/mua-ban-nha-dat/134427663.htm";
		expect(resolveWebBrowserMode(url)).toBe("window");
		expect(resolveWebBrowserMode(url, "iframe")).toBe("window");
		expect(resolveWebBrowserMode(url, "tab")).toBe("tab");
		expect(resolveWebBrowserMode(url, "window")).toBe("window");
	});

	it("embeds a local server unless a window or tab is asked for", () => {
		for (const url of [
			"http://localhost:3000/",
			"http://127.0.0.1:8080/api",
			"http://[::1]:5173/",
			"http://app.localhost/",
			"http://0.0.0.0:4000/",
			`${APP}/sandbox/__virtual__/3000/`,
			"/__virtual__/3000/index.html",
		]) {
			expect(resolveWebBrowserMode(url, undefined, APP)).toBe("iframe");
			expect(resolveWebBrowserMode(url, "iframe", APP)).toBe("iframe");
		}
		expect(resolveWebBrowserMode("http://localhost:3000/", "tab")).toBe("tab");
		expect(resolveWebBrowserMode("http://localhost:3000/", "window")).toBe(
			"window",
		);
	});

	it("does not take a look-alike host for a local one", () => {
		expect(isLocalServerUrl("https://localhost.example.com/")).toBe(false);
		expect(isLocalServerUrl("http://127.0.0.1.nip.io/")).toBe(false);
		expect(isLocalServerUrl("http://192.168.1.10:3000/")).toBe(false);
		expect(isLocalServerUrl("not a url")).toBe(false);
	});
});
