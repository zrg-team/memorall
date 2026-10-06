import type { DefaultSkillManifestEntry } from "./types";

const REPO = "bergside/awesome-design-skills";
const SOURCE_ROOT =
	"https://github.com/bergside/awesome-design-skills/tree/main";
const RAW_ROOT =
	"https://raw.githubusercontent.com/bergside/awesome-design-skills/main";

const DESIGN_SKILL_SOURCES = [
	{
		slug: "agentic",
		description:
			"Conversational AI-first interface with minimal controls, clear outcomes, and delegated task flows for agentic workflows.",
	},
	{
		slug: "ant",
		description:
			"Structured, enterprise-focused design system emphasizing clarity, consistency, and efficiency for data-dense web applications.",
	},
	{
		slug: "artistic",
		description:
			"High-contrast, expressive style with creative typography and bold color choices for visually striking interfaces.",
	},
	{
		slug: "basic",
		description:
			"Print-inspired visual language for books, magazines, and reports with editorial grids and expressive typography.",
	},
	{
		slug: "bento",
		description:
			"Modular grid layout with card-like blocks, clear hierarchy, soft spacing, and subtle visual contrast for organized, scannable interfaces.",
	},
	{
		slug: "bold",
		description:
			"Strong visual presence with heavyweight typography, high-contrast colors, and commanding layouts.",
	},
	{
		slug: "brutalism",
		description:
			"Raw, anti-design aesthetic inspired by concrete architecture with unadorned elements, jarring layouts, and functional minimalism.",
	},
	{
		slug: "cafe",
		description:
			"Cozy cafe-inspired interface with warm tones, soft typography, and clean layouts for a relaxed browsing experience.",
	},
	{
		slug: "claude",
		description:
			"Research-journal aesthetic on warm ivory parchment: authoritative, editorial, almost achromatic, with near-black slate as the dominant ink.",
	},
	{
		slug: "claymorphism",
		description:
			"Soft, rounded 3D-like shapes mimicking malleable clay with playful, puffy elements and colorful surfaces.",
	},
	{
		slug: "clean",
		description:
			"Simplicity-focused design with ample whitespace, legible typography, and a limited color palette to reduce visual clutter.",
	},
	{
		slug: "codex",
		description:
			"Radically minimal, edge-to-edge blank-canvas interface with almost no color, where typography carries the visual weight and black is the only fill.",
	},
	{
		slug: "colorful",
		description:
			"Vibrant, high-contrast palettes and gradients for engaging, memorable, and modern user experiences.",
	},
	{
		slug: "contemporary",
		description:
			"Current-era minimalist design with bento grids, dark mode support, and high-performance accessible layouts.",
	},
	{
		slug: "corporate",
		description:
			"Professional, brand-aligned design with structured grids, minimalist layouts, and consistent enterprise patterns.",
	},
	{
		slug: "cosmic",
		description:
			"Futuristic sci-fi aesthetic with dark themes, vibrant neon accents, and immersive spatial elements.",
	},
	{
		slug: "creative",
		description:
			"Playful, character-driven design with expressive typography and bold graphics for landing pages and creative projects.",
	},
	{
		slug: "dithered",
		description:
			"Dot-pattern rendering technique that simulates shades with a limited palette for nostalgic, retro, high-contrast visuals.",
	},
	{
		slug: "doodle",
		description:
			"Hand-drawn, sketch-like style with doodles, handwritten fonts, and imperfect lines for a playful, informal feel.",
	},
	{
		slug: "dramatic",
		description:
			"High-contrast, theatrical design with bold layouts, immersive visuals, and unconventional compositions that command attention.",
	},
	{
		slug: "editorial",
		description:
			"Magazine-inspired editorial layout with refined serif typography, structured grids, and elegant reading experiences.",
	},
	{
		slug: "enterprise",
		description:
			"Clean, high-contrast enterprise design for data-driven workflows with intuitive drag-and-drop patterns and structured layouts.",
	},
	{
		slug: "expressive",
		description:
			"Vibrant, personality-driven design with bold colors, playful graphics, and dynamic layouts that balance creativity with structure.",
	},
	{
		slug: "fantasy",
		description:
			"Game-inspired fantasy aesthetic with bold, premium visuals, rich color palettes, and immersive thematic elements.",
	},
	{
		slug: "fiction",
		description:
			"Playful, cartoonesque style inspired by children's-book illustrations: warm cream backgrounds, bold display type, saturated color blocks and thick outlines.",
	},
	{
		slug: "flat",
		description:
			"Two-dimensional minimalist style with vibrant colors, clean typography, and no 3D effects for fast, user-friendly interfaces.",
	},
	{
		slug: "friendly",
		description:
			"Approachable, intuitive design with rounded elements, ample whitespace, and soft pastel color palettes.",
	},
	{
		slug: "futuristic",
		description:
			"Forward-looking design with tech-inspired typography, modern layouts, and a sleek, innovation-driven aesthetic.",
	},
	{
		slug: "geometric",
		description:
			"Geometric, structured design with clean typography, neutral colors, precise shapes, and intuitive layouts that stay out of the way.",
	},
	{
		slug: "glassmorphism",
		description:
			"Frosted glass effect with translucent layers, subtle blur, and luminous borders for depth and modern elegance.",
	},
	{
		slug: "gradient",
		description:
			"Smooth color transitions and gradient-rich surfaces for modern, playful interfaces with visual depth.",
	},
	{
		slug: "immersive",
		description:
			"Exhibit-style interactive interface blending storytelling, animation, and gamified elements on one continuous brand-colored canvas.",
	},
	{
		slug: "impeccable",
		description:
			"Modern, graphic editorial-poster aesthetic, warm and confident, alternating cream and burnt-orange sections with an amber brand color.",
	},
	{
		slug: "levels",
		description:
			"Conversion-focused design that removes friction and guides users toward action through clarity, trust, and speed.",
	},
	{
		slug: "lingo",
		description:
			"Playful, minimal design with bright colors, rounded shapes, tactile 3D borders, and friendly illustrations for approachable interfaces.",
	},
	{
		slug: "material",
		description:
			"Google's Material Design with layered surfaces, dynamic theming, built-in motion, and responsive cross-platform patterns.",
	},
	{
		slug: "matrix",
		description:
			"Cyber-slick, dark-only Matrix-inspired interface with minimalist fashion and high-tech digital elements.",
	},
	{
		slug: "minimal",
		description:
			"Stripped-back design emphasizing whitespace, clean typography, and restrained color for maximum clarity and focus.",
	},
	{
		slug: "modern",
		description:
			"Contemporary editorial style with serif typography, minimal palettes, and clean layouts for polished digital products.",
	},
	{
		slug: "mono",
		description:
			"Monospace-driven, matrix-inspired design with high-contrast elements, compact density, and a hacker-chic aesthetic.",
	},
	{
		slug: "neobrutalism",
		description:
			"Modern take on brutalism with bold borders, vivid accent colors, and raw, high-contrast layouts on warm surfaces.",
	},
	{
		slug: "neon",
		description:
			"Electric neon glow effects with high-contrast color pairings for bold, attention-grabbing interfaces.",
	},
	{
		slug: "neumorphism",
		description:
			"Soft, extruded UI elements with inner and outer shadows on monochromatic surfaces for a tactile, embedded look.",
	},
	{
		slug: "pacman",
		description:
			"Retro arcade-inspired design with pixel fonts, dotted borders, playful high-contrast colors, and 8-bit game aesthetics.",
	},
	{
		slug: "paper",
		description:
			"Paper-textured, print-inspired design with minimal colors, clean serif/sans typography, and tactile surface qualities.",
	},
	{
		slug: "perspective",
		description:
			"Spatial depth design with isometric views, vanishing points, and layered elements that guide attention through 3D-like realism.",
	},
	{
		slug: "power",
		description:
			"High-end dark aesthetic with bold headings, monochromatic palette, and premium feel for luxury brand experiences.",
	},
	{
		slug: "premium",
		description:
			"Apple-inspired premium aesthetic with precise spacing, modern typography, and a refined, polished visual language.",
	},
	{
		slug: "professional",
		description:
			"Polished, business-ready design with modern typography, structured layouts, and a trustworthy visual identity.",
	},
	{
		slug: "pulse",
		description:
			"Dynamic, vibrant style with thick borders, geometric shapes, high-contrast colors, and expressive typography conveying motion and vitality.",
	},
	{
		slug: "refined",
		description:
			"Carefully curated, modern minimal style with elegant serif typography and understated, sophisticated palettes.",
	},
	{
		slug: "retro",
		description:
			"Throwback design with vintage-inspired typography, high-contrast retro palettes, and nostalgic visual elements.",
	},
	{
		slug: "riso",
		description:
			"Playful two-color risograph print aesthetic on a single warm off-white paper surface running through every section.",
	},
	{
		slug: "roku",
		description:
			"App dashboard with purple-themed aesthetic, top-bar navigation, card-based layouts, and developer-first workflows.",
	},
	{
		slug: "sega",
		description:
			"Arcade-inspired interface for games: VT323 pixel type, hard 0px corners, and chunky pill buttons that press into solid offset blocks.",
	},
	{
		slug: "shadcn",
		description:
			"Shadcn/ui-inspired design with minimal, clean components, monochrome palette, and utility-first patterns.",
	},
	{
		slug: "sketch",
		description:
			"Friendly hand-drawn sketch interface on warm cream paper, with soft teal accents, handwritten display headings, and rounded pill controls.",
	},
	{
		slug: "skeumorphism",
		description:
			"Real-world mimicry with textured surfaces, 3D effects, and familiar physical metaphors for intuitive digital interfaces.",
	},
	{
		slug: "sleek",
		description:
			"Modern minimalist aesthetic with clean lines, intentional color palette, subtle interactions, and consistent spacing.",
	},
	{
		slug: "spacious",
		description:
			"Generous whitespace, consistent padding, and grid-based layouts for clean, readable, and breathing interfaces.",
	},
	{
		slug: "square",
		description:
			"Graceful, refined aesthetic with delicate typography, minimal palettes, and polished layouts that exude sophistication.",
	},
	{
		slug: "stitch",
		description:
			"Clean, high-contrast design for data-driven workflows with drag-and-drop patterns and structured layouts.",
	},
	{
		slug: "storytelling",
		description:
			"Narrative-driven design using visuals, copy, and interaction to guide users through engaging, emotionally resonant journeys.",
	},
	{
		slug: "terracotta",
		description:
			"Sun-baked, clay-toned editorial interface: warm cream surfaces, ink-brown display-serif headlines, and a single terracotta accent.",
	},
	{
		slug: "tetris",
		description:
			"Classic block-game inspired design with playful colors, bold display fonts, and compact, high-energy layouts.",
	},
	{
		slug: "vibrant",
		description:
			"Lively, colorful design with bold playful typography, warm accents, and dynamic visual energy.",
	},
	{
		slug: "vintage",
		description:
			"1950s-1990s nostalgia with skeuomorphic touches, grainy textures, retro color palettes, and pixel-style typography.",
	},
] as const;

export const DESIGN_DEFAULT_SKILLS: DefaultSkillManifestEntry[] =
	DESIGN_SKILL_SOURCES.map(({ slug, description }) => ({
		name: slug,
		description,
		publisher: "Bergside",
		collection: "design-skills",
		repo: REPO,
		sourceUrl: `${SOURCE_ROOT}/skills/${slug}`,
		rawUrls: [
			`${RAW_ROOT}/skills/${slug}/SKILL.md`,
			`${RAW_ROOT}/skills/${slug}/DESIGN.md`,
		],
	}));
