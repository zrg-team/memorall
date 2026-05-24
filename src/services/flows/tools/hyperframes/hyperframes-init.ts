import z from "zod";
import type { Tool, ToolFactory, AllServices } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { compositionFile } from "./util";
import { readFileBytes, writeFileBytes } from "../fs/util";

const TOOL_NAME = "hyperframes_init" as const;

// ── Templates ────────────────────────────────────────────────────────────────

// 1. Neon Launch — dark purple/pink, 1920×1080, 18s, 5 scenes
const TPL_NEON_LAUNCH = `<!doctype html>
<html lang="en"><head>
  <meta charset="UTF-8" /><meta name="viewport" content="width=1920, height=1080" />
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/lucide@0.542.0/dist/umd/lucide.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@hyperframes/shader-transitions/dist/index.global.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;700;900&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet" />
  <style>
    :root{--bg:#08080f;--ink:#f0eeff;--accent:#c840f0;--accent2:#7c6cff;--muted:#6b6880;--font-display:"Space Grotesk",sans-serif;--font-data:"JetBrains Mono",monospace}
    *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
    html,body{width:1920px;height:1080px;overflow:hidden;background:var(--bg);color:var(--ink)}
    .scene{position:absolute;top:0;left:0;width:1920px;height:1080px;overflow:hidden}
    .scene-content{width:100%;height:100%;padding:100px 160px;display:flex;flex-direction:column;justify-content:center;gap:32px;box-sizing:border-box;position:relative;z-index:1}
    .display{font-family:var(--font-display);font-weight:900;font-size:120px;line-height:1.05;letter-spacing:-2px}
    .sub{font-family:var(--font-display);font-weight:300;font-size:42px;line-height:1.4;color:var(--muted)}
    .label{font-family:var(--font-data);font-size:18px;color:var(--accent);text-transform:uppercase;letter-spacing:4px}
    .stat{font-family:var(--font-display);font-weight:900;font-size:160px;color:var(--accent2);line-height:1}
    .grain{position:absolute;inset:0;pointer-events:none;z-index:50;opacity:0.15;background-image:radial-gradient(rgba(255,255,255,0.08) 1px,transparent 1.2px),radial-gradient(rgba(0,0,0,0.18) 1px,transparent 1.2px);background-size:3px 3px,5px 5px;background-position:0 0,1px 2px;mix-blend-mode:overlay}
    .glow{position:absolute;border-radius:50%;filter:blur(140px);pointer-events:none;z-index:0}
  </style>
</head><body>
  <div id="main" data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="18">
    <div class="scene clip" id="s1" data-start="0" data-duration="3.5" data-track-index="0">
      <div class="grain"></div>
      <div class="glow" style="width:700px;height:700px;background:var(--accent);opacity:0.12;top:-200px;right:100px;"></div>
      <div class="scene-content">
        <p class="label" id="s1-label">INTRODUCING</p>
        <h1 class="display" id="s1-title">Your Product<br/>Name Here</h1>
        <p class="sub" id="s1-sub">The tagline that changes everything.</p>
      </div>
    </div>
    <div class="scene clip" id="s2" data-start="3.5" data-duration="3.5" data-track-index="0" style="visibility:hidden;">
      <div class="grain"></div>
      <div class="scene-content">
        <p class="label" id="s2-label">THE PROBLEM</p>
        <h2 class="display" id="s2-title" style="font-size:88px">What frustrates<br/>your customers</h2>
        <p class="sub" id="s2-sub">One sentence on the pain point.</p>
      </div>
    </div>
    <div class="scene clip" id="s3" data-start="7" data-duration="3.5" data-track-index="0" style="opacity:0;">
      <div class="grain"></div>
      <div class="glow" style="width:900px;height:450px;background:var(--accent2);opacity:0.14;bottom:-100px;left:300px;"></div>
      <div class="scene-content">
        <p class="label" id="s3-label">THE SOLUTION</p>
        <h2 class="display" id="s3-title" style="font-size:88px">Your product<br/>fixes it</h2>
        <p class="sub" id="s3-sub">One clear sentence on how.</p>
      </div>
    </div>
    <div class="scene clip" id="s4" data-start="10.5" data-duration="4" data-track-index="0" style="opacity:0;">
      <div class="grain"></div>
      <div class="scene-content" style="flex-direction:row;align-items:center;gap:120px">
        <div>
          <p class="label" id="s4-label">TRACTION</p>
          <div class="stat" id="s4-stat">0</div>
          <p class="sub" style="font-size:32px">users in 30 days</p>
        </div>
        <div style="flex:1"><p class="sub" id="s4-copy">The proof point that makes investors lean in.</p></div>
      </div>
    </div>
    <div class="scene clip" id="s5" data-start="14.5" data-duration="3.5" data-track-index="0" style="opacity:0;">
      <div class="grain"></div>
      <div class="glow" style="width:1100px;height:550px;background:var(--accent);opacity:0.09;bottom:-200px;left:50%;transform:translateX(-50%);"></div>
      <div class="scene-content" style="align-items:center;text-align:center">
        <p class="label" id="s5-label">GET STARTED</p>
        <h2 class="display" id="s5-cta" style="font-size:100px">yourproduct.com</h2>
        <p class="sub" id="s5-sub">Free to try. No credit card required.</p>
      </div>
    </div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    if (window.lucide) window.lucide.createIcons();
    var tl = gsap.timeline({ paused: true });
    tl.from("#s1-label", { y:20, autoAlpha:0, duration:0.4, ease:"power2.out" }, 0.1);
    tl.from("#s1-title", { y:50, autoAlpha:0, duration:0.7, ease:"power4.out" }, 0.3);
    tl.from("#s1-sub",   { y:30, autoAlpha:0, duration:0.5, ease:"power2.out" }, 0.7);
    tl.to("#s1-title",   { y:-6, duration:1.5, ease:"sine.inOut", yoyo:true, repeat:1 }, 1.0);
    tl.set("#s1", { autoAlpha:0 }, 3.5);
    tl.set("#s2", { autoAlpha:1 }, 3.5);
    tl.from("#s2-label", { x:-30, autoAlpha:0, duration:0.4, ease:"power2.out" }, 3.7);
    tl.from("#s2-title", { y:60,  autoAlpha:0, duration:0.7, ease:"power4.out" }, 3.9);
    tl.from("#s2-sub",   { y:30,  autoAlpha:0, duration:0.5, ease:"power2.out" }, 4.3);
    tl.set("#s2", { autoAlpha:0 }, 7.0);
    tl.set("#s3", { opacity:1 },   7.0);
    tl.from("#s3-label", { x:-30, autoAlpha:0, duration:0.4, ease:"power2.out" }, 7.2);
    tl.from("#s3-title", { y:60,  autoAlpha:0, duration:0.7, ease:"power4.out" }, 7.4);
    tl.from("#s3-sub",   { y:30,  autoAlpha:0, duration:0.5, ease:"power2.out" }, 7.8);
    tl.set("#s4", { opacity:1 }, 10.5);
    tl.from("#s4-label", { x:-30, autoAlpha:0, duration:0.4, ease:"power2.out" }, 10.7);
    var c={v:0}; tl.to(c, { v:12000, duration:2.0, ease:"power2.out", onUpdate:function(){ document.getElementById("s4-stat").textContent=c.v.toLocaleString(); }}, 11.0);
    tl.from("#s4-copy",  { y:30,  autoAlpha:0, duration:0.5, ease:"power2.out" }, 11.3);
    tl.set("#s5", { opacity:1 }, 14.5);
    tl.from("#s5-label", { y:20,  autoAlpha:0, duration:0.4, ease:"power2.out" }, 14.7);
    tl.from("#s5-cta",   { y:50,  autoAlpha:0, duration:0.7, ease:"power4.out" }, 14.9);
    tl.from("#s5-sub",   { y:30,  autoAlpha:0, duration:0.5, ease:"power2.out" }, 15.3);
    window.HyperShader.init({
      bgColor:"#08080f", scenes:["s3","s4","s5"], timeline:tl,
      transitions:[{time:10.25,shader:"cinematic-zoom",duration:0.5},{time:14.25,shader:"light-leak",duration:0.5}],
    });
    window.__timelines["main"] = tl;
  </script>
</body></html>`;

// 2. Social Reel — vertical 1080×1920, bold/punchy, 15s, 5 scenes
const TPL_SOCIAL_REEL = `<!doctype html>
<html lang="en"><head>
  <meta charset="UTF-8" /><meta name="viewport" content="width=1080, height=1920" />
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/lucide@0.542.0/dist/umd/lucide.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@hyperframes/shader-transitions/dist/index.global.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@300;700;900&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet" />
  <style>
    :root{--bg:#0d0d0d;--ink:#ffffff;--accent:#ff3c3c;--muted:#888;--font-display:"Barlow Condensed",sans-serif;--font-data:"JetBrains Mono",monospace}
    *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
    html,body{width:1080px;height:1920px;overflow:hidden;background:var(--bg);color:var(--ink)}
    .scene{position:absolute;top:0;left:0;width:1080px;height:1920px;overflow:hidden}
    .scene-content{width:100%;height:100%;padding:140px 80px;display:flex;flex-direction:column;justify-content:center;gap:28px;box-sizing:border-box;position:relative;z-index:1}
    .display{font-family:var(--font-display);font-weight:900;font-size:140px;line-height:0.95;text-transform:uppercase;letter-spacing:-1px}
    .sub{font-family:var(--font-display);font-weight:300;font-size:52px;line-height:1.3;color:var(--muted)}
    .label{font-family:var(--font-data);font-size:22px;color:var(--accent);text-transform:uppercase;letter-spacing:5px}
    .accent-bar{width:80px;height:8px;background:var(--accent);border-radius:4px}
    .grain{position:absolute;inset:0;pointer-events:none;z-index:50;opacity:0.12;background-image:radial-gradient(rgba(255,255,255,0.08) 1px,transparent 1.2px),radial-gradient(rgba(0,0,0,0.18) 1px,transparent 1.2px);background-size:3px 3px,5px 5px;background-position:0 0,1px 2px;mix-blend-mode:overlay}
  </style>
</head><body>
  <div id="main" data-composition-id="main" data-width="1080" data-height="1920" data-start="0" data-duration="15">
    <div class="scene clip" id="s1" data-start="0" data-duration="3" data-track-index="0">
      <div class="grain"></div>
      <div class="scene-content">
        <div class="accent-bar" id="s1-bar"></div>
        <h1 class="display" id="s1-title">STOP<br/>SCROLLING</h1>
        <p class="sub" id="s1-sub">This changes how you work.</p>
      </div>
    </div>
    <div class="scene clip" id="s2" data-start="3" data-duration="2.5" data-track-index="0" style="visibility:hidden;">
      <div class="grain"></div>
      <div class="scene-content">
        <p class="label" id="s2-label">THE OLD WAY</p>
        <h2 class="display" id="s2-title" style="font-size:110px">SLOW.<br/>PAINFUL.<br/>BROKEN.</h2>
      </div>
    </div>
    <div class="scene clip" id="s3" data-start="5.5" data-duration="3" data-track-index="0" style="opacity:0;">
      <div class="grain"></div>
      <div class="scene-content" style="background:var(--accent)">
        <p class="label" id="s3-label" style="color:#fff">THE NEW WAY</p>
        <h2 class="display" id="s3-title">YOUR<br/>PRODUCT<br/>NAME</h2>
        <p class="sub" id="s3-sub" style="color:rgba(255,255,255,0.7)">One sentence. What it does.</p>
      </div>
    </div>
    <div class="scene clip" id="s4" data-start="8.5" data-duration="3" data-track-index="0" style="opacity:0;">
      <div class="grain"></div>
      <div class="scene-content">
        <p class="label" id="s4-label">RESULTS</p>
        <div class="display" id="s4-stat" style="font-size:200px;color:var(--accent)">0<span style="font-size:80px">%</span></div>
        <p class="sub" id="s4-copy">faster than anything else.</p>
      </div>
    </div>
    <div class="scene clip" id="s5" data-start="11.5" data-duration="3.5" data-track-index="0" style="opacity:0;">
      <div class="grain"></div>
      <div class="scene-content" style="align-items:center;text-align:center">
        <p class="label" id="s5-label">TRY IT FREE</p>
        <h2 class="display" id="s5-cta" style="font-size:110px">LINK IN<br/>BIO</h2>
        <div class="accent-bar" id="s5-bar" style="margin:0 auto"></div>
      </div>
    </div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    if (window.lucide) window.lucide.createIcons();
    var tl = gsap.timeline({ paused: true });
    tl.from("#s1-bar",   { scaleX:0, transformOrigin:"left", duration:0.4, ease:"power2.out" }, 0.1);
    tl.from("#s1-title", { y:80, autoAlpha:0, duration:0.6, ease:"power4.out" }, 0.3);
    tl.from("#s1-sub",   { y:30, autoAlpha:0, duration:0.5, ease:"power2.out" }, 0.7);
    tl.set("#s1", { autoAlpha:0 }, 3.0);
    tl.set("#s2", { autoAlpha:1 }, 3.0);
    tl.from("#s2-label", { y:20, autoAlpha:0, duration:0.3, ease:"power2.out" }, 3.2);
    tl.from("#s2-title", { y:80, autoAlpha:0, duration:0.5, ease:"power4.out", stagger:0.12 }, 3.4);
    tl.set("#s2", { autoAlpha:0 }, 5.5);
    tl.set("#s3", { opacity:1 },  5.5);
    tl.from("#s3-label", { y:20, autoAlpha:0, duration:0.3, ease:"power2.out" }, 5.7);
    tl.from("#s3-title", { y:80, autoAlpha:0, duration:0.6, ease:"power4.out" }, 5.9);
    tl.from("#s3-sub",   { y:30, autoAlpha:0, duration:0.4, ease:"power2.out" }, 6.3);
    tl.set("#s4", { opacity:1 }, 8.5);
    tl.from("#s4-label", { y:20, autoAlpha:0, duration:0.3, ease:"power2.out" }, 8.7);
    var c={v:0}; tl.to(c, { v:87, duration:1.5, ease:"power2.out", onUpdate:function(){ document.getElementById("s4-stat").firstChild.textContent=Math.round(c.v); }}, 9.0);
    tl.from("#s4-copy",  { y:30, autoAlpha:0, duration:0.4, ease:"power2.out" }, 9.8);
    tl.set("#s5", { opacity:1 }, 11.5);
    tl.from("#s5-label", { y:20, autoAlpha:0, duration:0.3, ease:"power2.out" }, 11.7);
    tl.from("#s5-cta",   { y:60, autoAlpha:0, duration:0.6, ease:"power4.out" }, 11.9);
    tl.from("#s5-bar",   { scaleX:0, transformOrigin:"center", duration:0.5, ease:"expo.out" }, 12.5);
    window.HyperShader.init({
      bgColor:"#0d0d0d", scenes:["s3","s4","s5"], timeline:tl,
      transitions:[{time:8.25,shader:"glitch",duration:0.4},{time:11.25,shader:"cinematic-zoom",duration:0.4}],
    });
    window.__timelines["main"] = tl;
  </script>
</body></html>`;

// 3. Clean Minimal — light editorial, 1920×1080, 15s, 4 scenes
const TPL_CLEAN_MINIMAL = `<!doctype html>
<html lang="en"><head>
  <meta charset="UTF-8" /><meta name="viewport" content="width=1920, height=1080" />
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/lucide@0.542.0/dist/umd/lucide.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@hyperframes/shader-transitions/dist/index.global.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400&display=swap" rel="stylesheet" />
  <style>
    :root{--bg:#f7f5f0;--ink:#1a1814;--accent:#d97b2a;--muted:#8a8278;--font-display:"DM Serif Display",serif;--font-body:"DM Sans",sans-serif}
    *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
    html,body{width:1920px;height:1080px;overflow:hidden;background:var(--bg);color:var(--ink)}
    .scene{position:absolute;top:0;left:0;width:1920px;height:1080px;overflow:hidden}
    .scene-content{width:100%;height:100%;padding:120px 200px;display:flex;flex-direction:column;justify-content:center;gap:36px;box-sizing:border-box;position:relative;z-index:1}
    .display{font-family:var(--font-display);font-weight:400;font-size:110px;line-height:1.05;color:var(--ink)}
    .sub{font-family:var(--font-body);font-weight:300;font-size:36px;line-height:1.6;color:var(--muted);max-width:900px}
    .label{font-family:var(--font-body);font-size:16px;color:var(--accent);text-transform:uppercase;letter-spacing:6px;font-weight:400}
    .rule{width:60px;height:2px;background:var(--accent)}
  </style>
</head><body>
  <div id="main" data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="15">
    <div class="scene clip" id="s1" data-start="0" data-duration="4" data-track-index="0">
      <div class="scene-content">
        <div class="rule" id="s1-rule"></div>
        <h1 class="display" id="s1-title">Beautiful products<br/>deserve a beautiful story.</h1>
        <p class="sub" id="s1-sub">Replace this with your opening statement.</p>
      </div>
    </div>
    <div class="scene clip" id="s2" data-start="4" data-duration="3.5" data-track-index="0" style="visibility:hidden;">
      <div class="scene-content">
        <p class="label" id="s2-label">WHAT WE DO</p>
        <h2 class="display" id="s2-title" style="font-size:90px">Your core<br/>value prop.</h2>
        <p class="sub" id="s2-sub">Describe in one or two clear sentences.</p>
      </div>
    </div>
    <div class="scene clip" id="s3" data-start="7.5" data-duration="4" data-track-index="0" style="opacity:0;">
      <div class="scene-content" style="flex-direction:row;align-items:flex-end;gap:160px">
        <div style="flex:1">
          <p class="label" id="s3-label">THE RESULT</p>
          <h2 class="display" id="s3-num" style="font-size:180px;color:var(--accent)">0</h2>
          <p class="sub" id="s3-metric" style="font-size:28px">hours saved per week</p>
        </div>
        <div style="flex:1.2"><p class="sub" id="s3-copy" style="font-size:40px">Supporting context that frames the number and makes it credible.</p></div>
      </div>
    </div>
    <div class="scene clip" id="s4" data-start="11.5" data-duration="3.5" data-track-index="0" style="opacity:0;">
      <div class="scene-content" style="align-items:flex-start">
        <div class="rule" id="s4-rule"></div>
        <h2 class="display" id="s4-cta" style="font-style:italic">Start for free today.</h2>
        <p class="sub" id="s4-url" style="font-size:32px;color:var(--accent)">yourproduct.com</p>
      </div>
    </div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    if (window.lucide) window.lucide.createIcons();
    var tl = gsap.timeline({ paused: true });
    tl.from("#s1-rule",  { scaleX:0, transformOrigin:"left", duration:0.5, ease:"power2.out" }, 0.2);
    tl.from("#s1-title", { y:40, autoAlpha:0, duration:0.8, ease:"power3.out" }, 0.5);
    tl.from("#s1-sub",   { y:20, autoAlpha:0, duration:0.6, ease:"power2.out" }, 1.0);
    tl.set("#s1", { autoAlpha:0 }, 4.0);
    tl.set("#s2", { autoAlpha:1 }, 4.0);
    tl.from("#s2-label", { x:-20, autoAlpha:0, duration:0.4, ease:"power2.out" }, 4.2);
    tl.from("#s2-title", { y:40,  autoAlpha:0, duration:0.7, ease:"power3.out" }, 4.5);
    tl.from("#s2-sub",   { y:20,  autoAlpha:0, duration:0.5, ease:"power2.out" }, 5.0);
    tl.set("#s2", { autoAlpha:0 }, 7.5);
    tl.set("#s3", { opacity:1 },  7.5);
    tl.from("#s3-label",  { x:-20, autoAlpha:0, duration:0.4, ease:"power2.out" }, 7.7);
    var c={v:0}; tl.to(c, { v:40, duration:2.0, ease:"power2.out", onUpdate:function(){ document.getElementById("s3-num").textContent=Math.round(c.v); }}, 8.0);
    tl.from("#s3-metric", { y:20,  autoAlpha:0, duration:0.5, ease:"power2.out" }, 8.3);
    tl.from("#s3-copy",   { y:20,  autoAlpha:0, duration:0.6, ease:"power2.out" }, 8.6);
    tl.set("#s4", { opacity:1 }, 11.5);
    tl.from("#s4-rule",  { scaleX:0, transformOrigin:"left", duration:0.5, ease:"power2.out" }, 11.7);
    tl.from("#s4-cta",   { y:40,  autoAlpha:0, duration:0.7, ease:"power3.out" }, 12.0);
    tl.from("#s4-url",   { y:20,  autoAlpha:0, duration:0.5, ease:"power2.out" }, 12.5);
    window.HyperShader.init({
      bgColor:"#f7f5f0", scenes:["s3","s4"], timeline:tl,
      transitions:[{time:11.25,shader:"cross-warp-morph",duration:0.5}],
    });
    window.__timelines["main"] = tl;
  </script>
</body></html>`;

// 4. Tech Data — dark/teal, metrics-driven with D3 bars, 1920×1080, 20s, 5 scenes
const TPL_TECH_DATA = `<!doctype html>
<html lang="en"><head>
  <meta charset="UTF-8" /><meta name="viewport" content="width=1920, height=1080" />
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/lucide@0.542.0/dist/umd/lucide.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@hyperframes/shader-transitions/dist/index.global.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;700;900&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet" />
  <style>
    :root{--bg:#040d0f;--ink:#e8f8f5;--accent:#00e5c0;--accent2:#0066ff;--muted:#3d6b64;--font-display:"Space Grotesk",sans-serif;--font-data:"JetBrains Mono",monospace}
    *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
    html,body{width:1920px;height:1080px;overflow:hidden;background:var(--bg);color:var(--ink)}
    .scene{position:absolute;top:0;left:0;width:1920px;height:1080px;overflow:hidden}
    .scene-content{width:100%;height:100%;padding:80px 140px;display:flex;flex-direction:column;justify-content:center;gap:28px;box-sizing:border-box;position:relative;z-index:1}
    .display{font-family:var(--font-display);font-weight:900;font-size:100px;line-height:1.05}
    .sub{font-family:var(--font-display);font-weight:300;font-size:36px;line-height:1.4;color:var(--muted)}
    .label{font-family:var(--font-data);font-size:16px;color:var(--accent);text-transform:uppercase;letter-spacing:4px}
    .mono{font-family:var(--font-data);font-size:28px;color:var(--accent)}
    .stat-big{font-family:var(--font-data);font-weight:700;font-size:140px;color:var(--accent);line-height:1}
    .grid-bg{position:absolute;inset:0;background-image:linear-gradient(rgba(0,229,192,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(0,229,192,0.04) 1px,transparent 1px);background-size:60px 60px;pointer-events:none;z-index:0}
    .grain{position:absolute;inset:0;pointer-events:none;z-index:50;opacity:0.12;background-image:radial-gradient(rgba(255,255,255,0.08) 1px,transparent 1.2px),radial-gradient(rgba(0,0,0,0.18) 1px,transparent 1.2px);background-size:3px 3px,5px 5px;background-position:0 0,1px 2px;mix-blend-mode:overlay}
  </style>
</head><body>
  <div id="main" data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="20">
    <div class="scene clip" id="s1" data-start="0" data-duration="4" data-track-index="0">
      <div class="grid-bg"></div><div class="grain"></div>
      <div class="scene-content">
        <p class="label" id="s1-label">// PRODUCT.LAUNCH</p>
        <h1 class="display" id="s1-title">Built for teams<br/>who ship fast.</h1>
        <p class="sub" id="s1-sub">Your product description in one line.</p>
        <p class="mono" id="s1-mono">v2.0.0 — now available</p>
      </div>
    </div>
    <div class="scene clip" id="s2" data-start="4" data-duration="4" data-track-index="0" style="visibility:hidden;">
      <div class="grid-bg"></div><div class="grain"></div>
      <div class="scene-content" style="flex-direction:row;align-items:center;gap:100px">
        <div style="flex:1">
          <p class="label" id="s2-label">PERFORMANCE</p>
          <div class="stat-big" id="s2-stat">0<span style="font-size:60px">ms</span></div>
          <p class="sub" id="s2-sub">average response time</p>
        </div>
        <div style="flex:1">
          <svg id="s2-chart" width="700" height="320" viewBox="0 0 700 320"></svg>
        </div>
      </div>
    </div>
    <div class="scene clip" id="s3" data-start="8" data-duration="4" data-track-index="0" style="opacity:0;">
      <div class="grid-bg"></div><div class="grain"></div>
      <div class="scene-content">
        <p class="label" id="s3-label">KEY FEATURES</p>
        <div style="display:flex;gap:60px;margin-top:20px">
          <div id="s3-f1"><i data-lucide="zap" style="width:48px;height:48px;color:var(--accent);stroke-width:2"></i><h3 style="font-family:var(--font-display);font-size:42px;font-weight:700;margin-top:16px">Feature One</h3><p class="sub" style="font-size:28px;margin-top:8px">Short benefit.</p></div>
          <div id="s3-f2"><i data-lucide="shield-check" style="width:48px;height:48px;color:var(--accent);stroke-width:2"></i><h3 style="font-family:var(--font-display);font-size:42px;font-weight:700;margin-top:16px">Feature Two</h3><p class="sub" style="font-size:28px;margin-top:8px">Short benefit.</p></div>
          <div id="s3-f3"><i data-lucide="chart-no-axes-combined" style="width:48px;height:48px;color:var(--accent);stroke-width:2"></i><h3 style="font-family:var(--font-display);font-size:42px;font-weight:700;margin-top:16px">Feature Three</h3><p class="sub" style="font-size:28px;margin-top:8px">Short benefit.</p></div>
        </div>
      </div>
    </div>
    <div class="scene clip" id="s4" data-start="12" data-duration="4" data-track-index="0" style="opacity:0;">
      <div class="grid-bg"></div><div class="grain"></div>
      <div class="scene-content" style="flex-direction:row;gap:120px;align-items:center">
        <div style="flex:1"><p class="label" id="s4-label">USED BY</p><div class="stat-big" id="s4-stat2">0</div><p class="sub">teams worldwide</p></div>
        <div style="flex:1.5"><p class="sub" id="s4-quote" style="font-size:42px;font-style:italic;color:var(--ink)">"Replace with a real customer quote that validates your product."</p><p class="mono" style="font-size:22px;margin-top:24px">— Customer Name, Role</p></div>
      </div>
    </div>
    <div class="scene clip" id="s5" data-start="16" data-duration="4" data-track-index="0" style="opacity:0;">
      <div class="grid-bg"></div><div class="grain"></div>
      <div class="scene-content" style="align-items:center;text-align:center">
        <p class="label" id="s5-label">// START.FREE</p>
        <h2 class="display" id="s5-cta" style="font-size:120px">yourproduct.com</h2>
        <p class="sub" id="s5-sub">14-day free trial. No card required.</p>
      </div>
    </div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    if (window.lucide) window.lucide.createIcons();
    var bars=[55,80,65,95,75,100,88]; var svg=d3.select("#s2-chart");
    svg.selectAll("rect").data(bars).join("rect").attr("x",function(d,i){return i*90+20}).attr("y",function(d){return 280-d*2.6}).attr("width",60).attr("height",function(d){return d*2.6}).attr("rx",6).attr("fill","var(--accent)").attr("opacity",0.85);
    var tl = gsap.timeline({ paused: true });
    tl.from("#s1-label", { y:20, autoAlpha:0, duration:0.4, ease:"power2.out" }, 0.1);
    tl.from("#s1-title", { y:50, autoAlpha:0, duration:0.7, ease:"power4.out" }, 0.3);
    tl.from("#s1-sub",   { y:30, autoAlpha:0, duration:0.5, ease:"power2.out" }, 0.7);
    tl.from("#s1-mono",  { y:20, autoAlpha:0, duration:0.4, ease:"power2.out" }, 1.0);
    tl.set("#s1", { autoAlpha:0 }, 4.0);
    tl.set("#s2", { autoAlpha:1 }, 4.0);
    tl.from("#s2-label", { x:-20, autoAlpha:0, duration:0.4, ease:"power2.out" }, 4.2);
    var c1={v:0}; tl.to(c1, { v:12, duration:1.5, ease:"power2.out", onUpdate:function(){ document.getElementById("s2-stat").firstChild.textContent=Math.round(c1.v); }}, 4.5);
    tl.from("#s2-sub",   { y:20, autoAlpha:0, duration:0.4, ease:"power2.out" }, 4.8);
    tl.from("#s2-chart rect", { scaleY:0, transformOrigin:"bottom", duration:0.6, ease:"expo.out", stagger:0.08 }, 5.0);
    tl.set("#s2", { autoAlpha:0 }, 8.0);
    tl.set("#s3", { opacity:1 },  8.0);
    tl.from("#s3-label", { x:-20, autoAlpha:0, duration:0.4, ease:"power2.out" }, 8.2);
    tl.from("#s3-f1",    { y:40,  autoAlpha:0, duration:0.5, ease:"power3.out" }, 8.5);
    tl.from("#s3-f2",    { y:40,  autoAlpha:0, duration:0.5, ease:"power3.out" }, 8.7);
    tl.from("#s3-f3",    { y:40,  autoAlpha:0, duration:0.5, ease:"power3.out" }, 8.9);
    tl.set("#s4", { opacity:1 }, 12.0);
    tl.from("#s4-label", { x:-20, autoAlpha:0, duration:0.4, ease:"power2.out" }, 12.2);
    var c2={v:0}; tl.to(c2, { v:4200, duration:2.0, ease:"power2.out", onUpdate:function(){ document.getElementById("s4-stat2").textContent=c2.v.toLocaleString(); }}, 12.5);
    tl.from("#s4-quote",  { y:30, autoAlpha:0, duration:0.6, ease:"power2.out" }, 13.0);
    tl.set("#s5", { opacity:1 }, 16.0);
    tl.from("#s5-label", { y:20, autoAlpha:0, duration:0.4, ease:"power2.out" }, 16.2);
    tl.from("#s5-cta",   { y:50, autoAlpha:0, duration:0.7, ease:"power4.out" }, 16.4);
    tl.from("#s5-sub",   { y:30, autoAlpha:0, duration:0.5, ease:"power2.out" }, 16.8);
    window.HyperShader.init({
      bgColor:"#040d0f", scenes:["s3","s4","s5"], timeline:tl,
      transitions:[{time:11.75,shader:"cinematic-zoom",duration:0.5},{time:15.75,shader:"chromatic-split",duration:0.4}],
    });
    window.__timelines["main"] = tl;
  </script>
</body></html>`;

// 5. Warm Cinema — amber/gold tones, storytelling, 1920×1080, 18s, 5 scenes
const TPL_WARM_CINEMA = `<!doctype html>
<html lang="en"><head>
  <meta charset="UTF-8" /><meta name="viewport" content="width=1920, height=1080" />
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/lucide@0.542.0/dist/umd/lucide.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@hyperframes/shader-transitions/dist/index.global.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant:ital,wght@0,300;0,600;1,300;1,600&family=Space+Grotesk:wght@400&display=swap" rel="stylesheet" />
  <style>
    :root{--bg:#100c07;--ink:#f5ead6;--accent:#c9892a;--accent2:#e8b86d;--muted:#7a6a52;--font-display:"Cormorant",serif;--font-body:"Space Grotesk",sans-serif}
    *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
    html,body{width:1920px;height:1080px;overflow:hidden;background:var(--bg);color:var(--ink)}
    .scene{position:absolute;top:0;left:0;width:1920px;height:1080px;overflow:hidden}
    .scene-content{width:100%;height:100%;padding:120px 200px;display:flex;flex-direction:column;justify-content:center;gap:28px;box-sizing:border-box;position:relative;z-index:1}
    .display{font-family:var(--font-display);font-weight:600;font-size:120px;line-height:1.05}
    .italic{font-style:italic;font-weight:300}
    .sub{font-family:var(--font-body);font-weight:400;font-size:32px;line-height:1.6;color:var(--muted);max-width:880px}
    .label{font-family:var(--font-body);font-size:15px;color:var(--accent);text-transform:uppercase;letter-spacing:6px}
    .divider{width:100px;height:1px;background:var(--accent);opacity:0.6}
    .warm-glow{position:absolute;border-radius:50%;filter:blur(180px);pointer-events:none;z-index:0}
    .vignette{position:absolute;inset:0;pointer-events:none;z-index:49;background:radial-gradient(ellipse at center,transparent 40%,rgba(0,0,0,0.6) 100%)}
    .grain{position:absolute;inset:0;pointer-events:none;z-index:50;opacity:0.18;background-image:radial-gradient(rgba(255,255,255,0.08) 1px,transparent 1.2px),radial-gradient(rgba(0,0,0,0.18) 1px,transparent 1.2px);background-size:3px 3px,5px 5px;background-position:0 0,1px 2px;mix-blend-mode:overlay}
  </style>
</head><body>
  <div id="main" data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="18">
    <div class="scene clip" id="s1" data-start="0" data-duration="4" data-track-index="0">
      <div class="warm-glow" style="width:800px;height:400px;background:var(--accent);opacity:0.08;bottom:-100px;right:-100px;"></div>
      <div class="vignette"></div><div class="grain"></div>
      <div class="scene-content">
        <p class="label" id="s1-label">EST. 2024</p>
        <div class="divider" id="s1-div"></div>
        <h1 class="display italic" id="s1-title">Every great product<br/>begins with a story.</h1>
      </div>
    </div>
    <div class="scene clip" id="s2" data-start="4" data-duration="3.5" data-track-index="0" style="visibility:hidden;">
      <div class="warm-glow" style="width:600px;height:600px;background:var(--accent2);opacity:0.06;top:-200px;left:200px;"></div>
      <div class="vignette"></div><div class="grain"></div>
      <div class="scene-content">
        <p class="label" id="s2-label">THE VISION</p>
        <h2 class="display" id="s2-title" style="font-size:90px">What if it was<br/><span class="italic">just easier?</span></h2>
        <p class="sub" id="s2-sub">Replace with your mission or founding insight.</p>
      </div>
    </div>
    <div class="scene clip" id="s3" data-start="7.5" data-duration="3.5" data-track-index="0" style="opacity:0;">
      <div class="warm-glow" style="width:900px;height:450px;background:var(--accent);opacity:0.1;bottom:-150px;left:50%;transform:translateX(-50%);"></div>
      <div class="vignette"></div><div class="grain"></div>
      <div class="scene-content" style="align-items:center;text-align:center">
        <p class="label" id="s3-label">INTRODUCING</p>
        <h2 class="display" id="s3-title" style="font-size:160px">Product<br/>Name</h2>
        <p class="sub" id="s3-sub" style="text-align:center;margin:0 auto">Your tagline in one beautiful sentence.</p>
      </div>
    </div>
    <div class="scene clip" id="s4" data-start="11" data-duration="3.5" data-track-index="0" style="opacity:0;">
      <div class="vignette"></div><div class="grain"></div>
      <div class="scene-content" style="flex-direction:row;align-items:center;gap:160px">
        <div style="flex:1">
          <p class="label" id="s4-label">IN NUMBERS</p>
          <h3 class="display" id="s4-n1" style="font-size:100px;color:var(--accent2)">0K+</h3>
          <p class="sub" style="font-size:26px">happy customers</p>
        </div>
        <div style="flex:1">
          <h3 class="display" id="s4-n2" style="font-size:100px;color:var(--accent2)">0★</h3>
          <p class="sub" style="font-size:26px">average rating</p>
        </div>
        <div style="flex:1">
          <h3 class="display" id="s4-n3" style="font-size:100px;color:var(--accent2)">0x</h3>
          <p class="sub" style="font-size:26px">faster results</p>
        </div>
      </div>
    </div>
    <div class="scene clip" id="s5" data-start="14.5" data-duration="3.5" data-track-index="0" style="opacity:0;">
      <div class="warm-glow" style="width:1200px;height:600px;background:var(--accent);opacity:0.07;bottom:-200px;left:50%;transform:translateX(-50%);"></div>
      <div class="vignette"></div><div class="grain"></div>
      <div class="scene-content" style="align-items:center;text-align:center">
        <div class="divider" id="s5-div" style="margin:0 auto"></div>
        <h2 class="display italic" id="s5-cta" style="font-size:100px">Begin your story.</h2>
        <p class="sub" id="s5-url" style="color:var(--accent2);text-align:center">yourproduct.com</p>
      </div>
    </div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    if (window.lucide) window.lucide.createIcons();
    var tl = gsap.timeline({ paused: true });
    tl.from("#s1-label", { y:20, autoAlpha:0, duration:0.5, ease:"power2.out" }, 0.2);
    tl.from("#s1-div",   { scaleX:0, transformOrigin:"left", duration:0.6, ease:"power2.out" }, 0.5);
    tl.from("#s1-title", { y:40, autoAlpha:0, duration:1.0, ease:"power3.out" }, 0.7);
    tl.to("#s1-title",   { y:-5, duration:2.0, ease:"sine.inOut", yoyo:true, repeat:1 }, 1.5);
    tl.set("#s1", { autoAlpha:0 }, 4.0);
    tl.set("#s2", { autoAlpha:1 }, 4.0);
    tl.from("#s2-label", { y:20, autoAlpha:0, duration:0.4, ease:"power2.out" }, 4.2);
    tl.from("#s2-title", { y:40, autoAlpha:0, duration:0.8, ease:"power3.out" }, 4.5);
    tl.from("#s2-sub",   { y:20, autoAlpha:0, duration:0.6, ease:"power2.out" }, 5.0);
    tl.set("#s2", { autoAlpha:0 }, 7.5);
    tl.set("#s3", { opacity:1 },  7.5);
    tl.from("#s3-label", { y:20, autoAlpha:0, duration:0.4, ease:"power2.out" }, 7.7);
    tl.from("#s3-title", { scale:0.92, autoAlpha:0, duration:1.0, ease:"power3.out" }, 7.9);
    tl.from("#s3-sub",   { y:20, autoAlpha:0, duration:0.6, ease:"power2.out" }, 8.6);
    tl.set("#s4", { opacity:1 }, 11.0);
    tl.from("#s4-label", { y:20, autoAlpha:0, duration:0.4, ease:"power2.out" }, 11.2);
    tl.from("#s4-n1",    { y:40, autoAlpha:0, duration:0.6, ease:"power3.out" }, 11.4);
    tl.from("#s4-n2",    { y:40, autoAlpha:0, duration:0.6, ease:"power3.out" }, 11.6);
    tl.from("#s4-n3",    { y:40, autoAlpha:0, duration:0.6, ease:"power3.out" }, 11.8);
    var c1={v:0}; tl.to(c1, {v:50,duration:1.5,ease:"power2.out",onUpdate:function(){document.getElementById("s4-n1").textContent=Math.round(c1.v)+"K+";}},11.5);
    var c2={v:0}; tl.to(c2, {v:4.9,duration:1.5,ease:"power2.out",onUpdate:function(){document.getElementById("s4-n2").textContent=c2.v.toFixed(1)+"★";}},11.7);
    var c3={v:0}; tl.to(c3, {v:10,duration:1.5,ease:"power2.out",onUpdate:function(){document.getElementById("s4-n3").textContent=Math.round(c3.v)+"x";}},11.9);
    tl.set("#s5", { opacity:1 }, 14.5);
    tl.from("#s5-div",  { scaleX:0, transformOrigin:"center", duration:0.5, ease:"power2.out" }, 14.7);
    tl.from("#s5-cta",  { y:40,  autoAlpha:0, duration:0.8, ease:"power3.out" }, 15.0);
    tl.from("#s5-url",  { y:20,  autoAlpha:0, duration:0.6, ease:"power2.out" }, 15.5);
    window.HyperShader.init({
      bgColor:"#100c07", scenes:["s3","s4","s5"], timeline:tl,
      transitions:[{time:11.0,shader:"thermal-distortion",duration:0.5},{time:14.25,shader:"light-leak",duration:0.5}],
    });
    window.__timelines["main"] = tl;
  </script>
</body></html>`;

// ── Template registry ─────────────────────────────────────────────────────────

interface TemplateEntry {
	name: string;
	description: string;
	filename: string;
	html: string;
}

const TEMPLATES: TemplateEntry[] = [
	{
		name: "Neon Launch",
		description: "Dark purple/pink, 1920×1080, 18s — dramatic product launch",
		filename: "neon-launch.html",
		html: TPL_NEON_LAUNCH,
	},
	{
		name: "Social Reel",
		description: "Bold vertical, 1080×1920, 15s — punchy social promo",
		filename: "social-reel.html",
		html: TPL_SOCIAL_REEL,
	},
	{
		name: "Clean Minimal",
		description: "Light editorial, 1920×1080, 15s — serif typography-forward",
		filename: "clean-minimal.html",
		html: TPL_CLEAN_MINIMAL,
	},
	{
		name: "Tech Data",
		description:
			"Dark/teal, 1920×1080, 20s — metrics and D3 chart visualisation",
		filename: "tech-data.html",
		html: TPL_TECH_DATA,
	},
	{
		name: "Warm Cinema",
		description: "Amber/gold, 1920×1080, 18s — cinematic storytelling",
		filename: "warm-cinema.html",
		html: TPL_WARM_CINEMA,
	},
];

const TEMPLATE_NAMES = TEMPLATES.map((t) =>
	t.filename.replace(".html", ""),
) as [string, ...string[]];

// ── Tool ──────────────────────────────────────────────────────────────────────

const schema = z.object({
	project_path: z
		.string()
		.min(1)
		.describe(
			"Workspace path for the new project, e.g. /workspaces/product-launch",
		),
	template: z
		.enum(TEMPLATE_NAMES)
		.optional()
		.describe(
			`Template to use for index.html. Options: ${TEMPLATE_NAMES.join(", ")}. Defaults to neon-launch if omitted.`,
		),
	force: z
		.boolean()
		.optional()
		.describe("Overwrite if the project already exists (default: false)"),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

export const createHyperframesInitTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description: `Initialise a new HyperFrames project. Writes index.html using the chosen template and creates templates/ with all 5 ready-made video promo designs. Available templates: ${TEMPLATES.map((t) => `${t.filename.replace(".html", "")} (${t.description})`).join(" | ")}. Use force: true to overwrite an existing project.`,
	schema,
	execute: async (input) => {
		const dfs = services.fs;
		if (!dfs) return "Error: fs service not available.";

		const indexFile = compositionFile(input.project_path);

		if (!input.force) {
			try {
				await readFileBytes(dfs, indexFile);
				return `Error: ${indexFile} already exists. Use force: true to overwrite.`;
			} catch {
				// Does not exist — proceed
			}
		}

		const chosen =
			TEMPLATES.find((t) => t.filename === `${input.template}.html`) ??
			TEMPLATES[0];

		await writeFileBytes(dfs, indexFile, chosen.html);

		return `Initialised: ${indexFile} with template "${chosen.name}" (${chosen.description}). Edit with hyperframes_write, then hyperframes_validate and hyperframes_show.`;
	},
});

toolRegistry.register(TOOL_NAME, createHyperframesInitTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: { input: Input; services: Services };
	}
}
