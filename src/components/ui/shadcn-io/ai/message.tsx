import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { ComponentProps, HTMLAttributes } from "react";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
	from: string;
};

export const Message = ({ className, from, ...props }: MessageProps) => (
	<div
		className={cn(
			"group flex w-full items-end justify-end gap-2 py-0",
			from === "user" ? "is-user" : "is-assistant flex-row-reverse justify-end",
			"[&>div]:max-w-[80%]",
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
			"flex flex-col gap-2 overflow-hidden rounded-lg text-foreground text-sm",
			"group-[.is-user]:bg-transparent group-[.is-user]:border group-[.is-user]:border-border group-[.is-user]:px-4 group-[.is-user]:py-3",
			"group-[.is-assistant]:bg-secondary group-[.is-assistant]:px-4 group-[.is-assistant]:py-3",
			className,
		)}
		{...props}
	>
		<div className="is-user:dark whitespace-pre-wrap">{children}</div>
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
