// Bridge exports for job notification system
export * from "./types";
export * from "./factory";
export { BroadcastChannelBridge } from "./broadcast-channel";
export { ChromeRuntimeBridge } from "./chrome-runtime";
export { ChromePortBridge } from "./chrome-port";
export { IdbJobStore } from "../idb-job-store";

// Unified bridge access - Use through BackgroundJob singleton for centralized management
export { defaultJobNotificationBridge as jobNotificationChannel } from "./factory";
