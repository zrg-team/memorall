import type React from "react";
import { createContext, useContext } from "react";

/**
 * The studio's model picker, provided by the studio page. Composers show it in
 * their toolbar the way chat's composer shows its model pill, so every
 * workspace picks its model from the same place.
 */
export const StudioModelPickerContext = createContext<React.ReactNode>(null);

export const useStudioModelPicker = () => useContext(StudioModelPickerContext);
