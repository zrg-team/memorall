const requested = process.argv[2];
const current =
	process.platform === "win32"
		? "windows"
		: process.platform === "darwin"
			? "macos"
			: process.platform === "linux"
				? "linux"
				: process.platform;

if (!requested || !["windows", "macos", "linux"].includes(requested)) {
	throw new Error("Expected one of: windows, macos, linux");
}
if (requested !== current) {
	throw new Error(
		`Tauri desktop packages must be built on their native OS. Requested ${requested}, current host is ${current}.`,
	);
}
console.log(`Desktop native-build guard passed for ${current}.`);
