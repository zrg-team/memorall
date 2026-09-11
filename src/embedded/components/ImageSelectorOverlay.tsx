import React, { useState, useRef, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { captureViewport } from "../utils/capture-region";
import { logWarn } from "@/utils/logger";
import { useEmbeddedTranslation } from "@/embedded/hooks/use-embedded-language";

interface ImageSelectorProps {
	onImageSelected: (selectedImageData: string) => void;
	onCancel: () => void;
}

const ImageSelectorOverlay: React.FC<ImageSelectorProps> = ({
	onImageSelected,
	onCancel,
}) => {
	const t = useEmbeddedTranslation("imageSelector");
	const [capturedImage, setCapturedImage] = useState<string | null>(null);
	const [isCapturing, setIsCapturing] = useState(true);
	const [isSelecting, setIsSelecting] = useState(false);
	const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(
		null,
	);
	const [endPos, setEndPos] = useState<{ x: number; y: number } | null>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const imageRef = useRef<HTMLImageElement>(null);

	// Capture the page as an image
	useEffect(() => {
		const captureScreen = async () => {
			try {
				// What the compositor painted, not a re-render of the DOM: the
				// latter silently drops every cross-origin image, so a map came
				// back blank.
				const base64Image = await captureViewport();
				setCapturedImage(base64Image);
				setIsCapturing(false);
			} catch (error) {
				logWarn("Failed to capture screenshot:", error);
				onCancel();
			}
		};

		captureScreen();
	}, [onCancel]);

	// Handle mouse down - start selection
	const handleMouseDown = useCallback((e: React.MouseEvent) => {
		if (!canvasRef.current) return;
		const rect = canvasRef.current.getBoundingClientRect();
		setIsSelecting(true);
		setStartPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
		setEndPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
	}, []);

	// Handle mouse move - update selection
	const handleMouseMove = useCallback(
		(e: React.MouseEvent) => {
			if (!isSelecting || !canvasRef.current) return;
			const rect = canvasRef.current.getBoundingClientRect();
			setEndPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
		},
		[isSelecting],
	);

	// Handle mouse up - finish selection
	const handleMouseUp = useCallback(async () => {
		if (!isSelecting || !startPos || !endPos || !imageRef.current) {
			setIsSelecting(false);
			return;
		}

		setIsSelecting(false);

		// Calculate selection bounds
		const x = Math.min(startPos.x, endPos.x);
		const y = Math.min(startPos.y, endPos.y);
		const width = Math.abs(endPos.x - startPos.x);
		const height = Math.abs(endPos.y - startPos.y);

		// Ignore very small selections (likely accidental clicks)
		if (width < 10 || height < 10) {
			setStartPos(null);
			setEndPos(null);
			return;
		}

		try {
			// Create a new canvas to crop the selected region
			const cropCanvas = document.createElement("canvas");
			cropCanvas.width = width;
			cropCanvas.height = height;
			const cropCtx = cropCanvas.getContext("2d");

			if (!cropCtx) {
				throw new Error("Failed to get canvas context");
			}

			// Draw the selected region
			const img = imageRef.current;
			cropCtx.drawImage(img, x, y, width, height, 0, 0, width, height);

			// Convert to base64
			const croppedImageData = cropCanvas.toDataURL("image/png");

			// Send the cropped image
			onImageSelected(croppedImageData);
		} catch (error) {
			logWarn("Failed to crop image:", error);
		}
	}, [isSelecting, startPos, endPos, onImageSelected]);

	// Draw selection rectangle
	useEffect(() => {
		if (!canvasRef.current || !startPos || !endPos) return;

		const canvas = canvasRef.current;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		// Clear canvas
		ctx.clearRect(0, 0, canvas.width, canvas.height);

		// Draw selection rectangle
		const x = Math.min(startPos.x, endPos.x);
		const y = Math.min(startPos.y, endPos.y);
		const width = Math.abs(endPos.x - startPos.x);
		const height = Math.abs(endPos.y - startPos.y);

		// Draw semi-transparent overlay except selected area
		ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.clearRect(x, y, width, height);

		// Draw selection border
		ctx.strokeStyle = "#3b82f6";
		ctx.lineWidth = 2;
		ctx.strokeRect(x, y, width, height);
	}, [startPos, endPos]);

	// Handle ESC key to cancel
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onCancel();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [onCancel]);

	return (
		<div
			id="memorall-image-selector-overlay"
			style={{
				position: "fixed",
				top: "0",
				left: "0",
				width: "100vw",
				height: "100vh",
				zIndex: 2147483647,
				backgroundColor: "#000",
				cursor: isCapturing ? "wait" : "crosshair",
				fontFamily: "system-ui, -apple-system, sans-serif",
			}}
		>
			{isCapturing ? (
				<div
					style={{
						position: "absolute",
						top: "50%",
						left: "50%",
						transform: "translate(-50%, -50%)",
						color: "#fff",
						fontSize: "18px",
					}}
				>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "12px",
						}}
					>
						<div
							style={{
								width: "24px",
								height: "24px",
								border: "3px solid rgba(255, 255, 255, 0.3)",
								borderTopColor: "#fff",
								borderRadius: "50%",
								animation: "spin 1s linear infinite",
							}}
						/>
						<span>{t("capturingPage")}</span>
					</div>
				</div>
			) : (
				<>
					<div
						style={
							{
								position: "relative",
								width: "100%",
								height: "100%",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
							} as React.CSSProperties
						}
					>
						{capturedImage && (
							<>
								<img
									ref={imageRef}
									src={capturedImage}
									alt={t("capturedPageAlt")}
									style={{
										maxWidth: "100%",
										maxHeight: "100%",
										objectFit: "contain",
										userSelect: "none",
										pointerEvents: "none",
									}}
								/>
								<canvas
									ref={canvasRef}
									width={window.innerWidth}
									height={window.innerHeight}
									style={{
										position: "absolute",
										top: "50%",
										left: "50%",
										transform: "translate(-50%, -50%)",
										maxWidth: "100%",
										maxHeight: "100%",
										cursor: "crosshair",
									}}
									onMouseDown={handleMouseDown}
									onMouseMove={handleMouseMove}
									onMouseUp={handleMouseUp}
								/>
							</>
						)}
					</div>

					{/* Instructions */}
					<div
						style={
							{
								position: "fixed",
								top: "20px",
								left: "50%",
								transform: "translateX(-50%)",
								backgroundColor: "rgba(0, 0, 0, 0.8)",
								color: "#fff",
								padding: "12px 24px",
								borderRadius: "8px",
								fontSize: "14px",
								boxShadow: "0 4px 6px rgba(0, 0, 0, 0.3)",
							} as React.CSSProperties
						}
					>
						{t("instruction")}
					</div>

					{/* Cancel button */}
					<button
						onClick={onCancel}
						style={
							{
								position: "fixed",
								top: "20px",
								right: "20px",
								backgroundColor: "rgba(239, 68, 68, 0.9)",
								color: "#fff",
								border: "none",
								padding: "8px 16px",
								borderRadius: "6px",
								fontSize: "14px",
								fontWeight: 500,
								cursor: "pointer",
								boxShadow: "0 2px 4px rgba(0, 0, 0, 0.3)",
							} as React.CSSProperties
						}
						onMouseEnter={(e) => {
							e.currentTarget.style.backgroundColor = "rgba(220, 38, 38, 0.9)";
						}}
						onMouseLeave={(e) => {
							e.currentTarget.style.backgroundColor = "rgba(239, 68, 68, 0.9)";
						}}
					>
						{t("cancel")}
					</button>
				</>
			)}

			{/* Add CSS animation */}
			<style>
				{`
					@keyframes spin {
						to { transform: rotate(360deg); }
					}
				`}
			</style>
		</div>
	);
};

// Factory function to create and mount the image selector overlay
export function createImageSelectorOverlay(
	onImageSelected: (imageData: string) => void,
	onCancel: () => void,
): void {
	// Remove any existing selector
	const existingOverlay = document.getElementById(
		"memorall-image-selector-overlay",
	);
	if (existingOverlay) {
		existingOverlay.remove();
	}

	// Create container
	const container = document.createElement("div");
	container.id = "memorall-image-selector-container";
	document.body.appendChild(container);

	// Create root and render
	const root = createRoot(container);
	root.render(
		<ImageSelectorOverlay
			onImageSelected={(imageData) => {
				onImageSelected(imageData);
				// Cleanup
				root.unmount();
				container.remove();
			}}
			onCancel={() => {
				onCancel();
				// Cleanup
				root.unmount();
				container.remove();
			}}
		/>,
	);
}
