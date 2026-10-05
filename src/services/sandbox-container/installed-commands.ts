/**
 * Commands every sandbox has installed with the app, beyond the shell's own
 * tools: run as host commands (host-commands/media-command.ts), never
 * installed by anyone, and described here once for the agents' prompts and
 * the sandbox's capabilities.
 */

/** A command installed by default, as an agent is told about it. */
export interface InstalledCommand {
	/** The names it runs by, its own first. */
	names: readonly string[];
	/** What it is and does, in a line. */
	summary: string;
	/** How to use it here, one tip each. */
	notes: readonly string[];
}

/** The font ffmpeg's drawtext and subtitles can use without one of the user's. */
export const FFMPEG_FONT = "/usr/share/fonts/LiberationSans-Regular.ttf";

export const INSTALLED_COMMANDS: readonly InstalledCommand[] = [
	{
		names: ["ffmpeg", "ffprobe"],
		summary:
			"FFmpeg.wasm: convert, cut, join, scale, mix and encode video and audio; ffprobe -of json reads their streams",
		notes: [
			"It always overwrites (-y) and runs on one thread: trim (-t) and scale down to keep encodes short.",
			"Encoders: libx264, libx265, libvpx-vp9, libwebp, gif, png, aac, libmp3lame, libopus, libvorbis, flac. No hardware encoders and no URLs: download with curl first.",
			`Text: drawtext=fontfile=${FFMPEG_FONT}:text='Hi'; subtitles=subs.srt:fontsdir=/usr/share/fonts.`,
		],
	},
	{
		names: [
			"magick",
			"convert",
			"identify",
			"mogrify",
			"composite",
			"montage",
			"compare",
		],
		summary:
			"ImageMagick 7 (magick-wasm): convert, resize, crop, compose, annotate, compare and inspect images (PNG, JPEG, WebP, AVIF, GIF, TIFF, SVG, ICO; HEIC in; PDF out)",
		notes: [
			"magick in.png -resize 50% out.webp; magick identify -format '%wx%h' a.png; mogrify -resize 800x *.jpg; magick -delay 20 -loop 0 frame-*.png anim.gif.",
			"It cannot read PDFs (no Ghostscript): render the pages with py and pymupdf first. Text is Liberation Sans unless -font names a .ttf file. magick -list option names the options.",
		],
	},
];

/** Every name the installed commands run by. */
export const INSTALLED_COMMAND_NAMES: readonly string[] =
	INSTALLED_COMMANDS.flatMap((command) => command.names);
