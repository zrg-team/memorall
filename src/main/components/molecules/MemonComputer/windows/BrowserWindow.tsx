import {
	AppWindow,
	ArrowLeft,
	ArrowRight,
	Globe,
	ImageIcon,
	Plus,
	RefreshCw,
	Server,
	ShieldAlert,
	X,
} from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
	formatOutlineBlock,
	type PageOutlineBlock,
} from "@/co-agent/dom/page-outline";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/main/components/ui/dropdown-menu";
import { sandboxTargetOf } from "@/services/memon/embedded-frame";
import type {
	MemonBrowserState,
	MemonBrowserTab,
} from "@/services/memon/types";
import type { MemonSend } from "../types";
import { EmbeddedPage } from "./EmbeddedPage";

const RefChip: React.FC<{ value: string }> = ({ value }) => (
	<span className="mr-1.5 inline-block rounded border border-border px-1 align-[1px] font-mono text-[10px] font-medium text-muted-foreground no-underline">
		{value}
	</span>
);

const shortUrl = (url: string) =>
	url.replace(/^https?:\/\//, "").replace(/\/$/, "");

const OutlineInput: React.FC<{
	block: Extract<PageOutlineBlock, { kind: "input" }>;
	onSubmit: (value: string) => void;
}> = ({ block, onSubmit }) => {
	const [value, setValue] = React.useState(block.value);
	React.useEffect(() => setValue(block.value), [block.value]);
	return (
		<form
			className="flex min-w-0 items-center rounded-md border border-input bg-background px-1.5"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit(value);
			}}
		>
			<RefChip value={block.ref} />
			<input
				data-memon-ref={block.ref}
				value={value}
				onChange={(event) => setValue(event.target.value)}
				placeholder={block.placeholder ?? block.label}
				aria-label={block.label || block.placeholder || block.ref}
				type={block.inputType === "password" ? "password" : "text"}
				className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none"
			/>
		</form>
	);
};

const OutlineBlock: React.FC<{
	block: PageOutlineBlock;
	act: (
		ref: string,
		action: "click" | "input" | "submit",
		value?: string,
	) => void;
}> = ({ block, act }) => {
	const { t } = useTranslation("common");
	switch (block.kind) {
		case "heading": {
			const size =
				block.level === 1
					? "text-lg"
					: block.level === 2
						? "text-base"
						: "text-sm";
			return (
				<p className={cn("font-semibold leading-snug", size)}>
					{block.ref ? (
						<button
							type="button"
							data-memon-ref={block.ref}
							onClick={() => act(block.ref!, "click")}
							className="text-left text-blue-500 underline-offset-2 hover:underline"
						>
							<RefChip value={block.ref} />
							{block.text}
						</button>
					) : (
						block.text
					)}
				</p>
			);
		}
		case "text":
			return <p className="text-[13px] leading-relaxed">{block.text}</p>;
		case "list":
			return (
				<ul className="list-disc space-y-0.5 pl-5 text-[13px] leading-relaxed">
					{block.items.map((item, index) => (
						<li key={index}>{item}</li>
					))}
				</ul>
			);
		case "quote":
			return (
				<blockquote className="border-l-2 border-border pl-3 text-[13px] text-muted-foreground">
					{block.text}
				</blockquote>
			);
		case "link":
			return (
				<p className="text-[13px]">
					<button
						type="button"
						data-memon-ref={block.ref}
						onClick={() => act(block.ref, "click")}
						title={block.href}
						className="text-left text-blue-500 underline underline-offset-2"
					>
						<RefChip value={block.ref} />
						{block.text}
					</button>
					<span className="ml-2 font-mono text-[10px] text-muted-foreground">
						{shortUrl(block.href).slice(0, 60)}
					</span>
				</p>
			);
		case "button":
			return (
				<button
					type="button"
					data-memon-ref={block.ref}
					onClick={() => act(block.ref, "click")}
					className="self-start rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent"
				>
					<RefChip value={block.ref} />
					{block.text}
					{block.state ? (
						<span className="ml-1.5 text-[10px] text-muted-foreground">
							{block.state}
						</span>
					) : null}
				</button>
			);
		case "input":
			if (block.checked !== undefined) {
				return (
					<label className="flex items-center gap-2 self-start text-xs">
						<RefChip value={block.ref} />
						<input
							data-memon-ref={block.ref}
							type={block.inputType === "radio" ? "radio" : "checkbox"}
							checked={block.checked}
							onChange={() => act(block.ref, "click")}
						/>
						<span>{block.label}</span>
					</label>
				);
			}
			return (
				<OutlineInput
					block={block}
					onSubmit={(value) => act(block.ref, "submit", value)}
				/>
			);
		case "select":
			return (
				<label className="flex items-center gap-2 text-xs">
					<RefChip value={block.ref} />
					<span className="text-muted-foreground">{block.label}</span>
					<select
						data-memon-ref={block.ref}
						value={block.value}
						onChange={(event) => act(block.ref, "input", event.target.value)}
						className="h-7 rounded-md border border-input bg-background px-1.5"
					>
						{block.options.map((option) => (
							<option key={option} value={option}>
								{option}
							</option>
						))}
					</select>
				</label>
			);
		case "image":
			return (
				<div
					data-memon-ref={block.ref}
					className="flex max-h-40 w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-muted/40 p-3 text-center text-muted-foreground"
					style={{
						aspectRatio: `${Math.max(block.width, 1)} / ${Math.max(block.height, 1)}`,
					}}
				>
					<RefChip value={block.ref} />
					<ImageIcon size={16} />
					<span className="text-xs">
						{block.alt || t("memonComputer.noAltText")}
					</span>
					<span className="font-mono text-[10px]">
						{t("memonComputer.imagePlaceholder", {
							size: `${block.width}×${block.height}`,
						})}
					</span>
				</div>
			);
		case "region":
			return (
				<button
					type="button"
					data-memon-ref={block.ref}
					onClick={() => act(block.ref, "click")}
					className="flex max-h-40 w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-muted/40 p-3 text-center font-mono text-[10px] text-muted-foreground"
					style={{
						aspectRatio: `${Math.max(block.width, 1)} / ${Math.max(block.height, 1)}`,
					}}
				>
					<RefChip value={block.ref} />
					{formatOutlineBlock(block).replace(/^\[[^\]]+\]\s*/, "")}
				</button>
			);
	}
};

/**
 * The page is a verification wall (a CAPTCHA, a Cloudflare check). Asks the
 * user to solve it in the real page; Done reads the page again and lets the
 * agent go on once it is through.
 */
const WallNotice: React.FC<{
	wall: NonNullable<MemonBrowserTab["wall"]>;
	/** The agent stopped on it and waits. */
	waiting: boolean;
	/** The page is in a real browser tab, which can be brought forward. */
	real: boolean;
	onShow: () => void;
	onDone: () => void;
	onIgnore: () => void;
}> = ({ wall, waiting, real, onShow, onDone, onIgnore }) => {
	const { t } = useTranslation("common");
	const button =
		"h-7 shrink-0 rounded border border-amber-500/40 px-2.5 text-[11px] font-medium hover:bg-amber-500/15";
	return (
		<div
			role="alert"
			className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100"
		>
			<ShieldAlert size={16} className="shrink-0" />
			<div className="min-w-0 flex-1">
				<div className="font-semibold">{t("memonComputer.wall.title")}</div>
				<div className="text-amber-800/90 dark:text-amber-100/80">
					{t(`memonComputer.wall.${wall.kind}`, {
						defaultValue: wall.description,
					})}{" "}
					{waiting
						? t("memonComputer.wall.waiting")
						: t("memonComputer.wall.idle")}
				</div>
			</div>
			<div className="flex shrink-0 gap-1.5">
				{real ? (
					<button type="button" onClick={onShow} className={button}>
						{t("memonComputer.wall.show")}
					</button>
				) : null}
				<button
					type="button"
					onClick={onDone}
					className={cn(
						button,
						"border-transparent bg-amber-600 text-white hover:bg-amber-500",
					)}
				>
					{t("memonComputer.wall.done")}
				</button>
				<button type="button" onClick={onIgnore} className={button}>
					{t("memonComputer.wall.ignore")}
				</button>
			</div>
		</div>
	);
};

export const BrowserWindow: React.FC<{
	machineKey: string;
	browser: MemonBrowserState;
	/** Ports of servers running in the computer, to open embedded. */
	servers: number[];
	send: MemonSend;
}> = ({ machineKey, browser, servers, send }) => {
	const { t } = useTranslation("common");
	const activeIndex = browser.tabs.findIndex(
		(tab) => tab.id === browser.activeTabId,
	);
	const tab = browser.tabs[activeIndex];
	const embedded = tab?.kind === "embedded";
	const [address, setAddress] = React.useState(tab?.url ?? "");
	React.useEffect(() => setAddress(tab?.url ?? ""), [tab?.url]);
	// An embedded tab shows its page; the outline is what the agent reads.
	const [agentView, setAgentView] = React.useState(false);

	// Back from the real browser window: the Browser shows the page as the
	// user left it, typing included. Where the browser streams its clicks and
	// navigations (the extension), this catches what it does not report; on
	// desktop it is how the Browser follows the real tab at all.
	const realTabOpen = Boolean(tab) && !embedded;
	React.useEffect(() => {
		if (!realTabOpen) return;
		let lastSync = 0;
		const sync = () => {
			if (document.visibilityState !== "visible") return;
			// Focus and visibility arrive together.
			if (Date.now() - lastSync < 1_000) return;
			lastSync = Date.now();
			void send("browser.refresh", { key: machineKey });
		};
		window.addEventListener("focus", sync);
		document.addEventListener("visibilitychange", sync);
		return () => {
			window.removeEventListener("focus", sync);
			document.removeEventListener("visibilitychange", sync);
		};
	}, [machineKey, realTabOpen, send]);

	const act = (
		ref: string,
		action: "click" | "input" | "submit",
		value?: string,
	) => void send("browser.act", { key: machineKey, ref, action, value });

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 items-end gap-1 overflow-x-auto px-1.5 pt-1.5">
				{browser.tabs.map((candidate, index) => (
					<div
						key={candidate.id}
						className={cn(
							"flex min-w-0 max-w-[190px] items-center gap-1 rounded-t-md border border-b-0 px-2 py-1 text-[11px]",
							index === activeIndex
								? "border-border bg-background text-foreground"
								: "border-transparent text-muted-foreground",
						)}
					>
						<button
							type="button"
							className="flex min-w-0 flex-1 items-center gap-1 truncate text-left"
							title={
								candidate.kind === "embedded"
									? t("memonComputer.browser.embeddedTab")
									: undefined
							}
							onClick={() =>
								void send("browser.tab", { key: machineKey, index: index + 1 })
							}
						>
							{candidate.kind === "embedded" ? (
								<Server size={10} className="shrink-0 text-cyan-600" />
							) : null}
							<span className="truncate">
								{candidate.title || shortUrl(candidate.url)}
							</span>
						</button>
						<button
							type="button"
							aria-label={t("memonComputer.closeTab")}
							onClick={() =>
								void send("browser.tab", {
									key: machineKey,
									index: index + 1,
									close: true,
								})
							}
							className="rounded p-0.5 hover:bg-muted"
						>
							<X size={10} />
						</button>
					</div>
				))}
				<DropdownMenu
					onOpenChange={(open) => {
						if (open) void send("browser.servers", { key: machineKey });
					}}
				>
					{/* Same box as a tab (border, padding), so + centers on the tabs' line. */}
					<div className="flex shrink-0 items-center self-stretch border border-b-0 border-transparent px-0.5 py-1">
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								aria-label={t("memonComputer.newTab")}
								className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
							>
								<Plus size={12} />
							</button>
						</DropdownMenuTrigger>
					</div>
					<DropdownMenuContent align="start" className="min-w-56">
						<DropdownMenuItem
							onSelect={() =>
								void send("browser.navigate", {
									key: machineKey,
									url: "https://duckduckgo.com/",
									newTab: true,
									embedded: false,
								})
							}
						>
							<Globe size={14} />
							{t("memonComputer.browser.newRealTab")}
						</DropdownMenuItem>
						<DropdownMenuItem
							onSelect={() =>
								void send("browser.navigate", {
									key: machineKey,
									// Any local address; change it in the address bar.
									url: `http://localhost:${servers[0] ?? 3000}/`,
									newTab: true,
									embedded: true,
								})
							}
						>
							<Server size={14} />
							{t("memonComputer.browser.newEmbeddedTab")}
						</DropdownMenuItem>
						{servers.length ? (
							<>
								<DropdownMenuSeparator />
								<DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
									{t("memonComputer.browser.servers")}
								</DropdownMenuLabel>
								{servers.map((port) => (
									<DropdownMenuItem
										key={port}
										onSelect={() =>
											void send("browser.navigate", {
												key: machineKey,
												url: `http://localhost:${port}/`,
												newTab: true,
												embedded: true,
											})
										}
									>
										<Server size={14} />
										<span className="font-mono text-xs">localhost:{port}</span>
									</DropdownMenuItem>
								))}
							</>
						) : null}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			<form
				className="flex shrink-0 items-center gap-1 border-y border-border px-1.5 py-1.5"
				onSubmit={(event) => {
					event.preventDefault();
					if (address.trim()) {
						void send("browser.navigate", {
							key: machineKey,
							url: address.trim(),
							// A local address stays in the kind of tab it is typed in.
							embedded:
								tab && sandboxTargetOf(address.trim()) ? embedded : undefined,
						});
					}
				}}
			>
				<button
					type="button"
					aria-label={t("memonComputer.back")}
					onClick={() =>
						void send("browser.history", { key: machineKey, direction: "back" })
					}
					className="rounded p-1 text-muted-foreground hover:bg-muted"
				>
					<ArrowLeft size={14} />
				</button>
				<button
					type="button"
					aria-label={t("memonComputer.forward")}
					onClick={() =>
						void send("browser.history", {
							key: machineKey,
							direction: "forward",
						})
					}
					className="rounded p-1 text-muted-foreground hover:bg-muted"
				>
					<ArrowRight size={14} />
				</button>
				<button
					type="button"
					aria-label={t("memonComputer.reload")}
					onClick={() => void send("browser.refresh", { key: machineKey })}
					className="rounded p-1 text-muted-foreground hover:bg-muted"
				>
					<RefreshCw size={13} />
				</button>
				<input
					value={address}
					onChange={(event) => setAddress(event.target.value)}
					aria-label={t("memonComputer.address")}
					spellCheck={false}
					className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-2 font-mono text-[11px]"
				/>
				{embedded ? (
					<div className="flex h-7 shrink-0 items-center rounded border border-border p-0.5 text-[11px]">
						{[false, true].map((showOutline) => (
							<button
								key={String(showOutline)}
								type="button"
								aria-pressed={agentView === showOutline}
								onClick={() => setAgentView(showOutline)}
								className={cn(
									"h-full rounded px-2 font-medium",
									agentView === showOutline
										? "bg-muted text-foreground"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								{showOutline
									? t("memonComputer.browser.agentView")
									: t("memonComputer.browser.pageView")}
							</button>
						))}
					</div>
				) : tab ? (
					<button
						type="button"
						title={t("memonComputer.showRealPage")}
						aria-label={t("memonComputer.showRealPage")}
						onClick={() => void send("browser.show", { key: machineKey })}
						className="inline-flex h-7 shrink-0 items-center gap-1 rounded border border-border px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
					>
						<AppWindow size={13} />
						{t("memonComputer.showRealPageShort")}
					</button>
				) : null}
			</form>
			{tab?.wall ? (
				<WallNotice
					wall={tab.wall}
					waiting={browser.wallTabId === tab.id}
					real={!embedded}
					onShow={() => void send("browser.show", { key: machineKey })}
					onDone={() => void send("browser.recheckWall", { key: machineKey })}
					onIgnore={() =>
						void send("browser.continuePastWall", { key: machineKey })
					}
				/>
			) : null}
			<div className="relative min-h-0 flex-1">
				{tab && embedded ? (
					<EmbeddedPage
						key={tab.sessionId}
						machineKey={machineKey}
						tab={tab}
						send={send}
						hidden={agentView}
					/>
				) : null}
				{/* The outline; over an embedded page, what the agent reads of it. */}
				<div
					className={cn(
						"absolute inset-0 overflow-auto bg-background px-4 py-3",
						embedded && !agentView && "hidden",
					)}
				>
					{tab?.error ? (
						<p className="mb-2 rounded-md border border-red-600/20 bg-red-600/5 px-2 py-1 text-xs text-red-700 dark:text-red-300">
							{tab.error}
						</p>
					) : null}
					{tab?.outline ? (
						<div className="flex max-w-[68ch] flex-col gap-2.5">
							{tab.outline.omittedAbove > 0 ? (
								<p className="text-[11px] text-muted-foreground">
									{t("memonComputer.blocksAbove", {
										count: tab.outline.omittedAbove,
									})}
								</p>
							) : null}
							{tab.outline.blocks.map((block, index) => (
								// The block's screen line is what "Ask in chat" quotes.
								<div
									key={index}
									className="contents"
									data-memon-ask={formatOutlineBlock(block)}
								>
									<OutlineBlock block={block} act={act} />
								</div>
							))}
							{tab.outline.omittedBelow > 0 ? (
								<p className="text-[11px] text-muted-foreground">
									{t("memonComputer.blocksBelow", {
										count: tab.outline.omittedBelow,
									})}
								</p>
							) : null}
						</div>
					) : (
						<p className="text-xs text-muted-foreground">
							{tab ? t("memonComputer.pageLoading") : t("memonComputer.noPage")}
						</p>
					)}
				</div>
			</div>
			<div className="flex shrink-0 justify-between gap-2 border-t border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
				<span className="truncate">
					{t("memonComputer.outlineFooter", {
						count: tab?.outline?.blocks.length ?? 0,
					})}
				</span>
				<span className="truncate">
					{tab
						? `${embedded ? `${t("memonComputer.browser.embeddedTab")} · ` : ""}${shortUrl(tab.url).split("/")[0]}`
						: ""}
				</span>
			</div>
		</div>
	);
};
