import { fireEvent, render } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { AppIcon, composioLogoUrl, ConnectionIcon } from "../AppIcon";

const imageIn = (container: HTMLElement): HTMLImageElement | null =>
	container.querySelector("img");

describe("AppIcon", () => {
	it("uses the logo the toolkit reported", () => {
		const { container } = render(
			<AppIcon name="Gmail" src="https://example.test/gmail.svg" />,
		);

		expect(imageIn(container)?.src).toBe("https://example.test/gmail.svg");
	});

	it("derives the mark from the slug for apps recorded before logos were stored", () => {
		// The whole existing install is in this state: apps saved with an id and a
		// name and nothing else. Without the derived URL they would stay as grey
		// initials until each one was reconnected.
		const { container } = render(
			<AppIcon name="Google Calendar" composioSlug="googlecalendar" />,
		);

		expect(imageIn(container)?.src).toBe(composioLogoUrl("googlecalendar"));
	});

	it("falls back to initials when the mark cannot be fetched", () => {
		const { container } = render(
			<AppIcon name="Google Calendar" composioSlug="googlecalendar" />,
		);

		const image = imageIn(container);
		expect(image).not.toBeNull();
		fireEvent.error(image as HTMLImageElement);

		expect(imageIn(container)).toBeNull();
		expect(container.textContent).toBe("GC");
	});

	it("never guesses a Composio mark for something that is not a Composio app", () => {
		const { container } = render(<AppIcon name="acme-internal" />);

		expect(imageIn(container)).toBeNull();
		// Hyphens and underscores separate words, so a server name initialises
		// from its parts rather than from its first two letters.
		expect(container.textContent).toBe("AI");
	});
});

describe("ConnectionIcon", () => {
	it("wears Composio's own mark for a Composio credential", () => {
		const { container } = render(<ConnectionIcon kind="composio" />);

		expect(imageIn(container)?.src).toBe(composioLogoUrl("composio"));
	});

	it("draws a shape, not a logo, for an endpoint that has no brand", () => {
		const { container } = render(<ConnectionIcon kind="custom" />);

		expect(imageIn(container)).toBeNull();
		expect(container.querySelector("svg")).not.toBeNull();
	});
});
