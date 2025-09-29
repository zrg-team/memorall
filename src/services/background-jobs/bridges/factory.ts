import { logInfo, logError } from "@/utils/logger";
import type { IJobNotificationBridge, ContextType } from "./types";
import { BroadcastChannelBridge } from "./broadcast-channel";
import { ChromeRuntimeBridge } from "./chrome-runtime";
import { ChromePortBridge } from "./chrome-port";

export type BridgeType = "broadcast-channel" | "chrome-runtime" | "chrome-port";

export interface BridgeFactoryOptions {
	type?: BridgeType;
	contextType?: ContextType;
	fallbackEnabled?: boolean;
}

/**
 * Factory for creating job notification bridges
 * Default: ChromeRuntime bridge for all environments (unified cross-context communication)
 */
export class JobNotificationBridgeFactory {
	private static instance: JobNotificationBridgeFactory;
	private activeBridge: IJobNotificationBridge | null = null;
	private static globalBridge: IJobNotificationBridge | null = null;

	private constructor() {}

	static getInstance(): JobNotificationBridgeFactory {
		if (!JobNotificationBridgeFactory.instance) {
			JobNotificationBridgeFactory.instance =
				new JobNotificationBridgeFactory();
		}
		return JobNotificationBridgeFactory.instance;
	}

	/**
	 * Create a job notification bridge
	 * @param options - Bridge creation options
	 * @returns Job notification bridge instance
	 */
	createBridge(options: BridgeFactoryOptions = {}): IJobNotificationBridge {
		const {
			type = "chrome-runtime", // Default to chrome-runtime for all environments
			contextType = this.detectContextType(),
			fallbackEnabled = true,
		} = options;

		// Return the global singleton bridge if it exists and matches the requested type
		if (
			JobNotificationBridgeFactory.globalBridge &&
			this.isValidBridge(JobNotificationBridgeFactory.globalBridge) &&
			JobNotificationBridgeFactory.globalBridge.getStatus().connectionType ===
				this.getConnectionTypeForBridgeType(type)
		) {
			logInfo(
				"♻️ Reusing global singleton bridge:",
				JobNotificationBridgeFactory.globalBridge.getStatus().connectionType,
			);
			return JobNotificationBridgeFactory.globalBridge;
		}

		logInfo(`🏭 Creating job notification bridge`, {
			requestedType: type,
			contextType,
			fallbackEnabled,
		});

		let bridge: IJobNotificationBridge;

		try {
			bridge = this.createSpecificBridge(type);

			// Test the bridge
			if (this.isValidBridge(bridge)) {
				// Store as both active and global bridge
				this.activeBridge = bridge;
				JobNotificationBridgeFactory.globalBridge = bridge;
				logInfo(
					"✅ Bridge created successfully:",
					bridge.getStatus().connectionType,
				);
				return bridge;
			} else {
				throw new Error("Bridge validation failed");
			}
		} catch (error) {
			logError("❌ Failed to create bridge:", error);

			if (fallbackEnabled && type !== "broadcast-channel") {
				logInfo("🔄 Falling back to BroadcastChannel bridge");
				bridge = new BroadcastChannelBridge();
				this.activeBridge = bridge;
				JobNotificationBridgeFactory.globalBridge = bridge;
				return bridge;
			}

			throw error;
		}
	}

	private getConnectionTypeForBridgeType(type: BridgeType): string {
		switch (type) {
			case "broadcast-channel":
				return "BroadcastChannel";
			case "chrome-runtime":
				return "ChromeRuntime";
			case "chrome-port":
				return "ChromePort";
			default:
				return "Unknown";
		}
	}

	/**
	 * Create a specific bridge type
	 */
	private createSpecificBridge(type: BridgeType): IJobNotificationBridge {
		switch (type) {
			case "broadcast-channel":
				if (!this.isBroadcastChannelAvailable()) {
					throw new Error("BroadcastChannel not available");
				}
				return new BroadcastChannelBridge();

			case "chrome-runtime":
				if (!this.isChromeRuntimeAvailable()) {
					throw new Error("Chrome runtime not available");
				}
				return new ChromeRuntimeBridge();

			case "chrome-port":
				if (!this.isChromePortAvailable()) {
					throw new Error("Chrome port not available");
				}
				return new ChromePortBridge();

			default:
				throw new Error(`Unknown bridge type: ${type}`);
		}
	}

	/**
	 * Detect the current context type
	 */
	private detectContextType(): ContextType {
		if (typeof chrome !== "undefined" && chrome.runtime) {
			if (typeof document !== "undefined") {
				try {
					if (document.URL.endsWith("offscreen.html")) {
						return "offscreen";
					}
				} catch {
					// fall through to ui when document access fails
				}
				try {
					if (document.URL.startsWith("https://")) {
						return "embedded";
					}
				} catch {
					// fall through to ui when document access fails
				}
				return "ui";
			}

			if (typeof window === "undefined") {
				return "background";
			}
		}
		if (
			typeof document !== "undefined" &&
			document.URL.startsWith("https://")
		) {
			return "embedded";
		}
		return "background";
	}

	/**
	 * Check if BroadcastChannel is available
	 */
	private isBroadcastChannelAvailable(): boolean {
		return typeof BroadcastChannel !== "undefined";
	}

	/**
	 * Check if Chrome runtime is available
	 */
	private isChromeRuntimeAvailable(): boolean {
		return typeof chrome !== "undefined" && !!chrome.runtime;
	}

	/**
	 * Check if Chrome port is available
	 */
	private isChromePortAvailable(): boolean {
		return typeof chrome !== "undefined" && !!chrome.runtime?.connect;
	}

	/**
	 * Validate that a bridge is working properly
	 */
	private isValidBridge(bridge: IJobNotificationBridge): boolean {
		try {
			const status = bridge.getStatus();
			return status.isInitialized;
		} catch (error) {
			logError("Bridge validation failed:", error);
			return false;
		}
	}

	/**
	 * Get the currently active bridge
	 */
	getActiveBridge(): IJobNotificationBridge | null {
		return this.activeBridge;
	}

	/**
	 * Close and reset the active bridge
	 */
	resetBridge(): void {
		if (this.activeBridge) {
			try {
				this.activeBridge.close();
			} catch (error) {
				logError("Error closing active bridge:", error);
			}
			this.activeBridge = null;
			JobNotificationBridgeFactory.globalBridge = null;
			logInfo("🔄 Active and global bridges reset");
		}
	}
}

// Export singleton instance
export const bridgeFactory = JobNotificationBridgeFactory.getInstance();

// Cached default bridge instance
let _defaultBridge: IJobNotificationBridge | null = null;

/**
 * Get the default job notification bridge for all contexts
 * Uses ChromeRuntime bridge for unified cross-context communication
 */
export function getDefaultBridge(): IJobNotificationBridge {
	if (!_defaultBridge) {
		_defaultBridge = bridgeFactory.createBridge({
			type: "chrome-runtime",
			fallbackEnabled: true,
		});
	}
	return _defaultBridge;
}

// Export default bridge instance for direct use
export const defaultJobNotificationBridge = getDefaultBridge();
