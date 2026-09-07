import assert from "node:assert/strict";
import test from "node:test";
import { findPassivePreventDefault } from "./check-passive-event-preventdefault.mjs";

const find = (contents, filePath = "src/embedded/thing.tsx") =>
	findPassivePreventDefault([{ path: filePath, contents }]);

test("catches the handler shape that shipped this bug", () => {
	// The conversation scroll handler as it looked in 0.5.20.
	const findings = find(`
		const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
			const { scrollTop, clientHeight, scrollHeight } = element;
			if (atTop && isScrollingUp) {
				event.preventDefault();
				event.stopPropagation();
			}
		}, []);
	`);

	assert.equal(findings.length, 1);
	assert.match(findings[0].reason, /passive wheel or touch handler/);
});

test("catches an inline handler on a passively registered prop", () => {
	for (const prop of ["onWheel", "onTouchStart", "onTouchMove"]) {
		const findings = find(
			`<div ${prop}={(event) => { event.preventDefault(); }} />`,
		);
		assert.equal(findings.length, 1, `${prop} should be reported`);
		assert.match(findings[0].reason, new RegExp(prop));
	}
});

test("catches a touch handler typed without the React namespace", () => {
	const findings = find(`
		function onMove(event: TouchEvent) {
			event.preventDefault();
		}
	`);
	assert.equal(findings.length, 0, "a plain function is not an arrow handler");

	const arrow = find(
		`const onMove = (event: TouchEvent) => { event.preventDefault(); };`,
	);
	assert.equal(arrow.length, 1);
});

test("catches a hand-registered listener that never opted out of passive", () => {
	const findings = find(`
		window.addEventListener("touchmove", (event) => {
			event.preventDefault();
		});
	`);
	assert.equal(findings.length, 1);
	assert.match(findings[0].reason, /touchmove/);
});

test("allows a listener that explicitly asked for a cancelable one", () => {
	assert.deepEqual(
		find(`
			window.addEventListener("wheel", (event) => {
				event.preventDefault();
			}, { passive: false });
		`),
		[],
	);
});

test("leaves handlers for events that are not delivered passively alone", () => {
	assert.deepEqual(
		find(`
			const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
				event.preventDefault();
			};
			<form onSubmit={(event) => { event.preventDefault(); }} />
			window.addEventListener("mousedown", (event) => { event.preventDefault(); });
		`),
		[],
	);
});

test("leaves a passive handler that does not cancel anything alone", () => {
	assert.deepEqual(
		find(`
			const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
				event.stopPropagation();
			};
			window.addEventListener("wheel", schedulePositionUpdate, { passive: true });
		`),
		[],
	);
});

test("ignores tests and generated skill payloads", () => {
	const offending = `const h = (e: React.WheelEvent<HTMLDivElement>) => { e.preventDefault(); };`;
	assert.deepEqual(
		find(offending, "src/embedded/__tests__/thing.test.tsx"),
		[],
	);
	assert.deepEqual(find(offending, "src/embedded/thing.spec.tsx"), []);
	assert.deepEqual(
		find(offending, "src/services/filesystem/default-skills/nexu.ts"),
		[],
	);
});

test("reports every offender, sorted so the message is stable", () => {
	const findings = findPassivePreventDefault([
		{
			path: "src/b.tsx",
			contents: `<div onWheel={(e) => { e.preventDefault(); }} />`,
		},
		{
			path: "src/a.tsx",
			contents: `<div onTouchMove={(e) => { e.preventDefault(); }} />`,
		},
	]);

	assert.deepEqual(
		findings.map((finding) => finding.file),
		["src/a.tsx", "src/b.tsx"],
	);
});
