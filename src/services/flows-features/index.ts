/**
 * flows-features — memorall product domain features.
 * Import once to register all domain agent features.
 */
import "./steps/features/index";
import "./tools/render-memorall-artifact";

let registered = false;

export function register(): void {
	if (registered) return;
	registered = true;
}

register();
