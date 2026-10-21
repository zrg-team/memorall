import { customStyles } from "@/embedded/styles/customStyles";

/** Layout only: colour and typography come from the same embedded app stylesheet. */
export const transcriptionStyles = `${customStyles}
  :host { all: initial; font-family: "Space Grotesk", system-ui, sans-serif; }
  .mt-surface { --mt-gutter: 18px; min-width: 0; }
  .mt-surface, .mt-surface * { box-sizing: border-box; }
  .mt-surface ::selection { background-color: hsl(var(--primary)); color: hsl(var(--primary-foreground)); text-shadow: none; }
  .memorall-transcription.memorall-chat-shell--popup {
    top: auto; left: auto;
    right: 18px; bottom: 82px; width: min(430px, calc(100vw - 36px));
    height: min(600px, calc(100dvh - 108px)); min-height: min(320px, calc(100dvh - 108px));
    border-radius: 16px; font: 400 14px/1.6 "Space Grotesk", system-ui, sans-serif;
    box-shadow: 0 24px 64px rgb(0 0 0 / .24), 0 4px 16px rgb(0 0 0 / .12);
  }
  .memorall-transcription[hidden] { display: none; }
  .memorall-transcription button, .memorall-transcription select { font-family: inherit; }
  .mt-header { display: flex; flex-shrink: 0; align-items: center; gap: 10px; padding: 16px var(--mt-gutter) 12px; }
  .mt-mark { display: grid; place-items: center; flex: 0 0 36px; height: 36px; border-radius: 11px; background: hsl(var(--primary) / .09); color: hsl(var(--primary)); }
  .mt-heading { min-width: 0; flex: 1; }
  .mt-heading h2 { margin: 0; font-size: 14px; line-height: 1.4; font-weight: 650; color: hsl(var(--foreground)); overflow-wrap: anywhere; }
  .mt-source { margin: 2px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: hsl(var(--muted-foreground)); font-size: 11px; }
  .mt-icon { width: 30px; height: 30px; padding: 0; color: hsl(var(--muted-foreground)); flex-shrink: 0; }
  .mt-window-controls { display: flex; flex-shrink: 0; align-items: center; gap: 2px; }
  .mt-dot { width: 6px; height: 6px; border-radius: 50%; background: hsl(var(--primary)); flex-shrink: 0; }
  .mt-dot[data-active=true] { animation: mt-pulse 2s ease-in-out infinite; }
  .mt-tab { height: 26px; padding: 0 10px; border-radius: 5px; border: 0; background: transparent; color: hsl(var(--muted-foreground)); font-size: 11px; cursor: pointer; }
  .mt-reader-wrap { position: relative; display: flex; flex: 1 1 0; min-width: 0; min-height: 0; }
  .mt-reader { flex: 1 1 0; min-width: 0; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: hsl(var(--border)) transparent; padding: 16px var(--mt-gutter) 42px; scroll-behavior: auto; overflow-anchor: none; }
  .mt-reader:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: -2px; }
  .mt-reader[data-following=false] { overflow-anchor: auto; }
  .mt-reader-content { min-width: 0; }
  .mt-paragraph { position: relative; padding: 0 0 17px 42px; }
  .mt-paragraph time { position: absolute; left: 0; top: 3px; font-size: 10px; line-height: 1.6; font-variant-numeric: tabular-nums; color: hsl(var(--muted-foreground) / .8); }
  .mt-text { margin: 0; font-size: 14px; line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; color: hsl(var(--foreground)); }
  .mt-partial { color: hsl(var(--foreground) / .82); }
  .mt-original-text { color: hsl(var(--muted-foreground)); font-size: 12px; line-height: 1.75; }
  .memorall-transcription-page .mt-text.mt-original-text { font-size: 13px; }
  .mt-translation { margin-top: 7px; }
  .mt-translation .mt-pending { margin-top: 5px; }
  .mt-footer-label { display: flex; flex: 1 1 0; min-width: 0; flex-direction: column; align-items: flex-start; gap: 3px; }
  .mt-footer-label .mt-pending { font-size: 10px; max-width: 100%; overflow-wrap: anywhere; }
  .mt-language-button { display: flex; align-items: center; gap: 5px; min-width: 0; max-width: 100%; padding: 4px 0; border: 0; background: transparent; color: hsl(var(--muted-foreground)); font: inherit; font-size: 10px; cursor: pointer; }
  .mt-language-button > span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .mt-language-button > svg { flex-shrink: 0; }
  .mt-language-button:hover { color: hsl(var(--foreground)); }
  .mt-language-button:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 3px; border-radius: 3px; }
  .mt-language-settings { display: flex; flex-direction: column; flex-shrink: 0; min-width: 0; min-height: 0; max-height: 350px; overflow: hidden; margin: 0 var(--mt-gutter) 10px; padding: 10px 12px; border: 1px solid hsl(var(--border)); border-radius: 10px; background: hsl(var(--muted) / .3); }
  .mt-settings-fields { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
  .memorall-transcription[data-settings=true] > .mt-header, .memorall-transcription[data-settings=true] > .mt-meta, .memorall-transcription[data-settings=true] > .mt-reader-wrap { display: none; }
  .memorall-transcription[data-settings=true] .mt-language-settings { flex: 1 1 0; max-height: none; margin-top: var(--mt-gutter); }
  .mt-settings-heading { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 7px; }
  .mt-settings-heading h3 { margin: 0; font-size: 12px; font-weight: 600; color: hsl(var(--foreground)); }
  .mt-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 9px; color: hsl(var(--muted-foreground)); font-size: 11px; }
  .mt-field select { width: 100%; min-width: 0; height: 32px; padding: 0 7px; border: 1px solid hsl(var(--border)); border-radius: 6px; background: hsl(var(--background)); color: hsl(var(--foreground)); font: inherit; font-size: 11px; }
  .mt-field select:disabled { opacity: .6; }
  .mt-field select:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 2px; }
  .mt-original-toggle { display: flex; align-items: center; gap: 7px; margin: 8px 0; font-size: 11px; color: hsl(var(--foreground)); }
  .mt-original-toggle input { appearance: auto; width: 14px; height: 14px; accent-color: hsl(var(--primary)); }
  .mt-settings-hint { margin: 6px 0; font-size: 10px; line-height: 1.6; color: hsl(var(--muted-foreground)); overflow-wrap: anywhere; }
  .mt-settings-error { margin: 6px 0; font-size: 11px; color: hsl(var(--foreground)); overflow-wrap: anywhere; }
  .mt-settings-privacy { flex-shrink: 0; }
  .mt-settings-actions { display: flex; flex-shrink: 0; align-items: center; justify-content: flex-end; gap: 6px; margin-top: 9px; }
  .mt-caret { display: inline-block; width: 2px; height: 14px; vertical-align: -2px; margin-left: 3px; background: hsl(var(--primary)); animation: mt-pulse 1s ease-in-out infinite; }
  .mt-pending { display: flex; align-items: center; gap: 7px; font-size: 11px; color: hsl(var(--muted-foreground)); }
  .mt-jump { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); border-radius: 999px; box-shadow: 0 4px 18px rgb(0 0 0 / .16); font-size: 11px; height: 32px; }
  .mt-empty { min-height: 180px; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 18px; color: hsl(var(--muted-foreground)); }
  .mt-empty-mark { width: 52px; height: 52px; border-radius: 16px; display: grid; place-items: center; background: hsl(var(--muted) / .7); margin-bottom: 14px; }
  .mt-empty h3 { margin: 0; font-size: 14px; font-weight: 550; color: hsl(var(--foreground)); }
  .mt-empty p { margin: 7px 0 0; max-width: 270px; font-size: 12px; line-height: 1.7; }
  .mt-footer { flex-shrink: 0; border-top: 1px solid hsl(var(--border) / .7); background: hsl(var(--muted) / .15); padding: 12px var(--mt-gutter); }
  .mt-mini { position: fixed; right: 18px; bottom: 82px; display: flex; align-items: center; gap: 10px; max-width: calc(100vw - 36px); padding: 7px 8px 7px 14px; border: 1px solid hsl(var(--border)); border-radius: 999px; background: hsl(var(--background) / .96); color: hsl(var(--foreground)); box-shadow: 0 10px 30px rgb(0 0 0 / .18); pointer-events: auto; font: 12px "Space Grotesk", system-ui, sans-serif; backdrop-filter: blur(12px); }
  .mt-mini time { color: hsl(var(--muted-foreground)); font-variant-numeric: tabular-nums; }
  .mt-meta { display: flex; flex-shrink: 0; align-items: center; gap: 7px; padding: 0 var(--mt-gutter) 12px; font-size: 11px; color: hsl(var(--muted-foreground)); }
  .mt-meta time { font-variant-numeric: tabular-nums; }
  .mt-meta-divider { opacity: .5; }
  .mt-meta progress { width: 70px; height: 3px; margin-left: auto; accent-color: hsl(var(--primary)); }
  .mt-clean-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 62px; }
  .mt-clean-footer > span { font-size: 10px; max-width: 65%; overflow-wrap: anywhere; }
  .mt-footer-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; margin-left: auto; }
  .mt-next-wrap { position: relative; flex-shrink: 0; margin-left: auto; }
  .mt-finish { height: 33px; border-radius: 8px; padding: 0 14px; font-size: 12px; }
  .mt-next-menu { position: absolute; right: 0; bottom: calc(100% + 10px); width: min(294px, calc(100vw - 64px)); max-height: min(380px, max(110px, calc(100dvh - 230px))); overflow-y: auto; padding: 7px; border: 1px solid hsl(var(--border)); border-radius: 12px; background: hsl(var(--popover)); color: hsl(var(--popover-foreground)); box-shadow: 0 12px 36px rgb(0 0 0 / .18); z-index: 4; }
  .mt-next-menu > p { margin: 5px 9px 8px; color: hsl(var(--muted-foreground)); font-size: 11px; }
  .mt-next-item { display: flex; width: 100%; justify-content: flex-start; height: 35px; padding: 0 9px; font-size: 12px; border-radius: 6px; }
  .mt-recommended { margin-left: auto; padding: 2px 5px; border-radius: 4px; background: hsl(var(--primary) / .08); color: hsl(var(--primary)); font-size: 9px; }
  .mt-menu-divider { height: 1px; margin: 6px 3px; background: hsl(var(--border)); }
  .mt-issue { flex-shrink: 0; min-width: 0; margin: 0 var(--mt-gutter) 12px; padding: 10px 12px; border: 1px solid hsl(var(--border)); border-radius: 10px; background: hsl(var(--muted) / .4); color: hsl(var(--foreground)); font-size: 12px; line-height: 1.5; }
  .mt-issue summary { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; list-style: none; }
  .mt-issue summary::-webkit-details-marker { display: none; }
  .mt-issue summary > span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .mt-issue-icon, .mt-issue-toggle { flex-shrink: 0; margin-top: 2px; color: hsl(var(--muted-foreground)); }
  .mt-issue[open] .mt-issue-toggle { transform: rotate(180deg); }
  .mt-issue summary:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 4px; border-radius: 2px; }
  .mt-issue p { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 80px; overflow: auto; margin: 10px 0 0; padding-top: 10px; border-top: 1px solid hsl(var(--border)); color: hsl(var(--muted-foreground)); font-size: 11px; }
  .mt-notes { margin-bottom: 28px; padding-bottom: 24px; border-bottom: 1px solid hsl(var(--border) / .7); }
  .mt-notes h3 { display: flex; align-items: center; gap: 7px; margin: 0 0 10px; font-size: 13px; font-weight: 600; color: hsl(var(--foreground)); }
  .mt-listening { padding-left: 42px; }
  .mt-studio-wrapper { display: flex; flex-direction: column; min-width: 0; min-height: 0; flex: 1 1 0; overflow: hidden; }
  .mt-page-root, .memorall-transcription-page { min-width: 0; min-height: 0; display: flex; flex: 1 1 0; flex-direction: column; color: hsl(var(--foreground)); font: 400 15px/1.8 "Space Grotesk", system-ui, sans-serif; }
  .mt-page-root { align-items: center; overflow: hidden; }
  .memorall-transcription-page { --mt-gutter: clamp(16px, 3vw, 28px); width: min(100%, 850px); }
  .memorall-transcription-page .mt-header { padding-top: 22px; padding-bottom: 8px; }
  .memorall-transcription-page .mt-heading h2 { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; font-size: 18px; font-weight: 600; line-height: 1.5; }
  .memorall-transcription-page .mt-source { margin-top: 5px; font-size: 11px; }
  .memorall-transcription-page .mt-reader { padding-top: 14px; padding-bottom: 48px; }
  .memorall-transcription-page .mt-text { font-size: 15px; line-height: 1.9; }
  .memorall-transcription-page .mt-paragraph { padding-bottom: 19px; padding-left: 52px; }
  .memorall-transcription-page .mt-clean-footer { background: transparent; }
  @keyframes mt-pulse { 50% { opacity: .35; } }
  @media (prefers-reduced-motion: reduce) { .memorall-transcription, .mt-dot, .mt-caret { animation: none !important; } }
  @media (max-width: 480px) { .memorall-transcription.memorall-chat-shell--popup { --mt-gutter: 14px; right: 10px; bottom: 72px; width: calc(100vw - 20px); height: min(580px, calc(100dvh - 92px)); } .mt-header { padding-top: 12px; padding-bottom: 10px; } .memorall-transcription-page .mt-heading h2 { font-size: 16px; } }
`;
