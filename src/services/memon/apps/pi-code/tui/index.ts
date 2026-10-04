// Core TUI interfaces and classes

// Autocomplete support
export {
	type AutocompleteFileSystem,
	type AutocompleteItem,
	type AutocompleteProvider,
	type AutocompleteSuggestions,
	CombinedAutocompleteProvider,
	type SlashCommand,
} from "./autocomplete";
// Components
export { Box } from "./components/box";
export { CancellableLoader } from "./components/cancellable-loader";
export {
	Editor,
	type EditorOptions,
	type EditorTheme,
} from "./components/editor";
export { Image, type ImageOptions, type ImageTheme } from "./components/image";
export { Input } from "./components/input";
export { Loader, type LoaderIndicatorOptions } from "./components/loader";
export {
	type DefaultTextStyle,
	Markdown,
	type MarkdownTheme,
} from "./components/markdown";
export {
	type SelectItem,
	SelectList,
	type SelectListLayoutOptions,
	type SelectListTheme,
	type SelectListTruncatePrimaryContext,
} from "./components/select-list";
export {
	type SettingItem,
	SettingsList,
	type SettingsListTheme,
} from "./components/settings-list";
export { Spacer } from "./components/spacer";
export { Text } from "./components/text";
export { TruncatedText } from "./components/truncated-text";
// Editor component interface (for custom editors)
export type { EditorComponent } from "./editor-component";
// Fuzzy matching
export { type FuzzyMatch, fuzzyFilter, fuzzyMatch } from "./fuzzy";
// Keybindings
export {
	getKeybindings,
	type Keybinding,
	type KeybindingConflict,
	type KeybindingDefinition,
	type KeybindingDefinitions,
	type Keybindings,
	type KeybindingsConfig,
	KeybindingsManager,
	setKeybindings,
	TUI_KEYBINDINGS,
} from "./keybindings";
// Keyboard input handling
export {
	decodeKittyPrintable,
	isKeyRelease,
	isKeyRepeat,
	isKittyProtocolActive,
	Key,
	type KeyEventType,
	type KeyId,
	matchesKey,
	parseKey,
	setKittyProtocolActive,
} from "./keys";
// Input buffering for batch splitting
export {
	StdinBuffer,
	type StdinBufferEventMap,
	type StdinBufferOptions,
} from "./stdin-buffer";
// Terminal interface and implementations
export type { Terminal } from "./terminal";
// Terminal image support
export {
	allocateImageId,
	type CellDimensions,
	calculateImageRows,
	deleteAllKittyImages,
	deleteKittyImage,
	detectCapabilities,
	encodeITerm2,
	encodeKitty,
	getCapabilities,
	getCellDimensions,
	getGifDimensions,
	getImageDimensions,
	getJpegDimensions,
	getPngDimensions,
	getWebpDimensions,
	hyperlink,
	type ImageDimensions,
	type ImageProtocol,
	type ImageRenderOptions,
	imageFallback,
	renderImage,
	resetCapabilitiesCache,
	setCapabilities,
	setCellDimensions,
	type TerminalCapabilities,
} from "./terminal-image";
export {
	type Component,
	Container,
	CURSOR_MARKER,
	type Focusable,
	isFocusable,
	type OverlayAnchor,
	type OverlayHandle,
	type OverlayMargin,
	type OverlayOptions,
	type SizeValue,
	TUI,
} from "./tui";
// Utilities
export { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "./utils";
