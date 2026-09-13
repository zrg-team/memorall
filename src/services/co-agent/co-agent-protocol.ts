/**
 * Compatibility barrel. The co-agent protocol now lives at `@/co-agent/protocol`
 * so the extension, the desktop app and the script injected into the managed
 * browser all share one definition.
 */
export * from "@/co-agent/protocol";
