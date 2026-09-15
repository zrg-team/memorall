import { ImageOff, Loader2 } from "lucide-react";
import type React from "react";
import { cn } from "@/lib/utils";
import { useMediaUrl } from "../../hooks/use-media-url";

interface StoredImageProps
	extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> {
	path: string;
	mimeType: string;
	alt: string;
	/** Class for the placeholder shown while loading or on failure. */
	placeholderClassName?: string;
}

/** An image kept in the documents filesystem. */
export const StoredImage: React.FC<StoredImageProps> = ({
	path,
	mimeType,
	alt,
	className,
	placeholderClassName,
	...rest
}) => {
	const { url, error } = useMediaUrl(path, mimeType);
	if (!url) {
		return (
			<div
				className={cn(
					"flex items-center justify-center bg-muted/50 text-muted-foreground",
					className,
					placeholderClassName,
				)}
				aria-label={alt}
				role="img"
			>
				{error ? (
					<ImageOff size={18} />
				) : (
					<Loader2 size={18} className="animate-spin" />
				)}
			</div>
		);
	}
	return <img src={url} alt={alt} className={className} {...rest} />;
};

/** The object URL for a stored file, for download links and canvases. */
export { useMediaUrl } from "../../hooks/use-media-url";
