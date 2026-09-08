/**
 * Activity tracking, as its own on-demand ES module bundle.
 *
 * Same reason as `embedded-ui.ts`: a chunk fetched by the default loader
 * executes in the page's world and never registers in the content script's
 * isolated one. Keeping this separate from the UI bundle preserves the existing
 * behaviour — tracking starts on every page, the heavy chat UI does not.
 */

import "@/embedded/activity-tracker";
