const LOTTIE_CDN_URL =
  "https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie_canvas.min.js";
const GIF_CDN_URL = "https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.js";
const GIF_WORKER_URL = "https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js";

let anim = null;

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

function loadGifScript() {
  return new Promise((resolve, reject) => {
    if (window.GIF) return resolve();
    const script = document.createElement("script");
    script.src = GIF_CDN_URL;
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
    await loadGifScript();
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

  const gif = new window.GIF({
    workers: 2,
    quality: 10,
    width: canvas.width,
    height: canvas.height,
    workerScript: GIF_WORKER_URL,
  });

  gif.on("progress", (ratio) => {
    setStatus(`Rendering GIF... ${Math.round(ratio * 100)}%`);
  });

  gif.on("finished", (blob) => {
    downloadBlob(blob, "animation.gif");
    anim.goToAndStop(startFrame, true);
    if (wasPlaying) anim.play();
    setStatus("");
    setBusy(false);
  });

  for (let frame = 0; frame < totalFrames; frame++) {
    anim.goToAndStop(frame, true);
    gif.addFrame(canvas, { copy: true, delay });
  }

  setStatus("Rendering GIF...");
  gif.render();
}

if (pngButton) pngButton.addEventListener("click", downloadPng);
if (gifButton) gifButton.addEventListener("click", exportGif);

window.addEventListener("message", async (event) => {
  const { type, animationData, frame } = event.data || {};

  if (type === "lottie:load") {
    await loadLottieScript();
    anim?.destroy();
    anim = window.lottie.loadAnimation({
      container: document.getElementById("lottie-container"),
      renderer: "canvas",
      loop: true,
      autoplay: true,
      animationData,
    });
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
