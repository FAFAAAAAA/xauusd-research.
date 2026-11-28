# Host side: capturing a Chrome tab with audio and sending it over WebRTC (desktop Chrome, 2025-2026)

Scope: desktop Chrome host shares a tab (YouTube or a local video) with tab audio via getDisplayMedia, sends P2P to one iPhone viewer. Research date 2026-11-28. This was a capped research pass (about 19 tool calls). Several items that are widely known in practice but that I could not source this session are marked as inference or gap. They are not stated as fact.

## 1. getDisplayMedia options in current Chrome (defaults, versions, "Share tab audio")

### Takeaway
Every option asked about exists in Chrome desktop. Chrome's default for `selfBrowserSurface` is "exclude", and its defaults for `systemAudio` and `monitorTypeSurfaces` are "include". Newer additions: `windowAudio` (Chrome 141), `restrictOwnAudio` (about Chrome 140, Windows/Mac only), Captured Surface Control (136) and CapturedSurfaceResolution / `screenPixelRatio` (136). For a "watch together" host, pass `displaySurface: "browser"`, `selfBrowserSurface: "exclude"`, `surfaceSwitching: "include"`, `audio: true`, a CaptureController with `setFocusBehavior("focus-captured-surface")`, and decide on `suppressLocalAudioPlayback` (keep it false so the host still hears the film).

### Cited Findings
- The spec's `DisplayMediaStreamOptions` defaults are `video: true` and `audio: false` ("If false, the MediaStream will not contain an audio track"). The UA "MUST reject audio-only requests" and "MUST NOT share audio without active user consent", and it may return video only even when audio was requested. — [W3C Screen Capture ED](https://w3c.github.io/mediacapture-screen-share/)
- The spec treats `selfBrowserSurface`, `systemAudio`, `windowAudio`, `surfaceSwitching` and `monitorTypeSurfaces` as hints ("If present, signals application preference… The user agent MAY ignore this hint"). The spec states no defaults for them. The current Editor's Draft also has an `audioSelection` member ("signals whether the application would like the user agent to steer the user towards sharing audio"). I did not confirm that Chrome implements `audioSelection`. — [W3C Screen Capture ED](https://w3c.github.io/mediacapture-screen-share/)
- Chrome-documented values and versions:
  - `displaySurface`: "browser", "window" or "monitor". It is a preference only, and the spec says it "can therefore not cause any side effects".
  - `surfaceSwitching`: "include" shows the "Share this tab instead" button and "exclude" hides it. No default is stated.
  - `selfBrowserSurface`: default "exclude" ("Presently, the default value for selfBrowserSurface is "exclude""). It is mutually exclusive with `preferCurrentTab: true`.
  - `systemAudio`: default "include". With "exclude", Chrome "will offer to capture audio alongside tabs and windows, but not alongside screens".
  - `monitorTypeSurfaces`: default "include", added in Chrome 119.
  - Versions: the article text says `displaySurface`, `surfaceSwitching` and `selfBrowserSurface` are in Chrome 107, but its support badges say 105. The source is inconsistent. `systemAudio` is listed as 105.
  - Source: [Chrome: Privacy-preserving screen sharing controls](https://developer.chrome.com/docs/web-platform/screen-sharing-controls)
- The same Chrome article says "some users are confused when they explicitly check the checkbox to share system audio". The audio-share option is a checkbox or toggle in the picker that the user controls. — [Chrome: screen sharing controls](https://developer.chrome.com/docs/web-platform/screen-sharing-controls)
- `windowAudio` takes "exclude", "system" or "window". It hints whether the user should be offered audio when a *window* is selected. It shipped on desktop in Chrome 141 and is desktop only. — [blink-dev Intent to Ship: windowAudio](https://groups.google.com/a/chromium.org/g/blink-dev/c/66dDyQoX3RI)
- `restrictOwnAudio` tells the UA to "attempt to remove any audio… produced by the document that performed getDisplayMedia". The Intent to Ship (July 2025) gives an estimated milestone of 140. It ships only on Windows and Mac, because Linux and ChromeOS lack the system-audio path it depends on. It only matters when the captured surface includes system audio. — [blink-dev Intent to Ship: restrictOwnAudio](https://groups.google.com/a/chromium.org/g/blink-dev/c/5SZfg29iwPc); [W3C Screen Capture ED](https://w3c.github.io/mediacapture-screen-share/); [MDN restrictOwnAudio](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/restrictOwnAudio)
- `suppressLocalAudioPlayback`: "A value of true indicates that the user agent SHOULD perform local audio playback suppression" of the captured tab. MDN marks it experimental. You can read it back with `track.getSettings().suppressLocalAudioPlayback` and detect it with `getSupportedConstraints()`. Neither the spec nor MDN states a default value. — [W3C Screen Capture ED](https://w3c.github.io/mediacapture-screen-share/); [MDN suppressLocalAudioPlayback](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/suppressLocalAudioPlayback). A Chrome "Intent to Ship: MediaTrackSupportedConstraints.suppressLocalAudioPlayback" thread exists. — [blink-dev](https://groups.google.com/a/chromium.org/g/blink-dev/c/Fm1nz7Hs7Xo)
- `CaptureController.setFocusBehavior()` takes "focus-captured-surface" or "focus-capturing-application" and is available from Chrome 109. Timing rules:
  - You can call it many times before the getDisplayMedia promise resolves, or once immediately after it resolves. The last call wins.
  - A call made after that microtask throws, for example inside a `setTimeout` callback.
  - A call made more than 1 s after capture starts fails silently.
  - It throws if the track is not live or if the user shared a whole screen.
  - The article states no default.
  - Source: [Chrome: Conditional focus](https://developer.chrome.com/docs/web-platform/conditional-focus)
- Captured Surface Control lets the capturer scroll and zoom the captured tab. It is in Chrome 136, desktop only. Shipped API names: `forwardWheel()`, `increaseZoomLevel()`, `decreaseZoomLevel()`, `resetZoomLevel()` and a read-only `zoomLevel`. The earlier explainer names `sendWheel` and `setZoomLevel` are not the shipped ones. The first call triggers a permission prompt. — [Chrome: Scroll and zoom a captured tab](https://developer.chrome.com/docs/web-platform/captured-surface-control); [explainer](https://github.com/screen-share/captured-surface-control)
- CapturedSurfaceResolution exposes the pixel ratio of the captured surface (`screenPixelRatio`). It shipped on Mac and Windows in Chrome 136, with Linux and ChromeOS around 137. Android is not supported because it has no getDisplayMedia. — [blink-dev Intent to Ship: CapturedSurfaceResolution](https://groups.google.com/a/chromium.org/g/blink-dev/c/jdCVfxAUFLc)

### Inferences
- For tab sharing, audio comes from the tab itself, so `systemAudio` and `windowAudio` matter only if the user picks a screen or window. To make audio more likely, steer the user to a tab with `displaySurface: "browser"`.
- The host also watches the film. Do not set `suppressLocalAudioPlayback: true`, or the host's own speakers go silent. My understanding is that Chrome's effective default is false, but no source this session confirmed it.
- `restrictOwnAudio` is irrelevant if the host app page plays no sound itself.
- The user can untick "Share tab audio". Always check `stream.getAudioTracks().length` and tell the user if it is 0.

### Gaps
- I did not confirm the exact Chrome milestone for `suppressLocalAudioPlayback`. I believe it is around M109, but this is unverified.
- I did not confirm Chrome's `preferCurrentTab` version. It is only relevant if the host shares its own tab, which this app does not do.
- I did not confirm whether the tab-audio checkbox defaults to checked in the current Chrome picker.
- I did not confirm whether Chrome implements `audioSelection`.

## 2. Audio constraints for tab audio (echoCancellation, noiseSuppression, autoGainControl, channelCount, stereo)

### Takeaway
I found no authoritative source for Chrome's default processing on getDisplayMedia audio. The safe approach is to request `audio: {echoCancellation:false, noiseSuppression:false, autoGainControl:false, channelCount:2}` explicitly and verify the result with `getSettings()`. Setting `contentHint = "music"` on the audio track is the spec's way to signal "no voice processing".

### Cited Findings
- The content-hint spec says audio hint "music" makes the UA default echoCancellation, autoGainControl and noiseSuppression to false. Hint "speech" defaults echoCancellation and autoGainControl to true. — [W3C mst-content-hint](https://w3c.github.io/mst-content-hint/)
- Community reports on Chrome (getUserMedia context, not getDisplayMedia): with echoCancellation true and channelCount not explicitly 2, the track's channelCount is always 1. Getting true stereo requires disabling the processing. — [Chromium media-dev thread](https://groups.google.com/a/chromium.org/g/media-dev/c/TrQViZJncVA/m/CaXwKZ-ZAAAJ); [addpipe: true stereo with getUserMedia](https://blog.addpipe.com/recording-true-stereo-audio-using-getusermedia/)
- A third-party code comment says Chrome's `getDisplayMedia({audio:true})` captures tab audio, and on Windows captures full system audio when a screen is shared. — [AssemblyAI SDK source](https://app.unpkg.com/assemblyai@4.36.4/files/src/services/streaming/browser/dual-channel-capture.ts)

### Inferences
- Explicit constraints plus `contentHint="music"` should give unprocessed stereo, provided the capture path is stereo (YouTube audio is stereo). Verify with `getSettings().channelCount`.

### Gaps
- I could not source Chrome's defaults for display-audio constraints. I recall that tab audio is not run through the APM echo canceller by default, but this is unverified.
- I could not confirm that tab-capture audio arrives as 2 channels in current Chrome. Test it with `getSettings()` and webrtc-internals.

## 3. MediaStreamTrack.contentHint: 'motion', 'detail', 'text'

### Takeaway
"motion" makes the encoder keep framerate and reduce resolution. "detail" and "text" make it keep resolution and drop framerate. "text" also turns on AV1 screen-content tools. For movies use `track.contentHint = "motion"`.

### Cited Findings
- The spec's mapping:
  - "motion" maps to `maintain-framerate`.
  - "detail" maps to `maintain-resolution`.
  - "text" maps to `maintain-resolution`, and "if the encoding codec is AV1, activate encoding tools for 'text' mode".
  - These defaults apply to an RTCRtpSender "unless an explicit degradationPreference attribute has been set in the sender's parameters".
  - Source: [W3C mst-content-hint](https://w3c.github.io/mst-content-hint/)
- The degradationPreference intent says the setting is "used with MediaStreamTrack contentHint feature and are specified together". The use case it describes is favoring resolution for screenshares and framerate for regular video calls. — [blink-dev Intent: RTCRtpSendParameters.degradationPreference](https://groups.google.com/a/chromium.org/g/blink-dev/c/WPvxi5nUK2E/m/sGUnH8DdAgAJ); [chromestatus 5135353876840448](https://chromestatus.com/feature/5135353876840448)

### Inferences
- Screen-capture tracks are treated as screencast or detail-like unless hinted. Without the hint, a congested link would keep resolution and drop fps, which is bad for film. Set "motion".

### Gaps
- I did not verify Chrome's internal default degradation for an unhinted screen-capture track. I believe screencast content defaults to maintain-resolution, but this is unverified.

## 4. RTCRtpSender.setParameters: maxBitrate, maxFramerate, scaleResolutionDownBy, priority, degradationPreference

### Takeaway
Chrome supports `degradationPreference` in setParameters. chromestatus lists it as shipped in Chrome 83, desktop and Android, "Enabled by default". The spec text moved from webrtc-pc to the content-hint spec. A fourth value, "maintain-framerate-and-resolution", went through Intent to Ship in Oct 2025 and appears to be in Chrome/Edge 144.

### Cited Findings
- `RTCRtpSendParameters.degradationPreference` is shipped in Chrome 83 (desktop and Android), status "Enabled by default". — [chromestatus](https://chromestatus.com/feature/5135353876840448)
- "This API was already part of the WebRTC 1.0 review then moved to the Content Hint specification." — [blink-dev intent (2020)](https://groups.google.com/a/chromium.org/g/blink-dev/c/WPvxi5nUK2E/m/sGUnH8DdAgAJ)
- "maintain-framerate-and-resolution": the Intent to Ship (Oct 2025) adds it to the RTCDegradationPreference enum. It disables WebRTC's built-in resolution and framerate adaptation so the app can run its own logic. It "will not be used as a default or as a fallback option". MDN says it may drop frames before encoding. Caniuse lists Edge 144+, and a related thread mentions "Shipping on desktop 144". The milestone is not fully confirmed. — [blink-dev Intent to Ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/FUlvv_Lmk-s); [caniuse](https://caniuse.com/mdn-api_rtcrtpsender_setparameters_parameters_degradationpreference_parameter_maintain-framerate-and-resolution_value); [MDN setParameters](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpSendParameters)
- Firefox's degradationPreference intent targeted Firefox 138. — [mozilla dev-platform](https://groups.google.com/a/mozilla.org/g/dev-platform/c/W308XfoORIA)

### Inferences
- Values available today: "balanced", "maintain-framerate", "maintain-resolution", plus "maintain-framerate-and-resolution" from about M144.
- Map presets to sender parameters:
  - 480p, 720p and 1080p: `encodings[0].maxBitrate`, `maxFramerate: 30`, and `scaleResolutionDownBy = sourceHeight/targetHeight`. Clamp to ≥1, because the spec forbids upscaling.
  - Auto: no cap, plus `degradationPreference: "maintain-framerate"` or "balanced".
- Change parameters with get-modify-set: `p = sender.getParameters(); …; sender.setParameters(p)`. This needs no renegotiation.
- `priority` / `networkPriority` matter little with one video and one audio sender.

### Gaps
- I did not verify current Chrome handling of `priority` / `networkPriority` (DSCP marking).
- I did not verify whether Chrome still accepts `degradationPreference` at the top level of the parameters, as opposed to per encoding.

## 5. Codec choice (H.264 / VP8 / VP9 / AV1), hardware vs software, iPhone receiver, scalabilityMode

### Takeaway
For high-motion tab video to an iPhone, H.264 is the most CPU-efficient. It has broad hardware encode on Windows and Mac and hardware decode on every iPhone. AV1 compresses best but is mostly software (libaom) on the encode side and costs more CPU. VP9 used the most CPU on motion in one test. Use `setCodecPreferences` with H.264 first and VP8 as fallback. `scalabilityMode` (SVC) gives little benefit for one receiver.

### Cited Findings
- An independent test of Chrome screen-share codecs at about 1.5 MP and about 24 fps, motion content. Combined send+receive CPU:

  | Codec | CPU |
  |---|---|
  | VP9 | 364% |
  | AV1 | 287% |
  | VP8 | 270% |
  | H.264 | 213% |

  H.264 and AV1 reached 20+ fps at 2+ Mbps. VP8 and VP9 ran at about half that frame rate and needed about 4+ Mbps. H.264 "benefits from widespread hardware acceleration". AV1 encode is mostly software. The test used a dev Chrome build of unspecified version. — [HackerNoon: 4 codecs test](https://hackernoon.com/how-good-is-webrtc-screen-sharing-really-i-put-4-codecs-to-the-test)
- Chrome AV1 (libaom): libaom 3.6.0 added screen-sharing improvements. "AV1 Speed 10 provides 45% better compression while running 35% faster" than VP9 speed 7. Available to WebRTC apps from Chrome 113. — [Chrome blog: AV1](https://developer.chrome.com/blog/av1)
- A Chromium thread (March 2025) says AV1 "is not an option for use cases that require hardware acceleration". An Intel Arc report says the AV1 hardware encoder is not registered in Media Foundation, so the encoder fell back to software. — [blink-dev](https://mid.mail-archive.com/blink-dev@chromium.org/msg13011.html); [Intel community](https://community.intel.com/t5/Graphics/AV1-encoding-not-available-Poor-video-encoding/m-p/1754079)
- Chrome and Edge on Windows are getting an improved H.264 screen-share path through Media Foundation hardware encoding. The date was unconfirmed. — [Android Authority](https://www.androidauthority.com/google-chrome-edge-screen-sharing-improvement-3693721/)
- Practitioner guidance: AV1 and VP9 look better for screen sharing but use more CPU. H.264 uses less battery where hardware-accelerated. — [vdo.ninja codecs](https://vdo.ninja/codecs)
- One report says Chrome on macOS may drop frame rates suddenly with the H.264 encoder. This is anecdotal. — [vdo.ninja hardware encoding guide](https://docs.vdo.ninja/guides/hardware-accelerated-video-encoding)
- MDN WebRTC codec support: VP9 Chrome 48+, AV1 Chrome 113+. — [MDN WebRTC codecs](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/WebRTC_codecs)
- Chrome has an Intent to Ship for H.265 (HEVC) in WebRTC. I did not confirm its status. — [blink-dev](https://groups.google.com/a/chromium.org/g/blink-dev/c/3h8lL8a377c)

### Inferences
- iPhone Safari decodes H.264 in hardware on all models. VP8 and VP9 are supported, and AV1 hardware decode exists only on recent chips (A17 Pro / M3 and newer). These are background facts I did not re-source this session. H.264 is the most robust choice for battery and thermals on the phone.
- Chrome's software H.264 fallback is OpenH264. If the GPU encoder is unavailable or blocklisted, H.264 becomes software and can lose its CPU advantage. Check `encoderImplementation` and `powerEfficientEncoder` in `getStats()` outbound-rtp. This is background knowledge, not sourced this session.
- With one receiver, simulcast or SVC (`scalabilityMode` such as L1T3) only offers temporal-layer resilience. The default L1T1 or none is fine.

### Gaps
- I found no official 2025-2026 Chrome document listing per-OS hardware encoder availability (VideoToolbox on macOS, MediaFoundation on Windows) for WebRTC.

## 6. Opus stereo and high bitrate

### Takeaway
Chrome sends mono Opus by default. To send stereo, the remote SDP must advertise `stereo=1` on the Opus fmtp line: the viewer munges its answer, or the host munges the remote description before `setRemoteDescription`. Add `maxaveragebitrate` (for example 128000–510000) and set `encodings[0].maxBitrate` on the audio sender. For film, disable DTX (`usedtx=0`, the default). FEC (`useinbandfec=1`) is on by default in Chrome.

### Cited Findings
- "Today in Chrome, you get mono by default, but if 'stereo=1' is used you get stereo." — [W3C webrtc-extensions issue #63](https://github.com/w3c/webrtc-extensions/issues/63)
- Per RFC 7587 §7.1, `stereo` is a receive-side parameter: it says what the receiver wants. A community answer adds `stereo=1; maxaveragebitrate=510000` to the answer's Opus fmtp line by string replace. — [W3C webrtc-extensions #63](https://github.com/w3c/webrtc-extensions/issues/63); [Stack Overflow archive](https://kiwix.lema.org/stackoverflow.com_en_all_2023-11/questions/33649283/how-to-set-up-sdp-for-high-quality-opus-audio)
- Intended rule: the sender uses min(remote `stereo`, local `sprop-stereo`). — [Mozilla bug 818618](https://bugzilla.mozilla.org/show_bug.cgi?id=818618)
- A Chromium engineer warns that the Opus encoder "will be initialized to transmit stereo regardless of the # of channels" when stereo is negotiated, which can hurt efficiency. — [discuss-webrtc / W3C log](https://lists.w3.org/Archives/Public/public-webrtc-logs/2021Jan/0085.html)

### Inferences
- Since the viewer (iPhone Safari) creates the answer, it is simplest for the viewer to add `stereo=1;sprop-stereo=1;maxaveragebitrate=…` to its local answer before `setLocalDescription`. The host's sender then encodes stereo. Verify with `chrome://webrtc-internals` (codec fmtp, audio bytes sent).
- Reasonable film audio: 96–128 kbps stereo. Opus defaults (without maxaveragebitrate) are near 32 kbps for mono and 64 kbps for stereo. This is background knowledge, unverified.

### Gaps
- I found no current official Chrome document on stereo send. I did not verify whether `RTCRtpEncodingParameters.maxBitrate` on an audio sender raises Opus above the SDP target in current Chrome.

## 7. Recommended video bitrates (480p / 720p / 1080p, 30 fps, movie content)

### Takeaway
I found no authoritative WebRTC-specific table this session. The one empirical data point: at about 1.5 MP motion content, H.264 and AV1 needed 2+ Mbps to hold 20+ fps, and VP8 and VP9 needed about 4+ Mbps.

### Cited Findings
- H.264 and AV1 reached 20+ fps at 2+ Mbps for high-motion content at about 1.5 MP (≈ between 720p and 1080p). VP8 and VP9 needed about 4+ Mbps. — [HackerNoon codec test](https://hackernoon.com/how-good-is-webrtc-screen-sharing-really-i-put-4-codecs-to-the-test)

### Inferences
- Common practitioner ranges for H.264/VP8 at 30 fps film content (unsourced, for the writer to treat as heuristics):

  | Preset | Bitrate |
  |---|---|
  | 480p | ~1–1.5 Mbps |
  | 720p | ~2.5–4 Mbps |
  | 1080p | ~4.5–8 Mbps |

  VP9 and AV1 need about 30–45% less, which is consistent with the Chrome AV1 claim of 45% better compression than VP9.
- An Indonesia→Korea path (RTT likely 70–120 ms) should run Auto with no fixed cap and let GCC adapt.

### Gaps
- I found no official Google or W3C bitrate recommendation.

## 8. Background tab throttling, WebSocket keepalive, Document Picture-in-Picture

### Takeaway
The host page is exempt from intensive wake-up throttling. It holds a live MediaStreamTrack and an RTCPeerConnection (an open DataChannel counts explicitly), and it is usually audible. Ordinary throttling of hidden pages still caps timers to about 1 wake-up per second, so keepalives should be ≥1 s intervals or sent over the DataChannel. Document PiP (Chrome 116+) gives a small always-on-top host control window.

### Cited Findings
- Intensive throttling (Chrome 88+) applies only if all of these hold:
  - the page has been hidden more than 5 min;
  - the timer chain count is ≥5;
  - the page has been silent at least 30 s;
  - "WebRTC is not in use".

  Exemptions include pages that made sound in the past 30 s ("a silent audio track doesn't count") and WebRTC use ("an RTCPeerConnection with an 'open' RTCDataChannel", and a 'live' MediaStreamTrack). Hidden pages not intensively throttled still get the per-second throttling tier. — [Chrome: Heavy throttling of chained JS timers (Chrome 88)](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)
- Document Picture-in-Picture:
  - Chrome 116 (desktop).
  - `requestWindow({width, height, disallowReturnToOpener (Chrome 124+, default false), preferInitialWindowPlacement (Chrome 130+, default false)})`.
  - Requires a user gesture, and so do `resizeBy`, `resizeTo` and `focus`.
  - The window floats on top, never outlives its opener, cannot be navigated, and its position cannot be set by the site.
  - Source: [Chrome: Document Picture-in-Picture](https://developer.chrome.com/docs/web-platform/document-picture-in-picture)

### Inferences
- When the host switches to the YouTube tab, the host app tab is hidden but holds a live capture track and a PeerConnection, so intensive throttling should not hit it. A 1 Hz-throttled `setInterval` is still fine for a 20–30 s WebSocket ping.
- Browser-native WebSocket ping/pong frames are not JS timers, so they are not affected.
- Use the DataChannel for control messages (preset requests, play/pause sync). It also guarantees the exemption.
- A Document PiP window with Stop, quality and viewer-status controls avoids switching back to the app tab. I did not verify whether an open PiP window changes the opener's visibility state.
- Chrome may also freeze or discard background tabs (Memory Saver). Pages with active media or WebRTC are normally protected, but I did not source this.

### Gaps
- I found no source for Memory Saver or tab-freezing exemptions for capturing tabs in 2025-2026.

## 9. DRM / Widevine content (behavior only)

### Takeaway
Expect black (or frozen) video frames when the captured tab plays Widevine-protected streams (Netflix, Disney+, Prime Video). Audio behavior varies. YouTube's normal (non-purchased) videos and local files are not DRM-protected and capture normally.

### Cited Findings
- Chrome's 2019 getDisplayMedia article (Chrome 72) says capturing DRM content "will not work (Netflix in the browser)". — [addpipe: standards-compliant screen capture in Chrome 72](https://blog.addpipe.com/standards-compliant-screen-capture-in-chrome-72.md)
- Developers report that Chrome refuses to expose a MediaStream from a Netflix video element (Widevine renders protected frames itself). — [discuss-webrtc](https://groups.google.com/g/discuss-webrtc/c/TVY-q0NYyss)
- In Firefox 120, Hulu and Netflix captures became black screens. This was attributed to Widevine hardware-backed decryption. — [Mozilla support](https://support.mozilla.org/en-US/questions/1431848)
- The W3C spec does not address DRM directly. — [W3C Screen Capture ED](https://w3c.github.io/mediacapture-screen-share/)

### Inferences
- The app should warn that streaming-service content will show black to the viewer. Whether the audio still passes depends on the service and platform. This is unverified, so do not promise it.

### Gaps
- I found no current official Chrome documentation describing protected-content capture behavior. I did not verify the 2025-2026 per-OS behavior (Windows hardware DRM vs macOS).

## 10. Capture resolution vs tab size / devicePixelRatio; requesting 1080p

### Takeaway
Tab capture resolution follows the tab's rendered size. Per spec it is downscaled by the source pixel ratio by default, and the UA must not upscale. A small tab cannot give a true 1080p stream through width/height constraints. Make the tab larger (for example fullscreen the video inside the captured tab), or accept the native size. Chrome 136 exposes `screenPixelRatio` (CapturedSurfaceResolution) so apps can compute physical vs logical size.

### Cited Findings
- "The user agent SHOULD downscale by the source pixel ratio by default, unless otherwise directed by applied constraints." "MUST NOT crop the captured output." "MUST NOT upscale the captured output, or create additional frames, except as needed…" — [W3C Screen Capture ED](https://w3c.github.io/mediacapture-screen-share/)
- CapturedSurfaceResolution / `screenPixelRatio` exposes the captured surface's pixel ratio so apps can adapt quality and bandwidth to physical vs logical resolution. It is in Chrome 136 (Mac and Windows), with Linux and ChromeOS around 137. — [blink-dev Intent to Ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/jdCVfxAUFLc)

### Inferences
- Request `video: {width:{max:1920}, height:{max:1080}, frameRate:{ideal:30, max:30}}`. Treat these as caps, not guarantees. Then use `scaleResolutionDownBy` per preset.
- Capture size changes when the user resizes the window or fullscreens the video. Watch `track.getSettings()` and `resize` events on a local preview `<video>`, and recompute `scaleResolutionDownBy`.
- On a HiDPI laptop (DPR 1.5–2), constraints plus `screenPixelRatio` may allow physical-resolution capture above CSS size. I did not verify Chrome's exact behavior.

### Gaps
- I did not verify Chrome's actual tab-capture frame size policy (CSS px vs physical px) in M136+, or whether `width`/`height` min constraints can pull physical-resolution frames.
