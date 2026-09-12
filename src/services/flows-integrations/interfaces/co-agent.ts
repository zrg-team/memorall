/**
 * Compatibility barrel. This file used to hold a near-copy of the co-agent
 * protocol that had silently drifted from the one under `services/co-agent`:
 * it was missing the `activate` command, so its request guard rejected a
 * request the other copy accepted. One definition now.
 */
export * from "@/co-agent/protocol";
