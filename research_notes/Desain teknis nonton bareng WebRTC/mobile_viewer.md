# Mobile WebRTC viewer constraints (iOS Safari / Chrome-on-iOS WebKit, Android Chrome), as of Nov 2026

Scope: a phone viewer that receives a Chrome tab plus tab audio over P2P WebRTC while the user is also on a WhatsApp voice call.
Method note: this pass used 15 web searches and fetches. Most primary evidence is WebKit Bugzilla, Apple Developer Forums, caniuse/MDN and Chromium/W3C threads. Many bug reports are from 2020-2024, so their status in iOS 26 is often unconfirmed, and each item says so. Items marked "[unverified, background knowledge]" came from general knowledge and were not re-confirmed by a source in this session.

## 1. Autoplay of a remote MediaStream with sound

### Takeaway
On iOS, playing audio needs a user gesture unless the page is already capturing (getUserMedia). A pure viewer captures nothing, so the design should require one tap ("Tap to watch") before play() with sound. Muted inline autoplay of `<video autoplay playsinline muted>` works. Whether a later srcObject swap after a reconnect keeps sound without another tap is not documented for current iOS and must be tested on a device. Plan a fallback "tap to resume sound" button.

### Cited Findings
- WebKit/Safari: MediaStream-backed media autoplays if the page is already capturing. Otherwise "a user gesture is required to initiate any audio playback – WebRTC or otherwise". These rules sit on top of the base macOS/iOS autoplay rules. — [webrtcHacks, Guide to Safari WebRTC](https://webrtchacks.com/guide-to-safari-webrtc/); [webrtcHacks, Autoplay restrictions and WebRTC](https://webrtchacks.com/autoplay-restrictions-and-webrtc/)
- `<video autoplay playsinline>` with a MediaStream srcObject is reported working on iOS 14.5+ (developer report, anecdote). — [Apple Developer Forums 133254](https://developer.apple.com/forums/thread/133254)
- iOS 15 regression: an autoplayed video with a MediaStream srcObject freezes, and muted changes autoplay behaviour (2021 bug). — [WebKit bug 230922](https://bugs.webkit.org/show_bug.cgi?id=230922)
- iOS limit: a MediaStream could only be attached to new video elements about 10 times (old bug). This argues for reusing one `<video>` element and swapping srcObject rather than creating new elements. — [WebKit bug 210285](https://bugs.webkit.org/show_bug.cgi?id=210285)
- A muted element with a MediaStream plays sound again after a later getUserMedia call on iOS 15.3/15.4 (quirk). — [WebKit bug 238456](https://bugs.webkit.org/show_bug.cgi?id=238456)

### Inferences
- [unverified, background knowledge] Chrome Android's autoplay policy allows muted autoplay always, and autoplay with sound after a user interaction with the domain (or high Media Engagement Index). Once the document has had a user activation, later play() calls with sound in the same document generally succeed, so swapping srcObject on the same element after a reconnect should keep sound in Chrome. Source to cite if confirmed: developer.chrome.com/blog/autoplay.
- [unverified, background knowledge] In WebKit, once an element has been played by a user gesture, that element is generally allowed to play again. Keep one persistent `<video>` element and set `srcObject` to the new stream after a reconnect. Always check the `play()` promise. On `NotAllowedError`, start muted and show an "unmute" tap target.
- Possible fallback: keep audio on a separate `<audio>` element that was unlocked once by the tap. Not verified.

### Gaps
- No primary 2025-2026 WebKit document says whether a srcObject replacement on an already gesture-unlocked element keeps unmuted playback on iOS 18/26. This needs a device test.

## 2. Fullscreen and orientation

### Takeaway
On iPhone, element fullscreen (`Element.requestFullscreen`) is still unavailable through iOS 26. Only `<video>` native fullscreen via `webkitEnterFullscreen()` works, and there custom HTML overlays are not shown. iPad supports element fullscreen (caniuse "partial" since 16.4). Screen orientation lock is not supported on iOS Safari. Android Chrome supports both, with orientation lock requiring fullscreen.

### Cited Findings
- caniuse lists iOS Safari as "partial" for `Element.requestFullscreen` from 16.4 through 26.x and into 27.x. The `options` parameter is unsupported. — [caniuse requestFullscreen](https://caniuse.com/mdn-api_element_requestfullscreen); [caniuse options](https://caniuse.com/mdn-api_element_requestfullscreen_options_parameter)
- WebKit bug 310661 (March 2026): "only video elements can be taken full screen on iPhones". Closed as a duplicate of the long-running bug 206854. — [WebKit 310661](https://bugs.webkit.org/show_bug.cgi?id=310661); [WebKit 206854](https://www2.webkit.org/show_bug.cgi?id=206854)
- Apple forum: `webkitEnterFullScreen` works on iOS for video elements, not divs. The thread is still open into Dec 2025. A user says the WWDC26 Safari 27 beta notes had nothing on iPhone element fullscreen (anecdote). — [Apple Forums 133248](https://developer.apple.com/forums/thread/133248); [Apple Forums 770080](https://developer.apple.com/forums/thread/770080)
- A gaming-news claim of "full screen browser gaming with iOS 26" does not establish element fullscreen on iPhone (low-reliability source). — [gamingonphone](https://gamingonphone.com/news/apple-brings-full-screen-browser-gaming-to-safari-with-ios-26)
- Pause on exiting native fullscreen: in WebKit, when `VideoFullscreenRequiresElementFullscreen` is enabled, the video is paused when exiting fullscreen. This is intentional behaviour in some configurations. — [WebKit bug 280286](https://bugs.webkit.org/show_bug.cgi?id=280286)
- espn.com video paused and did not resume inline after exiting fullscreen. Fixed in 2026. — [WebKit bug 310317](https://bugs.webkit.org/show_bug.cgi?id=310317)
- Developers report that calling `play()` inside the `webkitendfullscreen` handler had no effect (older reports). Listening to `webkitbeginfullscreen`/`webkitendfullscreen` is the suggested way to detect the transitions. — [Apple Forums 113806](https://developer.apple.com/forums/thread/113806); [WebKit 245848](https://bugs.webkit.org/show_bug.cgi?id=245848)
- Orientation lock: caniuse per-method pages list `screen.orientation.lock` unsupported on iOS Safari through 26.5. web-features explorer says it is not supported on Safari iOS. Safari 16.4 notes say `"lock" in screen.orientation` returns false. The umbrella caniuse "Screen Orientation" page shows "supported" from 16.4, which covers reading orientation, not locking it. — [caniuse lock](https://caniuse.com/mdn-api_screenorientation_lock); [caniuse screen-orientation](https://caniuse.com/screen-orientation); [web-features](https://web-platform-dx.github.io/web-features-explorer/features/screen-orientation-lock/); [BCD issue 19355](https://github.com/mdn/browser-compat-data/issues/19355); [WebKit 257695](https://bugs.webkit.org/show_bug.cgi?id=257695)

### Inferences
- iPhone design: a custom "fullscreen" mode built from CSS (a fixed, 100dvh/100vw container, plus a "rotate your phone" hint) keeps the overlays, PIN/status UI and reconnect banners visible. Native `webkitEnterFullscreen` is an optional "true fullscreen" button. On exit, check `video.paused` and show a resume button if needed.
- Android: `requestFullscreen()` on the container, then `screen.orientation.lock('landscape')` inside the promise. [unverified, background knowledge: lock requires fullscreen on Chrome Android.]
- Native iOS fullscreen shows the system player UI. HTML overlays are not drawn (consistent with the forum threads above; no explicit Apple doc found).

### Gaps
- No Apple doc found that states the overlay behaviour or the exit-pause behaviour for a MediaStream `<video>` specifically on iOS 26.

## 3. Background, lock screen, Picture-in-Picture

### Takeaway
When the iPhone locks or Safari goes to the background, remote video stops rendering (track mute events, video paused) but remote WebRTC audio has historically kept playing in Safari. Other iOS browsers, which use WebKit, have killed audio in the background. Standard PiP of a MediaStream-backed `<video>` on iOS has been an "expected limitation" (NotSupportedError, iOS 17.3) with the bug still open. Do not design around PiP or background video on iPhone.

### Cited Findings
- Safari on iOS: backgrounding kills video but audio continues. Non-Safari iOS browsers (WebKit-based, e.g. Chrome iOS) killed audio when going to background (2022 bug). — [WebKit bug 239602](https://bugs.webkit.org/show_bug.cgi?id=239602)
- After locking, the remote video track gets `mute`/`unmute` events and the audio track gets none. Incoming WebRTC audio keeps working in the background or when locked, while capture stops (WKWebView report). — [WebKit 211829](https://bugs.webkit.org/show_bug.cgi?id=211829); [Apple Forums 663161](https://developer.apple.com/forums/thread/663161)
- Web Audio / AudioContext is suspended on screen lock or background (reports). — [Apple Forums 774239](https://developer.apple.com/forums/thread/774239); [WebKit 239996](https://bugs.webkit.org/show_bug.cgi?id=239996)
- SFSafariViewController pauses media playback in background. This matters if the link is opened from an in-app browser (e.g. tapped inside WhatsApp or KakaoTalk). — [WebKit 226163](https://bugs.webkit.org/show_bug.cgi?id=226163)
- PiP on a video whose srcObject is a camera MediaStream throws NotSupportedError on iOS 17.3. A WebKit contributor called it an expected limitation and opened bug 268732 (still open). — [WebKit 268732](https://bugs.webkit.org/show_bug.cgi?id=268732); [WebKit 262479](https://bugs.webkit.org/show_bug.cgi?id=262479)
- PiP fails from a Home Screen web app while it works in regular Safari (Dec 2025). — [WebKit 303885](https://bugs.webkit.org/show_bug.cgi?id=303885)
- In WKWebView, WebRTC video disappears on background while audio continues. No system PiP for it. — [Apple Forums 812088](https://developer.apple.com/forums/thread/812088)
- A native WebRTC remote audio stream stopped after about 1 hour while Safari still played the same stream (recent forum thread). — [Apple Forums 840531](https://developer.apple.com/forums/thread/840531)

### Inferences
- The RTCPeerConnection itself usually survives a short lock on Safari (audio keeps flowing). Expect ICE or consent failures after long backgrounding. Handle `visibilitychange` by checking `pc.connectionState` and video `paused` on return, then call play() or reconnect.
- Note that the remote stream here is a screen-share *display* stream, not a camera stream. Whether bug 268732's PiP limitation covers remote WebRTC tracks is not confirmed. Treat PiP as "try, feature-detect, and don't promise it".
- [unverified, background knowledge] On Android Chrome, a background tab with playing audio keeps playing, and the video element can enter PiP via `requestPictureInPicture()`. Automatic PiP for video calls exists on desktop Chrome. Android auto-PiP for web is not confirmed.
- Advise the user to open the link in Safari (not an in-app browser) and keep the screen on.

### Gaps
- No 2026 primary source on iOS 26 background behaviour for remote WebRTC. Most evidence is from iOS 14-17.

## 4. Screen Wake Lock

### Takeaway
iOS Safari supports `navigator.wakeLock.request('screen')` since 16.4. It was broken in Home Screen web apps until iOS 18.4 (31 March 2025). Android Chrome has supported it for years. Re-acquire the lock on `visibilitychange`, because the lock is released when the page is hidden.

### Cited Findings
- WebKit bug 254545 (reported 27 March 2023, iOS 16.4): Wake Lock did not work in Home Screen web apps. — [WebKit 254545](https://bugs.webkit.org/show_bug.cgi?id=254545)
- Safari 18.4 release notes: "Fixed Wake Lock API for Home Screen Web Apps." — [Safari 18.4 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-18_4-release-notes)
- PWA references confirm the fix in iOS 18.4. — [Progressier](https://progressier.com/pwa-capabilities/screen-wake-lock); [web-features: screen-wake-lock](https://web-platform-dx.github.io/web-features-explorer/features/screen-wake-lock)
- Related WebKit report: the lock could not be re-acquired after going to the home screen and back (status unconfirmed). — [WebKit 255363](https://bugs.webkit.org/show_bug.cgi?id=255363)

### Inferences
- Acquire the wake lock inside the same "Tap to watch" gesture, and again on each return to `visible`. A playing, unmuted video may also keep the screen awake, but don't rely on it.
- [unverified, background knowledge] Android Chrome supports Screen Wake Lock since Chrome 84 (2020).

### Gaps
- No post-18.4 report confirming that the re-acquire bug is fixed in iOS 26.

## 5. CRITICAL: web media audio during an active WhatsApp voice call

### Takeaway
This is the highest-risk constraint. On iOS, WhatsApp uses CallKit and a play-and-record audio session. Apple DTS says a CallKit session interrupts other audio sessions "just like it would interrupt Music.app". WebKit bugs show web media being paused or muted around phone calls. Expect Safari video audio to be interrupted (paused) when the call starts or while it is active, and possibly routed and ducked to call levels. On Android, Chrome requests audio focus for video. Users report Chrome video pausing during phone and WhatsApp calls, and playing only when muted. The design must assume that the WhatsApp call and page audio may not coexist, and must be tested on real devices before committing to it.

### Cited Findings
- Apple DTS (Kevin Elliott, Nov 2024): "CallKit activated its own audio session inside your app, which interrupted the audio session of your WebView, just like it would interrupt Music.app or Voice Memos." He calls WKWebView and CallKit "architecturally incompatible". (Context: CallKit in the same app. The principle that CallKit interrupts other apps' non-mixable sessions is the relevant part.) — [Apple Forums 767949](https://developer.apple.com/forums/thread/767949)
- WebKit bugs: during a phone call in a Safari WebRTC session, capture is suspended and the track is muted. After a dismissed call, remote audio stays muted until the user returns to Safari. The video element is paused by the phone call, and one suggested heuristic is to check `paused` on all video elements after the call and call play(). — [WebKit 240651](https://bugs.webkit.org/show_bug.cgi?id=240651); [WebKit 244505](https://bugs.webkit.org/show_bug.cgi?id=244505); [WebKit 208516](https://bugs.webkit.org/show_bug.cgi?id=208516); [WebKit 245833](https://bugs.webkit.org/show_bug.cgi?id=245833)
- An inbound cellular call blacks the video and mutes audio in iOS Safari WebRTC. Recovery varies (manual unmute, restarting the peer connection, auto-recovery after 30-60 s, Bluetooth differences). — [Apple Forums 663161](https://developer.apple.com/forums/thread/663161); [WebKit 246340](https://bugs.webkit.org/show_bug.cgi?id=246340); [WebKit 247818](https://bugs.webkit.org/show_bug.cgi?id=247818)
- Apple forum thread "Media playback does not pause when answering a phone call" (recent; indicates the behaviour varies). — [Apple Forums 840350](https://developer.apple.com/forums/thread/840350)
- Audio Session API: `navigator.audioSession.type` takes 'auto', 'playback', 'transient', 'transient-solo', 'ambient' and 'play-and-record' (W3C WD, Nov 2024). Safari implements only `type`, not `state`. — [W3C Audio Session](https://w3c.github.io/audio-session/); [MDN Audio Session API](https://developer.mozilla.org/en-US/docs/Web/API/Audio_Session_API); [MDN AudioSession.type](https://developer.mozilla.org/docs/Web/API/AudioSession/type); [WebKit 271305](https://bugs.webkit.org/show_bug.cgi?id=271305)
- Audio Session quirks on iOS: getUserMedia forces play-and-record. Playback at half or "VC" volume after capture, fixed by setting the type back to 'playback'. Setting 'play-and-record' on iOS 17.4 still paused other apps' audio. — [WebKit 264473](https://bugs.webkit.org/show_bug.cgi?id=264473); [WebKit 282939](https://bugs.webkit.org/show_bug.cgi?id=282939); [WebKit 283417](https://bugs.webkit.org/show_bug.cgi?id=283417); [WebKit 251532](https://bugs.webkit.org/show_bug.cgi?id=251532)
- Android: Samsung community users report Chrome video that "won't play during a phone call or WhatsApp call" and keeps pausing, and that it plays when muted but pauses when the volume is raised (S24 Ultra, One UI 7). — [Samsung Community](https://r2.community.samsung.com/t5/Galaxy-S/S24-Ultra-Video-Not-Playable-while-on-Call/td-p/21666224); [Samsung Community (One UI 7)](https://r1.community.samsung.com/t5/galaxy-s/s24-ultra-one-ui-7-chrome-video-issue/m-p/35974035/highlight/true); [Samsung Galaxy A thread](https://r2.community.samsung.com/t5/Galaxy-A/Any-browser-can-not-play-video-while-in-a-call/m-p/19578456/highlight/true)
- W3C WebRTC discussion: a video element is paused during a phone call on Android, "probably because of Android's audio focus guidance". Reproducible with any video element. — [public-webrtc 2022-03](https://lists.w3.org/Archives/Public/public-webrtc/2022Mar/0019.html); [discuss-webrtc: video pause while phone call](https://groups.google.com/g/discuss-webrtc/c/9T0P6KftmaI)
- Chrome requests transient focus for short sounds but full focus for video, so it interrupts other apps. — [Mozilla bug 1545817](https://bugzilla.mozilla.org/show_bug.cgi?id=1545817)

### Inferences
- The likely iPhone outcome: when the WhatsApp call is active, the page's video element is paused or its audio is interrupted. If playback resumes, it may be at call volume via the receiver/earpiece route, unless headphones or the speaker are used. This is inferred from the CallKit/session principles plus the bugs. It has not been verified for WhatsApp plus Safari on iOS 26 specifically.
- `navigator.audioSession.type = 'ambient'` (mixable, but it obeys the silent switch) or `'playback'` might change mixing. 'ambient' is the only type designed to mix with other audio. Whether either survives an active CallKit call is unknown. Worth a 10-minute device test with each type.
- Strong design implication: offer a fallback path where voice runs inside the app itself (WebRTC audio both ways, with echo cancellation) instead of WhatsApp. Also offer an option to play the video muted while on WhatsApp, with subtitles or no tab audio. Detect `pause` events not caused by the user and show "Audio was interrupted by a call, tap to resume".
- Android: one test path is to try `navigator.audioSession` (not shipped in Chrome as far as found). Otherwise there is no web API to change audio focus. Muted video will keep playing, so the "muted video plus WhatsApp voice" mode is the safe baseline on both platforms.

### Gaps
- No direct, dated (2025-2026) report found of "Safari video audio while a WhatsApp call is active" on iOS 18/26. No Chromium bug found for Chrome Android audio focus versus VoIP apps. The notes rely on analogous phone-call and CallKit reports. **This must be tested on real devices before relying on the WhatsApp design.**

## 6. Decode support and battery

### Takeaway
H.264 is the safe codec for iPhone (hardware decode on every device). VP8 is supported in Safari WebRTC (software decode). VP9 decodes in hardware on most recent iPhones via VideoToolbox and in software (libvpx) on the rest. AV1 hardware decode exists on A17 Pro (iPhone 15 Pro) and later, but WebRTC AV1 on iPhone has had bugs, including in 2026. Recommend preferring H.264 for iPhone viewers, and VP9 or H.264 for Android.

### Cited Findings
- Most iOS devices decode VP9 via VideoToolbox, the rest through libvpx. All iOS devices support VP9 encode in WebRTC via libvpx (WebKit engineer, 2021). — [WebKit 230604](https://bugs.webkit.org/show_bug.cgi?id=230604)
- Apple announced a dedicated AV1 decoder in the A17 Pro (iPhone 15 Pro), 12 Sept 2023. — [Bitmovin, Apple AV1 support](https://bitmovin.com/apple-av1-support)
- "AV1 WebRTC decoding broken on iPhone 15 Pro/Pro Max" (April 2024), closed as a duplicate of 269906. — [WebKit 272610](https://bugs.webkit.org/show_bug.cgi?id=272610)
- April 2026: Media Capabilities `decodingInfo` does not report power-efficient AV1 for WebRTC on iOS and Mac (tested iPhone 15 Pro, iOS 26.4). The bug frames hardware support as A18+, which conflicts with the A17 Pro claim. — [WebKit 311593](https://bugs.webkit.org/show_bug.cgi?id=311593)

### Inferences
- [unverified, background knowledge] Safari WebRTC has supported VP8 since Safari 12.1 / iOS 12.2. Software VP8/VP9 decode at 1080p30 on a phone costs noticeably more battery and heat than hardware H.264. For a long movie session, put H.264 first via `setCodecPreferences` on the receiving side when the UA is iOS. Use `navigator.mediaCapabilities.decodingInfo({type:'webrtc', ...})` to check `powerEfficient`.
- [unverified, background knowledge] On Android Chrome, hardware decode depends on the SoC. H.264 and VP8 are universally available, VP9 hardware is common on 2018+ chips, and AV1 hardware is on recent flagships (e.g. Pixel 8+, Snapdragon 8 Gen 2+), with a software dav1d fallback.
- Tab-capture content (mostly static, with occasional motion) suits a "detail"/"motion" contentHint. Resolution 1080p, 30 fps max, is a sane cap for a phone viewer.

### Gaps
- No measured battery or heat numbers for 2025-2026 iPhones by codec found. No authoritative device list for VP9 hardware decode.

## 7. getStats fields and jitter-buffer control

### Takeaway
Safari's getStats exposes the standard inbound-rtp, candidate-pair and transport stats, and the IDL includes `freezeCount` and `jitterBufferDelay`. Historically iOS Safari lagged on some fields, so feature-detect every field. `RTCRtpReceiver.jitterBufferTarget` is supported in Chrome, Edge and Firefox (since ~115-124) but not Safari. `playoutDelayHint` is a non-standard Chrome-only predecessor.

### Cited Findings
- WebKit's RTCStatsReport.idl declares `freezeCount` and `jitterBufferDelay` (undated snapshot). — [WebKit RTCStatsReport.idl](https://webkit.googlesource.com/WebKit/+/38a3a787bf62c99f8164317b16ffc82b70bf51d1/Source/WebCore/Modules/mediastream/RTCStatsReport.idl)
- 2020: missing WebRTC metrics in iOS Safari, including audio `jitterBufferDelay`. 2024: more missing inbound-rtp fields, with a PR submitted (ship status unknown). — [WebKit 212668](https://bugs.webkit.org/show_bug.cgi?id=212668); [WebKit 267696](https://bugs.webkit.org/show_bug.cgi?id=267696)
- `freezeCount` is experimental and not Baseline. — [MDN freezeCount](https://developer.mozilla.org/en-US/docs/Web/API/RTCInboundRtpStreamStats/freezeCount); [caniuse totalFreezesDuration](https://caniuse.com/mdn-api_rtcstatsreport_type_inbound-rtp_totalfreezesduration)
- `jitterBufferTarget` is unsupported on Safari desktop and iOS, and is not Baseline. Chrome shipped it (blink-dev Intent to Ship). WebKit runs the WPT tests (2026 flaky-test bug), but no shipped implementation was confirmed. — [MDN jitterBufferTarget](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpReceiver/jitterBufferTarget); [docs.w3cub compat table](https://docs.w3cub.com/dom/rtcrtpreceiver/jitterbuffertarget); [blink-dev Intent to Ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/bReU8otUmdk); [WebKit 313346](https://bugs.webkit.org/show_bug.cgi?id=313346)

### Inferences
- Portable metrics: from `inbound-rtp` (kind video), use `framesDecoded`, `framesDropped`, `packetsLost`, `jitter`, and `jitterBufferDelay / jitterBufferEmittedCount`. From `candidate-pair` (found via `transport.selectedCandidatePairId`, or `nominated && state==='succeeded'` as a fallback), use `currentRoundTripTime` and `availableIncomingBitrate`. Compute fps from the `framesDecoded` delta when `framesPerSecond` is absent.
- For Safari, A/V sync and latency are not tunable, so use `if ('jitterBufferTarget' in receiver)`. In Chrome a target of ~300-500 ms on both audio and video receivers can smooth playback for a watch-together use case where latency is unimportant.

### Gaps
- No current per-field compatibility matrix for Safari 26 getStats was found (e.g. `framesPerSecond`, `freezeCount`, `selectedCandidatePairId`). Verify by logging `getStats()` output on a real iPhone.

## 8. Numeric PIN input on iOS

### Takeaway
Use `<input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="6">`. iOS shows the number pad and can offer SMS/Mail codes in the QuickType bar. Nothing in this session's searches contradicts that, but it was not re-sourced.

### Cited Findings
- No sources retrieved in this session (tool-call budget).

### Inferences
- [unverified, background knowledge] `inputmode="numeric"` shows the iOS digit pad (Safari 12.2+). `type="number"` is not recommended for PINs (spinners, leading-zero loss). `autocomplete="one-time-code"` (iOS 12+) only offers codes received by SMS/Mail, so a PIN shared via WhatsApp won't auto-fill, though it is harmless. Use 16px+ font-size to avoid the iOS auto-zoom on focus. Avoid splitting the code into 6 separate inputs, because paste and autofill break. Use one input styled as boxes.

### Gaps
- Sources needed: MDN `inputmode`, WebKit blog "One-time code", and Apple's "Enabling password autofill" doc.
