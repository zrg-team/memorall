import type { useMemonMachineStore } from "@/main/stores/memon-machine";

/** Sends one computer operation as the user (see memon operation-types). */
export type MemonSend = ReturnType<
	typeof useMemonMachineStore.getState
>["send"];
