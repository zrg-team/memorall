// Test file for SharedStorageService - for development/debugging only
import { sharedStorageService } from "./shared-storage-service";

/**
 * Test function to verify SharedStorageService functionality
 * This can be called from the browser console for testing
 */
export async function testSharedStorage() {
	console.log("🧪 Testing SharedStorageService...");

	try {
		// Initialize the service
		await sharedStorageService.initialize();
		console.log("✅ Service initialized");

		// Test basic get/set
		await sharedStorageService.set("test-key", {
			message: "Hello, World!",
			timestamp: Date.now(),
		});
		console.log("✅ Set test data");

		const retrieved = await sharedStorageService.get("test-key");
		console.log("✅ Retrieved test data:", retrieved);

		// Test subscription
		const unsubscribe = sharedStorageService.subscribe("test-key", (event) => {
			console.log("🔔 Storage change detected:", event);
		});

		// Update the value to test subscription
		await sharedStorageService.set("test-key", {
			message: "Updated!",
			timestamp: Date.now(),
		});

		// Clean up
		setTimeout(async () => {
			unsubscribe();
			await sharedStorageService.remove("test-key");
			console.log("🧹 Cleanup completed");
		}, 1000);

		console.log("🎉 SharedStorageService test completed successfully");
	} catch (error) {
		console.error("❌ SharedStorageService test failed:", error);
	}
}

// Make it available globally for console testing
if (typeof window !== "undefined") {
	(window as any).testSharedStorage = testSharedStorage;
}
