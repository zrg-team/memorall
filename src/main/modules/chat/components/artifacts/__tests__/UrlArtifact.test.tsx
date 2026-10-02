import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerRenderUrl = vi.fn(
	async ({ port, path }: { port: number; path: string }) => ({
		port,
		url: `/sandbox/pages/renderer.html?port=${port}&path=${encodeURIComponent(path)}`,
	}),
);

vi.mock("@/services", () => ({
	serviceManager: {
		getSandboxContainerService: () => ({
			getServerRenderUrl,
			handleSwRequestWithRetry: vi.fn(),
		}),
	},
}));

vi.mock("@/platform/current", () => ({
	platform: {
		assets: { url: (path: string) => path },
		externalLinks: { open: vi.fn() },
	},
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../ArtifactActionsMenu", () => ({
	ArtifactActionsMenu: () => null,
}));

import { useRuntimeSessionsStore } from "@/main/stores/runtime-sessions";
import { UrlArtifact } from "../UrlArtifact";

const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};

describe("UrlArtifact", () => {
	beforeEach(() => {
		getServerRenderUrl.mockClear();
	});

	it("previews a localhost URL through the computer's server on that port", async () => {
		useRuntimeSessionsStore.setState({
			servers: [{ port: 3000 }] as never,
			refresh: vi.fn(async () => undefined),
		});

		render(
			<UrlArtifact content="http://localhost:3000/game?level=2" title="Game" />,
		);

		const frame = await screen.findByTitle("Game");
		expect(getServerRenderUrl).toHaveBeenCalledWith({
			port: 3000,
			path: "/game?level=2",
		});
		expect(frame.getAttribute("src")).toBe(
			"/sandbox/pages/renderer.html?port=3000&path=%2Fgame%3Flevel%3D2",
		);
	});

	it("loads the real localhost once no server of the computer has the port", async () => {
		const refreshed = deferred();
		useRuntimeSessionsStore.setState({
			servers: [],
			refresh: vi.fn(() => refreshed.promise),
		});

		render(<UrlArtifact content="http://localhost:5173" title="Dev" />);

		// Not the real localhost before the server list is in.
		expect(screen.queryByTitle("Dev")).toBeNull();
		expect(
			screen.getByText("htmlPreview.resolvingSandboxPreview"),
		).toBeInTheDocument();

		refreshed.resolve();

		await waitFor(() =>
			expect(screen.getByTitle("Dev").getAttribute("src")).toBe(
				"http://localhost:5173",
			),
		);
		expect(getServerRenderUrl).not.toHaveBeenCalled();
	});

	it("loads any other web page directly", () => {
		const refresh = vi.fn(async () => undefined);
		useRuntimeSessionsStore.setState({ servers: [], refresh });

		render(<UrlArtifact content="https://example.com/" title="Site" />);

		expect(screen.getByTitle("Site").getAttribute("src")).toBe(
			"https://example.com/",
		);
		expect(refresh).not.toHaveBeenCalled();
	});
});
