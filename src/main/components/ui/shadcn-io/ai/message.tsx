import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@/main/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { ComponentProps, HTMLAttributes } from "react";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
	from: string;
};

export const Message = ({ className, from, ...props }: MessageProps) => (
	<div
		className={cn(
			"group flex w-full items-end gap-2 py-0",
			from === "user" ? "is-user justify-end" : "is-assistant justify-start",
			from === "user"
				? "[&>div]:max-w-[min(82%,42rem)]"
				: "[&>div]:max-w-[min(100%,50rem)]",
			className,
		)}
		{...props}
	/>
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
	children,
	className,
	...props
}: MessageContentProps) => (
	<div
		className={cn(
			"relative flex flex-col gap-2 overflow-hidden text-sm leading-relaxed transition-colors",
			"group-[.is-user]:rounded-2xl group-[.is-user]:rounded-br-md group-[.is-user]:border group-[.is-user]:border-primary/20 group-[.is-user]:bg-primary/[0.08] group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground group-[.is-user]:shadow-sm",
			"group-[.is-assistant]:overflow-visible group-[.is-assistant]:rounded-none group-[.is-assistant]:border-0 group-[.is-assistant]:bg-transparent group-[.is-assistant]:px-0 group-[.is-assistant]:py-0 group-[.is-assistant]:text-foreground group-[.is-assistant]:shadow-none",
			className,
		)}
		{...props}
	>
		<div className="whitespace-pre-wrap break-words">{children}</div>
	</div>
);

export type MessageAvatarProps = ComponentProps<typeof Avatar> & {
	src: string;
	name?: string;
};

export const MessageAvatar = ({
	src,
	name,
	className,
	...props
}: MessageAvatarProps) => (
	<Avatar
		className={cn("size-8 ring ring-1 ring-border", className)}
		{...props}
	>
		<AvatarImage alt="" className="mt-0 mb-0" src={src} />
		<AvatarFallback>{name?.slice(0, 2) || "ME"}</AvatarFallback>
	</Avatar>
);
