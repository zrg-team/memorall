import React from "react";
import { Link, useLocation } from "react-router-dom";
import {
	MessageCircle,
	Bot,
	VectorSquareIcon,
	Database,
	BookOpen,
	Bug,
	Network,
	ChevronDown,
	Sun,
	Moon,
	Monitor,
	Tags,
} from "lucide-react";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/components/molecules/Copilot/ThemeContext";
import { CopilotTrigger } from "@/components/atoms/copilot";

interface LayoutProps {
	children: React.ReactNode;
}

const navigation = [
	{ name: "Chat", path: "/", icon: MessageCircle },
	{ name: "Models", path: "/llm", icon: Bot },
	{ name: "Topics", path: "/topics", icon: Tags },
	{ name: "Knowledge Graph", path: "/knowledge-graph", icon: Network },
	{ name: "Remembered", path: "/remembered", icon: BookOpen },
];

const debugItems = [
	{ name: "Embeddings", path: "/embeddings", icon: VectorSquareIcon },
	{ name: "Database", path: "/database", icon: Database },
	{ name: "Logs", path: "/logs", icon: Bug },
];

export const Layout: React.FC<LayoutProps> = ({ children }) => {
	const location = useLocation();
	const { theme, setTheme, actualTheme } = useTheme();

	const allPaths = [...navigation, ...debugItems];
	const checkIsExistNavigation = allPaths.some(
		(item) => item.path === location.pathname,
	);

	const isDebugSelected = debugItems.some(
		(item) => item.path === location.pathname,
	);

	const getThemeIcon = () => {
		switch (theme) {
			case "light":
				return <Sun size={16} />;
			case "dark":
				return <Moon size={16} />;
			case "system":
				return <Monitor size={16} />;
		}
	};

	return (
		<div className="h-screen bg-background flex flex-col">
			<nav className="border-b flex-shrink-0 bg-muted/20">
				<div className="px-3">
					<div className="flex h-12 items-center justify-between">
						<div className="flex items-center space-x-1">
							<TooltipProvider>
								{navigation.map((item) => {
									const isSelected =
										location.pathname === item.path ||
										(!checkIsExistNavigation && item.path === "/");
									const IconComponent = item.icon;
									return (
										<Tooltip key={item.path}>
											<TooltipTrigger asChild>
												<Link
													to={item.path}
													className={`${
														isSelected
															? "bg-background text-foreground shadow-sm border border-border"
															: "text-muted-foreground hover:text-foreground hover:bg-muted/50"
													} p-2 text-sm font-medium flex items-center rounded-md transition-all duration-200 ease-in-out`}
												>
													<IconComponent
														size={16}
														className={`flex-shrink-0 transition-transform duration-200 ease-in-out ${
															isSelected ? "scale-110" : "hover:scale-110"
														}`}
													/>
												</Link>
											</TooltipTrigger>
											<TooltipContent side="bottom">
												<p>{item.name}</p>
											</TooltipContent>
										</Tooltip>
									);
								})}

								{/* Debug dropdown */}
								<DropdownMenu>
									<Tooltip>
										<TooltipTrigger asChild>
											<DropdownMenuTrigger asChild>
												<button
													className={`${
														isDebugSelected
															? "bg-background text-foreground shadow-sm border border-border"
															: "text-muted-foreground hover:text-foreground hover:bg-muted/50"
													} p-2 text-sm font-medium flex items-center rounded-md transition-all duration-200 ease-in-out`}
												>
													<Bug
														size={16}
														className={`flex-shrink-0 transition-transform duration-200 ease-in-out ${
															isDebugSelected ? "scale-110" : "hover:scale-110"
														}`}
													/>
													<ChevronDown size={12} className="ml-1" />
												</button>
											</DropdownMenuTrigger>
										</TooltipTrigger>
										<TooltipContent side="bottom">
											<p>Debug</p>
										</TooltipContent>
									</Tooltip>
									<DropdownMenuContent align="start">
										{debugItems.map((item) => {
											const IconComponent = item.icon;
											return (
												<DropdownMenuItem key={item.path} asChild>
													<Link
														to={item.path}
														className="flex items-center gap-2 cursor-pointer"
													>
														<IconComponent size={14} />
														<span>{item.name}</span>
													</Link>
												</DropdownMenuItem>
											);
										})}
									</DropdownMenuContent>
								</DropdownMenu>
							</TooltipProvider>
						</div>

						{/* Theme Toggle and Copilot */}
						<div className="flex items-center gap-2">
							<CopilotTrigger />
							<TooltipProvider>
								<DropdownMenu>
									<Tooltip>
										<TooltipTrigger asChild>
											<DropdownMenuTrigger asChild>
												<button className="text-muted-foreground hover:text-foreground hover:bg-muted/50 p-2 text-sm font-medium flex items-center rounded-md transition-all duration-200 ease-in-out">
													{getThemeIcon()}
												</button>
											</DropdownMenuTrigger>
										</TooltipTrigger>
										<TooltipContent side="bottom">
											<p>
												Theme:{" "}
												{theme === "system" ? `System (${actualTheme})` : theme}
											</p>
										</TooltipContent>
									</Tooltip>
									<DropdownMenuContent align="end">
										<DropdownMenuItem
											onClick={() => setTheme("light")}
											className="flex items-center gap-2 cursor-pointer"
										>
											<Sun size={14} />
											<span>Light</span>
										</DropdownMenuItem>
										<DropdownMenuItem
											onClick={() => setTheme("dark")}
											className="flex items-center gap-2 cursor-pointer"
										>
											<Moon size={14} />
											<span>Dark</span>
										</DropdownMenuItem>
										<DropdownMenuItem
											onClick={() => setTheme("system")}
											className="flex items-center gap-2 cursor-pointer"
										>
											<Monitor size={14} />
											<span>System</span>
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</TooltipProvider>
						</div>
					</div>
				</div>
			</nav>

			<main className="flex-1 min-h-0 overflow-auto">{children}</main>
		</div>
	);
};
