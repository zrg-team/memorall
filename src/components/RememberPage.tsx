import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Brain, Clock, Globe, Send, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface RememberContext {
	context?: string;
	pageUrl: string;
	pageTitle: string;
	timestamp: string;
}

export const RememberPage: React.FC = () => {
	const navigate = useNavigate();
	const [userInput, setUserInput] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [rememberContext, setRememberContext] =
		useState<RememberContext | null>(null);

	// Load context data from session storage
	useEffect(() => {
		const loadContext = async () => {
			try {
				const result = await chrome.storage?.session?.get?.([
					"rememberContext",
				]);
				if (result?.rememberContext) {
					setRememberContext(result.rememberContext);
				}
			} catch (error) {
				console.error("Failed to load remember context:", error);
			}
		};

		loadContext();
	}, []);

	const handleSubmit = async () => {
		if (!userInput.trim()) {
			console.log("⚠️ No user input provided");
			return;
		}

		console.log("🚀 RememberPage handleSubmit called");
		setIsSubmitting(true);

		try {
			console.log("🔄 Submitting user input:", userInput.trim());
			console.log("🔄 Context:", rememberContext?.context);
			console.log("🔄 Chrome runtime available:", !!chrome.runtime);

			const messageData = {
				type: "USER_INPUT_EXTRACTED",
				data: {
					userInput: userInput.trim(),
					context: rememberContext?.context,
					inputMethod: "popup",
					timestamp: new Date().toISOString(),
				},
			};
			console.log("📤 Sending message:", messageData);

			// Send user input to background script
			const response = await chrome.runtime.sendMessage(messageData);

			console.log("📦 Response from background:", response);

			if (response?.success) {
				console.log(
					"✅ Successfully submitted, clearing context and navigating",
				);
				// Clear the context data from storage
				await chrome.storage?.session?.remove?.(["rememberContext"]);

				// Navigate to knowledge graph to see the result
				navigate("/knowledge-graph");
			} else {
				console.error("❌ Failed to process user input:", response?.error);
				alert(`Failed to save: ${response?.error || "Unknown error"}`);
				setIsSubmitting(false);
			}
		} catch (error) {
			console.error("❌ Failed to process user input:", error);
			alert(
				`Error: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
			setIsSubmitting(false);
		}
	};

	const handleCancel = () => {
		// Clear context and navigate back
		chrome.storage?.session?.remove?.(["rememberContext"]);
		navigate("/");
	};

	const formatTimestamp = (timestamp: string) => {
		try {
			return new Date(timestamp).toLocaleString();
		} catch {
			return timestamp;
		}
	};

	const getDomain = (url: string) => {
		try {
			return new URL(url).hostname;
		} catch {
			return url;
		}
	};

	return (
		<div className="flex flex-col h-full bg-background">
			<div className="flex-1 flex items-center justify-center p-4">
				<Card className="w-full max-w-2xl">
					<CardHeader>
						<div className="flex items-center gap-3">
							<div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
								<Brain className="w-5 h-5 text-primary-foreground" />
							</div>
							<div className="flex-1">
								<CardTitle className="text-xl">
									Remember with Memorall
								</CardTitle>
								<p className="text-sm text-muted-foreground mt-1">
									Add your thoughts and insights to your knowledge graph
								</p>
							</div>
						</div>
					</CardHeader>

					<CardContent className="space-y-6">
						{/* Context Information */}
						{rememberContext && (
							<div className="space-y-4">
								<div className="space-y-2">
									<h4 className="text-sm font-medium flex items-center gap-2">
										<Globe className="w-4 h-4" />
										Page Context
									</h4>
									<div className="bg-muted/50 rounded-lg p-3 space-y-2">
										<div className="flex items-start justify-between gap-2">
											<div className="flex-1 min-w-0">
												<p
													className="font-medium text-sm truncate"
													title={rememberContext.pageTitle}
												>
													{rememberContext.pageTitle}
												</p>
												<p
													className="text-xs text-muted-foreground truncate"
													title={rememberContext.pageUrl}
												>
													{getDomain(rememberContext.pageUrl)}
												</p>
											</div>
											<Badge variant="secondary" className="text-xs">
												<Clock className="w-3 h-3 mr-1" />
												{formatTimestamp(rememberContext.timestamp)}
											</Badge>
										</div>
									</div>
								</div>

								{/* Selected Content */}
								{rememberContext.context && (
									<div className="space-y-2">
										<h4 className="text-sm font-medium">Selected Content</h4>
										<div className="bg-primary/5 border-l-4 border-primary rounded-r-lg p-3">
											<p className="text-sm text-muted-foreground leading-relaxed">
												"
												{rememberContext.context.length > 300
													? `${rememberContext.context.substring(0, 300)}...`
													: rememberContext.context}
												"
											</p>
										</div>
									</div>
								)}

								<Separator />
							</div>
						)}

						{/* User Input */}
						<div className="space-y-3">
							<h4 className="text-sm font-medium">
								{rememberContext?.context
									? "Add your thoughts about this content"
									: "What would you like to remember?"}
							</h4>
							<Textarea
								value={userInput}
								onChange={(e) => setUserInput(e.target.value)}
								placeholder="Type your thoughts, insights, or notes here..."
								className="min-h-[120px] resize-none"
								disabled={isSubmitting}
								autoFocus
							/>
						</div>

						{/* Actions */}
						<div className="flex justify-end gap-3 pt-2">
							<Button
								variant="outline"
								onClick={handleCancel}
								disabled={isSubmitting}
							>
								<X className="w-4 h-4 mr-2" />
								Cancel
							</Button>
							<Button
								onClick={handleSubmit}
								disabled={!userInput.trim() || isSubmitting}
							>
								<Send className="w-4 h-4 mr-2" />
								{isSubmitting ? "Remembering..." : "Remember"}
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
};
