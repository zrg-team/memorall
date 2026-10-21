# Continuous tab transcription

Multilingual **Whisper Base** is selected by default when no transcription model
has been saved. It downloads on first use, and Studio starts with automatic
language detection and original-language transcription. You can choose another
speech-to-text model in **Studio → Transcribe**, including OpenRouter models. On a meeting or
video page, right-click and choose **Memorall → Start / stop tab transcription**.
The in-page panel focuses on the original-language transcript, with a compact
status line with separate **Stop recording** and **Close** buttons in a fixed
footer. Stop ends audio capture, saves the remaining audio, and leaves the
transcript visible without automatically opening a menu or requiring another
action. Close simply dismisses the window. A prominent **Close** button stays
beside optional **Next steps** after stopping. The transcript remains in its
thread. In Studio, stopping also leaves the transcript visible. **Next steps**
is optional on a saved transcript: create a recommended summary, create meeting
notes, save to Files, download Markdown, send to chat, or copy. Closing never
triggers one of these actions. Notes never run automatically.
The same context-menu item stops recording if the page cannot
display the panel. Only one tab is recorded at a time.

In **Studio → Transcribe → Sessions**, each tab recording is a separate thread
named after the video or meeting. Select it to read the complete transcript in
the same reader, generate or retry notes, and export or send it to chat. Existing
recordings are promoted into this list with their IDs and messages preserved. A selected
chat model is required for notes. It can be local or remote; a remote chat model
receives transcript text. Audio uses the selected speech-to-text model, including
local Transformers models and OpenRouter's dedicated speech models. A cloud speech
model receives audio; an on-device speech model keeps audio local. Changing the selected transcription
model does not change a recording already in progress.

## Capture scope

Chrome and Edge 116+ are supported. Capture uses the tab's audio output, so it
works across HTML media, embedded frames, and WebRTC meeting audio without
site-specific selectors. It cannot capture protected media or browser pages.
The user's microphone is not captured separately; their own voice is present
only if the tab plays it back. Recording begins only from an extension
context-menu invocation. A content-script click alone does not grant Chrome's
tabCapture user invocation.

The service worker obtains a stream ID and the offscreen document consumes it.
The existing offscreen document now declares `USER_MEDIA` as well as
`IFRAME_SCRIPTING`. The recorder reconnects the source to the audio destination
to preserve normal playback. Content scripts provide isolated controls and
restore them on navigation. Recording continues if the popup or Studio closes.
Closing the captured tab or ending its media stream flushes the final window.
The current notes preference also applies to these automatic stops.

See Chrome's [capture guide](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture)
and [tabCapture reference](https://developer.chrome.com/docs/extensions/reference/api/tabCapture).

## Persistence and completion

An AudioWorklet mixes audio to mono in a 16 kHz AudioContext and emits contiguous
PCM windows, plus a final partial window. A quiet pause of 350 ms ends a window
once at least 1.5 seconds have accumulated, with a maximum of five seconds for
local recognition and three seconds for cloud recognition. This lightweight
pause endpoint does not classify speakers or speech. No samples are dropped.
Every window becomes a
standalone WAV in the existing documents filesystem under
`/resources/audio/recordings/`. This avoids treating MediaRecorder timeslices as
independently decodable files.

The existing database tables store these records without a schema migration:

- `conversations.mode = 'speech-to-text'`: one thread per recording; source title, URL, tab ID, selected
  model, start/end times, completion status, and summary metadata in
  `metadata.tabTranscription`.
- `messages.type = 'transcription_chunk'`: one row per window, with transcript
  text in `content`, and index, timing, WAV path, status, and timestamped segments
  in `metadata.chunk`. Chunk IDs stay constant when results replace pending rows.

Model preparation begins with capture, rather than waiting for the first window.
The floating reader refreshes every 300 ms and streams partial text into full
paragraphs. Studio also refreshes the bounded live snapshot every 300 ms, while
full history is refreshed separately every two seconds, avoiding repeated reads
of an entire long recording on every text update. The reader uses
unobtrusive timestamps. It follows new text until the user scrolls
back or selects text; **Back to live** resumes following. Minimizing preserves the
reading position and recording. It uses the existing embedded React bundle,
shadow-root stylesheet, fonts, theme provider, buttons, and Markdown renderer.
Both the panel and minimized pill have an explicit **×** button that only
dismisses the window. Close and **×** never stop capture, generate notes, export,
or send text to chat. Closing stops progress polling without deleting the saved
thread. An explicit show opens it again. Escape closes the next-step menu first,
then dismisses the floating panel. Minimize keeps recording active.
The minimized reader also keeps a separate Stop control.
Live following survives font
loading and resizing; scrolling back or selecting text pauses it.
Studio uses the same reader with a wider, centered reading column.
Audio save windows flow together in this reader. Timestamps mark paragraph
starts, with breaks at completed sentences after about 280 characters or 20 seconds.
Unpunctuated paragraphs are bounded at window boundaries after 700 characters or
45 seconds. Silence, failed audio, and missing windows break the flow. This is a
display heuristic; it does not add semantic voice activity detection or overlapping
recognition context. End-to-end latency still depends on model throughput.
The header, status, notices, transcript, and footer share that column. Notices
use readable theme colours, and selected text has an explicit contrast pair.
Long titles are limited to two lines in Studio so recording controls remain
visible. Saved threads open at the beginning; active recordings follow live text.
Open thread uses the installed manifest's app page (including the production
`options/index.html` path) and selects the recording by ID. Recordings outside
the most recent history page stay selected when the list refreshes.

Progress responses contain the latest twelve source windows plus at most twelve
recent translation updates and the current translation. This lets delayed
translation update text after source capture has advanced. The overlay retains seen
paragraphs, up to 600 while following; paragraphs are never discarded while the
user reads earlier text. The thread and every export use the complete saved
transcript. Save to Files writes `/transcripts/<title>-<session>.md`. Downloads
include source information, timestamps, notes when present, and failed-window
markers. Send to chat prepares the full transcript for the chat composer without
automatically submitting a request.

Audio persistence and local inference use separate ordered queues. Later audio
is saved while the model is working. Two minutes of outstanding audio bound the backlog;
an overloaded model stops recording with an explicit error. Saved audio and
transcript rows remain available. Digital-silence windows do not call the model.
At most the current, incomplete window can be lost if the recorder process is
terminated abruptly. On the next owner initialization, unfinished recordings
and pending windows are marked interrupted/failed, preserving completed rows.

Stopping flushes the recorder and drains all accepted windows in the background.
No follow-up choice is required. Notes can be requested later from the saved thread.
Notes use bounded prompts and hierarchical reduction for long
meetings. Failed windows appear as missing-audio markers in model input. Notes
failures leave the transcript intact and can be retried from Studio. Both speech
and chat requests are booked in the existing model usage ledger.

## Live translation and OpenRouter

Open **Languages & translation** in the reader footer. Choose the spoken language
or automatic detection, an optional target language, and a translation model.
**Apply** commits the choices; **Cancel**, **Close**, and **×** never enable
translation or trigger an output action. Settings carry over to the next recording.
Translation is off by default. **Show original text too** switches between a
bilingual reader and translation-only reading. Arabic and Hebrew use automatic
text direction. The same controls work in saved tab-recording threads.
Language preferences use the app's IndexedDB-backed shared storage, which works
inside the hidden recorder where the browser's extension storage API is unavailable.
Hosted auto-detection stays automatic for later segments, rather than locking
the recording to the first detected language. An explicit spoken-language choice
is sent to the speech provider when selected.

The translation picker includes the selected chat model and configured OpenRouter
chat models. Configure OpenRouter's key and choose its speech model in Studio's
usual model picker. The speech catalog uses `/models?output_modalities=transcription`;
recognition uses `/audio/transcriptions` with multipart WAV and JSON output. It
does not probe unsupported streaming or verbose formats on each segment. See
[OpenRouter's speech-to-text guide](https://openrouter.ai/docs/guides/overview/multimodal/stt).

Original recognition, persistence, and translation use independent queues.
Original text appears first; new live speech takes priority over older text in
the translation queue. Translation streams alongside it through the chosen
chat provider. The previous two source segments (up to 500 characters) provide
context without being translated again. Text translation sends transcript text
to its model; it does not send audio to a chat model. The language form explains
cloud data handling before Apply. Provider keys stay in the service layer.

Finished translations use `metadata.chunk.translations[language]` on the existing
chunk row. Switching targets keeps completed results for other languages.
Completed results for the same target and model are reused. Stale in-flight
output is cancelled and cannot repaint a new language. A 30-second timeout or
provider error pauses translation without stopping capture or changing the
original transcript. Reapplying settings retries missing translations. Interrupted
translation is marked retryable when the owner restarts. Exports, Save to Files,
Copy, and Send to chat include the source plus selected target, with explicit
markers for unfinished text. Summaries use the chosen target language when enabled.

This is incremental, chunk-based transcription with streamed text translation.
OpenRouter's documented speech endpoint returns completed JSON transcripts; this
integration does not claim native audio WebSockets or a guaranteed sub-second
delay. First-use downloads, local inference, the selected models, network
conditions, and provider capacity affect actual latency.

## Local model choices and failures

The model browser recommends the multilingual Transformers.js exports
`onnx-community/whisper-base` (the default), `whisper-tiny` (use after a memory failure),
and `whisper-small`. It checks actual Hub files before enabling the choices.
English-only `.en` exports and `distil-large-v3` are not multilingual choices.

The installed Whisper generator defaults to English without a supplied language.
For multilingual models, the runner explicitly predicts the language token from
audio before transcription. Tab recordings reuse that detected language on later
windows. Explicit language selections bypass detection. The timestamp-aware
Whisper streamer and transcript normalization remove internal control tokens
from live text, saved text, notes, and exports. Inference failures are returned
without retrying in English or repeating a failed allocation.

ASR repositories must include ONNX weights, a supported architecture, `config.json`,
`tokenizer.json`, and `preprocessor_config.json`. Incomplete exports are rejected
before downloading weights. Missing shared assets are terminal; changing precision
cannot replace them. Memory failures also stop without a larger full-precision retry
and release the worker so a smaller model can load. An unhandled worker download
rejection is returned to the caller instead of leaving the UI waiting. Queued audio
remains saved and is marked failed without loading the same failed model repeatedly.

## Verification

Tests cover ordered inference with concurrent persistence, final-window timing,
silence, backlog limits, storage/model failures, summary retry, bounded summary
prompts, PCM mixing and flush behavior, language detection, timestamp streaming,
content-tab command scoping, paused reading, Finish choices, exports, and chat handoff.

For a live smoke test, reload the extension, select a downloaded local ASR model
and a chat model, play a video, and start from its context menu. Confirm playback
continues and at least two transcript windows appear. Stop partway through the
next window and verify that its tail is saved. Choose a summary and then verify
Save to Files, Markdown download, and Send to chat include the full transcript. Repeat with
a meeting, an embedded player, a tab navigation, a closed Studio, and closing
the captured tab. Verify that an unrelated tab cannot stop or read its session.
