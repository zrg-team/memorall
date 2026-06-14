const LOTTIE_CDN_URL =
  "https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie_canvas.min.js";

let anim = null;

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
