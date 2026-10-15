import { NotebookText, Shapes } from "lucide-react";
import type React from "react";
import { hostedAppForPath } from "@/services/memon/apps/hosted/catalog";

/**
 * How a file a hosted app opens looks in the library, where its document
 * type alone does not say: a Word document or a board is type "other".
 * Null: the type's own look.
 */
export const hostedFileLook = (
	name: string,
): {
	icon: React.ComponentType<{ className?: string }>;
	color: string;
} | null => {
	switch (hostedAppForPath(name)) {
		case "documents":
			return { icon: NotebookText, color: "text-blue-600" };
		case "whiteboard":
			return { icon: Shapes, color: "text-amber-500" };
		default:
			return null;
	}
};
