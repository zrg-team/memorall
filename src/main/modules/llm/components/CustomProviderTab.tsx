import type { ComponentProps } from "react";
import { OpenAICompatibleProviderTab } from "./OpenAITab";

export function CustomProviderTab(
	props: Omit<ComponentProps<typeof OpenAICompatibleProviderTab>, "provider">,
) {
	return <OpenAICompatibleProviderTab {...props} provider="custom" />;
}
