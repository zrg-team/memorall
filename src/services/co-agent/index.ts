/**
 * The co-agent protocol lives at `@/co-agent/protocol` so the extension, the
 * desktop app and the script injected into the managed browser share one
 * definition. Re-exported wholesale rather than as a hand-maintained list: the
 * previous list silently omitted new members until someone noticed.
 */
export * from "@/co-agent/protocol";
