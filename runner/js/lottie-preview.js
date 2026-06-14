const LOTTIE_CDN_URL =
  "https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie_canvas.min.js";
const GIF_ENCODER_URL = "./js/gif-encoder.js";

let anim = null;
let parentTarget = null;
let parentOrigin = "*";

function reportError(message, details) {
  if (!parentTarget) return;
  parentTarget.postMessage(
    { type: "lottie:error", message: String(message), details },
    parentOrigin,
  );
}

window.addEventListener("error", (event) => {
  reportError(event.message || "Unknown error", {
    source: event.filename,
    line: event.lineno,
  });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  reportError(
    reason instanceof Error ? reason.message : String(reason),
    { source: "promise" },
  );
});

const statusEl = document.getElementById("status");
const pngButton = document.getElementById("btn-png");
const gifButton = document.getElementById("btn-gif");

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function setBusy(busy) {
  if (pngButton) pngButton.disabled = busy;
  if (gifButton) gifButton.disabled = busy;
}

function loadLottieScript() {
  return new Promise((resolve, reject) => {
    if (window.lottie) return resolve();
    const script = document.createElement("script");
    script.src = LOTTIE_CDN_URL;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function loadGifEncoderScript() {
  return new Promise((resolve, reject) => {
    if (window.GIFEncoder) return resolve();
    const script = document.createElement("script");
    script.src = GIF_ENCODER_URL;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function getCanvas() {
  return document.querySelector("#lottie-container canvas");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadPng() {
  const canvas = getCanvas();
  if (!anim || !canvas) {
    setStatus("Nothing to export yet");
    return;
  }
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, `frame-${Math.round(anim.currentFrame)}.png`);
  }, "image/png");
}

async function exportGif() {
  const canvas = getCanvas();
  if (!anim || !canvas) {
    setStatus("Nothing to export yet");
    return;
  }

  setBusy(true);
  setStatus("Preparing GIF...");

  try {
    await loadGifEncoderScript();
  } catch {
    setStatus("Failed to load GIF encoder");
    setBusy(false);
    return;
  }

  const wasPlaying = !anim.isPaused;
  const startFrame = anim.currentFrame;
  anim.pause();

  const totalFrames = Math.max(Math.round(anim.totalFrames), 1);
  const frameRate = anim.frameRate || 30;
  const delay = Math.round(1000 / frameRate);
  const ctx = canvas.getContext("2d");

  const encoder = new window.GIFEncoder(canvas.width, canvas.height);
  encoder.setRepeat(0);
  encoder.setDelay(delay);
  encoder.setQuality(10);
  encoder.writeHeader();

  for (let frame = 0; frame < totalFrames; frame++) {
    anim.goToAndStop(frame, true);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    encoder.addFrame(imageData.data);
    setStatus(`Rendering GIF... ${Math.round(((frame + 1) / totalFrames) * 100)}%`);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  encoder.finish();
  downloadBlob(encoder.toBlob(), "animation.gif");

  anim.goToAndStop(startFrame, true);
  if (wasPlaying) anim.play();
  setStatus("");
  setBusy(false);
}

if (pngButton) pngButton.addEventListener("click", downloadPng);
if (gifButton) gifButton.addEventListener("click", exportGif);

window.addEventListener("message", async (event) => {
  const { type, animationData, frame } = event.data || {};

  if (type === "lottie:load") {
    parentTarget = event.source;
    parentOrigin = event.origin;

    try {
      await loadLottieScript();
      anim?.destroy();
      anim = window.lottie.loadAnimation({
        container: document.getElementById("lottie-container"),
        renderer: "canvas",
        loop: true,
        autoplay: true,
        animationData,
      });
    } catch (error) {
      reportError(
        error instanceof Error ? error.message : String(error),
        { source: "loadAnimation" },
      );
      return;
    }

    anim.addEventListener("data_failed", () =>
      reportError("Lottie failed to parse the animation data.", {
        source: "data_failed",
      }),
    );
    anim.addEventListener("enterFrame", () =>
      event.source.postMessage(
        { type: "lottie:frame", frame: Math.round(anim.currentFrame), totalFrames: Math.round(anim.totalFrames) },
        event.origin,
      ),
    );
    event.source.postMessage({ type: "lottie:ready", totalFrames: Math.round(anim.totalFrames) }, event.origin);
    return;
  }

  if (!anim) return;
  if (type === "lottie:play") anim.play();
  if (type === "lottie:pause") anim.pause();
  if (type === "lottie:seek") anim.goToAndStop(frame, true);
});
