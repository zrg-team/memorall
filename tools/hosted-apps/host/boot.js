/**
 * The first import of the app's main.js (the build puts it there): installs
 * the Puter SDK Memorall answers (puter-host.js), waits for the host to say
 * which file the app was opened with, and lets the app prepare for it.
 *
 * A module's body runs only once its imports, top-level awaits included,
 * have finished, so main.js starts after this whatever its bundler merges or
 * reorders. (Importing main.js from here instead broke when the bundler
 * inlined it into this chunk and ran it first.)
 */
import { ready } from "./puter-host.js";
import { prepare } from "./prepare.js";

await prepare(await ready);
