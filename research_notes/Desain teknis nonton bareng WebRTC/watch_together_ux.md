# UX and interface patterns for watch-together / live screen-share viewer apps (mobile viewer, desktop host)

Scope note: about 19 search and fetch calls. Primary sources (WebKit, Chrome for Developers, web.dev, Apple HIG, W3C WAI, MDN, YouTube Help) were reachable and are cited directly. Product help centres for Teleparty, Rave, Kast and SharePlay, and the in-player controls of Discord mobile, Twitch mobile and Google Meet mobile, did **not** show up in searches. Those gaps are listed under each question and not filled from memory. Statements marked "Inference" are design reasoning drawn from the cited findings, not sourced facts.

## 1. Viewer UI on phones: control placement, auto-hide, tap-to-show, landscape

### Takeaway
The proven baseline is the system video player: video at its native aspect ratio (fit, letterboxed, with no padding baked in), controls that appear on tap and hide on their own during playback, and minimal supplementary UI that "doesn't obscure media playback". If you build a custom player, copy the system player's behaviour, because small deviations frustrate people.

### Cited Findings
- Apple HIG: "Use the system video player to give people a familiar and convenient experience… If your app truly requires a custom video player, reference the behavior and interface of the system video player… A custom experience that diverges slightly from the system-provided experience can cause frustration because people don't know which of their habitual interactions they can continue to use." — [Apple HIG, Playing video](https://developer.apple.com/design/human-interface-guidelines/playing-video.md)
- Apple HIG: standard video (4:3, 16:9, up to 2:1) defaults to fit-to-screen (aspect) mode with letterbox or pillarbox. Wide video (2:1 to 2.40:1) defaults to aspect-fill, with some edge cropping. "Always display video content at its original aspect ratio". Padding embedded in the frame makes video look smaller in both modes. — [Apple HIG, Playing video](https://developer.apple.com/design/human-interface-guidelines/playing-video.md)
- Apple HIG: additional information (title, description) should be restricted "so that it doesn't obscure media playback". — [Apple HIG, Playing video](https://developer.apple.com/design/human-interface-guidelines/playing-video.md)
- Apple HIG (tvOS, but relevant to overlays in general): "Defer to content when displaying logos or noninteractive overlays above video… avoid large, distracting overlays… prefer translucent graphics". For interactive overlays, "Give people a clear way to dismiss the overlay and resume". — [Apple HIG, Playing video](https://developer.apple.com/design/human-interface-guidelines/playing-video.md)
- Apple HIG: people expect Space to play/pause on a connected keyboard. On loading: if loading takes more than 2 s, show a black screen with a centred spinner and no surrounding content, and start playback as soon as enough content has loaded. — [Apple HIG, Playing video](https://developer.apple.com/design/human-interface-guidelines/playing-video.md)
- Apple (archived Energy Guide): the standard AVPlayerViewController controls "automatically hide during media playback". Controls shown on tap are fine, but "these elements should be removed when the user isn't interacting with them". — [Apple, Restrict UI When Playing Full-Screen Video](https://developer.apple.com/library/archive/documentation/Performance/Conceptual/EnergyGuide-iOS/HideControlsInFullScreenVideo.html)
- Anecdotal timing: one developer reports that the standard iOS controls hide after about 2 s. This is not official. — [Apple Developer Forums thread 658534](https://developer.apple.com/forums/thread/658534)
- Discord mobile: viewers join the voice channel, then double-tap the streamer's name or tap it and choose "Watch Stream". A Go Live badge marks who is streaming. A stream has at most 50 viewers. — [Discord Support, Go Live and Screen Share](https://support.discord.com/hc/articles/360040816151)
- Google Meet (desktop/web, Aug 2025): a full-screen action appears when viewing a presentation. It enlarges the shared content and shrinks participant tiles into a sidebar. — [Google Workspace Updates, Aug 2025](https://workspaceupdates.googleblog.com/2025/08/full-screen-google-meet.html); [Android Authority](https://www.androidauthority.com/google-meet-full-screen-mode-3585996)
- Pitfall: a Zoom Android Meeting SDK thread reports that shared-screen content gets cut off after rotating to landscape. — [Zoom Developer Forum](https://devforum.zoom.us/t/meeting-view-shared-screen-video-getting-cut-in-android-sdk/87062.md)

### Inferences
- For a shared Chrome tab, which is usually 16:9 or close to the laptop's 16:10, use `object-fit: contain` (fit). Never crop: a shared tab often carries subtitles and UI at its edges.
- Tap on the video toggles the controls. Hide them after about 2 to 3 s of no interaction during playback, but keep them visible while a sheet or menu is open, while the chat input has focus, and in any error or reconnecting state.
- Keep the primary viewer controls few: fullscreen, quality, chat, reactions, stats. With no seek and no pause (this is a live share), the control set is smaller than a VOD player's, which is a good reason not to draw a fake scrubber.
- Respect the safe-area insets (`env(safe-area-inset-*)`) in landscape so controls clear the notch and Dynamic Island.

### Gaps
- No primary documentation found for the in-stream controls of the Discord mobile viewer (quality, fullscreen, pop-out), Teleparty, Rave, Kast or SharePlay, the Twitch and YouTube Live mobile players' landscape layouts, or Google Meet's mobile presentation view on rotation. Do not cite specifics for them.
- The current Apple HIG text gives no exact auto-hide duration.

## 2. Chat and reactions over fullscreen video on mobile

### Takeaway
Established players overlay a semi-transparent chat log at one edge in landscape (YouTube Live puts it on the left, partly covering the video). Floating emoji reactions that rise across the screen are a known source of complaints when they cannot be turned off, so keep them small, brief, confined to an edge and switchable.

### Cited Findings
- YouTube Android (2021 test, later rolled out more widely): a floating comments panel in landscape. For live streams, "their chat log appears on the left side and partly covers the video". The same source called mobile live chat "not particularly good" at the time. — [9to5Google, Jun 2021](https://9to5google.com/2021/06/07/youtube-on-android-tests-floating-comments-section-when-viewing-landscape-video/); [9to5Google update, Sep 2021](https://9to5google.com/2021/09/20/youtube-on-android-tests-floating-comments-section-when-viewing-landscape-video/)
- Desktop demand signal: several browser extensions exist only to show YouTube live chat as a draggable, resizable overlay in fullscreen, with adjustable opacity, position and size. — [Firefox Add-ons, OverPlay](https://addons.mozilla.org/en-GB/firefox/addon/overplay); [Chrome Web Store](https://chrome.google.com/webstore/detail/youtube-chat-in-fullscree/kmhclnjhlejdjlkgeebolkigafpaijkp/related)
- Zoom: users complain about reactions that "float from the bottom of the screen to the top with their name in the box", and some ask how to turn them off. Emoji that stay inside a video tile bother them less. — [Zoom Community](https://community.zoom.com/meetings-2/help-how-to-stop-emojis-from-floating-aa-meetings-how-are-you-handling-this-18136); [Zoom Community, floating emoji](https://community.zoom.com/t5/Meetings/Emojis-randomly-float-through-my-zoom-window-during-meetings/m-p/176092)
- Zoom: users report reaction or raised-hand notification bubbles appearing over shared content. — [Zoom Community](https://community.zoom.com/t5/Zoom-Meetings/Help-Needed-Removing-Notification-Bubble-on-Shared-Screen-in/m-p/128668)
- Zoom mobile: Reactions sit in the bottom menu bar, with animated reactions behind a "…" (six animated emoji; needs v5.13.0+). — [Guiding Tech](https://www.guidingtech.com/how-to-use-animated-reactions-in-zoom-on-desktop-and-mobile/); [Zoom Community](https://community.zoom.com/t5/Zoom-Meetings/Animated-Reactions/m-p/88653)
- Mobile pitfall: reaction popups and pickers that run off-screen on phones (Discourse). — [Discourse Meta](https://meta.discourse.org/t/seeing-who-liked-reacted-on-the-post-hides-the-popup-very-quickly/351991/2?tl=ja)

### Inferences
- Landscape fullscreen: put the chat in a translucent overlay column on one side (for example the right, so it does not fight a left-aligned subtitle area, or follow YouTube's left placement). Make it toggleable and show only the latest 3 to 5 messages that fade out. Portrait: chat goes below the 16:9 video as a normal panel, which costs no picture area.
- When chat is hidden, signal unread messages with a count badge on the chat button and, optionally, a single-line toast that disappears on its own. Do not stack bubbles over the picture.
- Reactions: spawn them from one bottom corner and let them drift in a narrow lane for 1.5 to 2.5 s. Cap how many show at once. Offer an "Animasi reaksi" off switch. With `prefers-reduced-motion`, switch to a static fade-in badge (see Q8).
- Keep the reaction picker as a short horizontal row of about 6 emoji inside the viewport rather than a full emoji keyboard. That avoids the off-screen picker pitfall.
- With 2 people, sender names on reactions add little. A small "kamu" vs "dia" side or a colour cue is enough.

### Gaps
- No primary sources found for Teleparty, Rave or Kast chat and reaction behaviour on mobile, or for Twitch mobile landscape chat.

## 3. Quality picker UX

### Takeaway
YouTube's model is the reference: a short, plain-language list with "Auto (recommended)" first and each option explained by its trade-off ("uses more data… may buffer", "lower quality… may start faster"), plus a separate advanced list of explicit resolutions. Showing the resolution Auto is currently delivering ("Auto (720p)") is a known pattern, but I could not source it from a primary document in this pass.

### Cited Findings
- YouTube Help (mobile): options "Auto (recommended)", "Higher picture quality", "Data saver", "Advanced". Auto "Changes to give you the best experience for your conditions". Higher picture quality "Uses more data so videos may take longer to start or may buffer more often". Data saver: "Lower picture quality, but videos may start faster". Defaults are set separately for mobile network and Wi-Fi. Per-video path: Settings > Quality. — [YouTube Help 91449](https://support.google.com/youtube/answer/91449?hl=en)
- Press testing: "Data saver" still streamed 720p on a fast connection in one test. Another reports a 480p cap that can drop to 144p. So labels are targets or ceilings, not guarantees. — [Android Central](https://www.androidcentral.com/youtube-rolls-out-new-streaming-quality-controls-mobile); [9to5Google](https://9to5google.com/2021/04/23/youtube-adds-even-more-video-resolution-controls-and-options-on-mobile/)
- YouTube's 2021 change was criticised as "more confusing", because explicit resolutions moved behind "Advanced". — [Tom's Guide](https://www.tomsguide.com/news/watching-youtube-videos-on-android-and-iphone-just-got-more-confusing-heres-why)

### Inferences
- The planned set (Otomatis / Hemat 480p / Normal 720p / Tajam 1080p) already matches YouTube's tiers, plus the resolution in the label, which addresses the "confusing" criticism.
- Show the delivered resolution: "Otomatis · 720p". If a manual choice is not being met because of bandwidth, the host's encoder or WebRTC downscaling, say so: "Tajam dipilih · sekarang 720p (koneksi)". Treat the labels as ceilings, as YouTube does.
- Data explanation: show an approximate rate per hour next to each option ("± X GB/jam"), computed from the bitrates the app actually targets. Do not copy YouTube's numbers. This is a 2-person WebRTC stream, so measure it.
- Remember the choice per device (localStorage). Default to Otomatis.

### Gaps
- No primary source found for YouTube's "Auto (720p)" in-menu display or for the current "Stats for nerds" field list. Verify on a device before citing.

## 4. Connection status, reconnecting, "host paused", poor connection; stats for non-technical users

### Takeaway
The cited material is thin here. The supportable principles: keep the status overlay small and translucent, never blank the last frame needlessly, announce status changes through a polite live region, and keep raw stats behind an opt-in panel (YouTube-style "Stats for nerds").

### Cited Findings
- Apple HIG: for loading over 2 s, show a black screen with a centred activity spinner and nothing else, and start playback as soon as possible. — [Apple HIG, Playing video](https://developer.apple.com/design/human-interface-guidelines/playing-video.md)
- Apple HIG: noninteractive overlays should be small and translucent, deferring to content. — [Apple HIG, Playing video](https://developer.apple.com/design/human-interface-guidelines/playing-video.md)
- ARIA live regions: `role="log"` has implicit `aria-live="polite"` and `aria-atomic="false"` (only the additions are announced), and it requires an accessible name. `role="status"` is the companion for advisory status. — [MDN, ARIA log role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/log_role)

### Inferences
- Use distinct, named states with plain Indonesian copy, each as a small pill at the top centre over a scrim:
  - "Menyambung ulang…" (with attempt count or elapsed time after about 5 s), keeping the last frame frozen and dimmed rather than going black.
  - "Host menjeda berbagi layar" when the host's track ends or is muted. This is not an error, so give it a neutral tone and no spinner.
  - "Koneksi lemah · kualitas diturunkan ke 480p" when Otomatis steps down. Link it to the quality sheet.
  - Hard failure after N retries: "Tidak tersambung" with a "Coba lagi" button.
- Stats panel ("Info koneksi"): lead with a one-word verdict (Bagus / Cukup / Lemah), then a few human rows (Resolusi, FPS, Bitrate, Jeda/latency, Paket hilang), with raw values in monospace. Opt-in only.
- Announce state changes via `role="status"`, and only on transitions, not on every stats tick.

### Gaps
- No primary product documentation found for how Discord, Meet, Zoom or Teleparty word "reconnecting", "host stopped sharing" or "poor connection" on mobile. No source found for YouTube "Stats for nerds" field definitions.

## 5. "Tap to start" / "Tap to unmute" under mobile autoplay rules

### Takeaway
iOS Safari allows autoplay only when the video is muted (or has no audio) and is visible. `play()` returns a Promise that rejects otherwise. Unmuting without a user gesture pauses playback. So a WebRTC viewer should start muted and inline, then use one explicit tap (a `click`/`touchend` handler) to unmute, or else show a "Ketuk untuk mulai" overlay.

### Cited Findings
- WebKit: `<video autoplay>` without a gesture is allowed if there is no audio track or the video is muted. Autoplay starts only when the element is visible (in the viewport, not hidden by CSS, in the DOM) and pauses when it is no longer visible. — [WebKit, New video policies for iOS](https://webkit.org/blog/6784/new-video-policies-for-ios/)
- WebKit: `play()` without a gesture succeeds only if there is no audio or `muted` is true, and it "returns a Promise, which is rejected if these conditions aren't met". — [WebKit](https://webkit.org/blog/6784/new-video-policies-for-ios/)
- WebKit: "If a video gains an audio track or is unmuted without a user gesture, playback pauses." A gesture means `touchend`, `click`, `doubleclick` or `keydown`. A `canplaythrough` handler does not count. — [WebKit](https://webkit.org/blog/6784/new-video-policies-for-ios/)
- WebKit: on iPhone, `playsinline` videos play inline. Without it, playback forces fullscreen. — [WebKit](https://webkit.org/blog/6784/new-video-policies-for-ios/)
- Secondary: set the `muted` attribute in markup, not only the JS property, because older iOS sometimes did not honour the property alone. — [Brightcove](https://old.brightcove.com/resources/blog/autoplay/)
- Secondary, unverified against Apple docs: Low Power Mode can block autoplay even for muted video. — [testmuai blog](https://www.testmuai.com/blog/video-audio-autoplay-policies-across-browsers/)
- Inline muted autoplay is supported on Android and on iPhone since iOS 10. — [Google IMA, Manage autoplay](https://developers.google.com/interactive-media-ads/docs/sdks/html5/client-side/autoplay)

### Inferences
- Flow: attach the remote stream to `<video muted playsinline autoplay>`, then call `play()` and catch the rejection. On success, show a persistent "Ketuk untuk menyalakan suara" chip. On rejection (for example Low Power Mode), show a full-video "Ketuk untuk mulai" overlay. Do the unmute and `play()` inside the tap handler itself, not after an `await` on something unrelated.
- After a reconnect that swaps in a new MediaStream or track, re-check `paused`/`muted`. Silently reappearing muted is a likely support issue.
- Do not hide the `<video>` with `display:none` during reconnect, because a hidden element needs a gesture again. Use an overlay instead.

### Gaps
- No current (2025-2026) WebKit doc found that restates or changes the 2016 policy. It still appears to be the reference, but device testing is advised.

## 6. Joining by link + PIN on mobile: PIN input

### Takeaway
Use a single `<input>`, not segmented boxes: `type="text"`, `inputmode="numeric"`, `autocomplete="one-time-code"` (useful only for SMS codes, harmless for a PIN, or use `autocomplete="off"` for a PIN the host tells you), `pattern`, `maxlength`, a visible label, a hint above the field via `aria-describedby`, and font-size at least 1rem. If you want the box look, fake it with letter-spacing and a monospace font.

### Cited Findings
- Chrome for Developers: "Use one `<input>`". Splitting into per-digit boxes "breaks native autofill in many browsers, hinders copy-paste, and complicates screen reader navigation". For a segmented look, "style the single input with `letter-spacing` and a monospace font". — [Chrome, SMS OTP form](https://developer.chrome.com/docs/modern-web-guidance/guides/forms/sms-otp-form.md.txt)
- Chrome / web.dev: `type="text"`, not `number` (strips leading zeros, adds spinners) and not `tel`. Add `inputmode="numeric"`, `autocomplete="one-time-code"`, `pattern="\d{6}"`, `maxlength`, `required`. Font size at least 1rem to stop mobile zoom. — [Chrome](https://developer.chrome.com/docs/modern-web-guidance/guides/forms/sms-otp-form.md.txt); [web.dev](https://web.dev/articles/sms-otp-form)
- Chrome: give the input a visible `<label for>`, tie the format hint with `aria-describedby`, and place the hint above the input so autofill popovers and the keyboard don't cover it. Submit via `requestSubmit()` so constraint validation runs. — [Chrome](https://developer.chrome.com/docs/modern-web-guidance/guides/forms/sms-otp-form.md.txt)
- Safari iOS 14+ suggests codes from SMS for `autocomplete="one-time-code"`. WebOTP is Chrome-Android-only progressive enhancement. — [web.dev](https://web.dev/articles/sms-otp-form); [Twilio](https://www.twilio.com/en-us/blog/developers/best-practices/otp-input-forms-html)
- Baymard (general forms, not OTP-specific): splitting a single entity (such as a phone number) across several fields made input "needlessly difficult". — [Baymard, mobile form usability single input fields](https://baymard.com/blog/mobile-form-usability-single-input-fields)

### Inferences
- If the PIN is in the shared link (for example in the URL fragment), pre-fill it and auto-submit so the viewer only taps the link. Keep manual entry as a fallback.
- Auto-submit when the PIN reaches its full length. Accept paste of the whole code, and strip spaces and non-digits on input.
- Error copy: say what happened and what to do, for example "PIN salah. Cek lagi pesan dari host." Keep the field filled and selected so it can be retyped. Lockout (rate limit after N attempts): state the wait time explicitly ("Terlalu banyak percobaan. Coba lagi dalam 1 menit."), with a countdown in a `role="status"` region.
- Never use `type="password"` masking for a short shared PIN on a phone. Visibility helps more than it risks in a 2-person private context (inference).

### Gaps
- No Baymard study specifically on OTP or PIN fields was found. No sourced guidance on lockout wording.

## 7. Host-side patterns: "you are sharing", tab-audio warnings, invite flow, presence

### Takeaway
Chrome gives the host app real levers: pre-select the Tab pane (`displaySurface: "browser"`), keep the app's own tab out of the picker (`selfBrowserSurface: "exclude"`), allow "Share this tab instead" (`surfaceSwitching: "include"`), and hide whole screens (`monitorTypeSurfaces: "exclude"`). Tab audio is offered in the Tab pane. The app should check whether the captured stream actually has an audio track and warn loudly if it does not.

### Cited Findings
- `displaySurface` preference pre-selects the tab, window or screen pane, but it cannot pre-select a specific tab (Chrome 107 desktop). — [Chrome, Screen sharing controls](https://developer.chrome.com/docs/web-platform/screen-sharing-controls.md.txt)
- `surfaceSwitching: "include"` shows a "Share this tab instead" button, so the host can switch tabs without restarting the share (Chrome 107). Chrome may change defaults, so set it explicitly. — [Chrome](https://developer.chrome.com/docs/web-platform/screen-sharing-controls.md.txt)
- `selfBrowserSurface: "exclude"` removes the current tab from the list and prevents the "hall of mirrors" effect. The default is currently exclude. It cannot be combined with `preferCurrentTab: true`. — [Chrome](https://developer.chrome.com/docs/web-platform/screen-sharing-controls.md.txt)
- `monitorTypeSurfaces: "exclude"` removes screens from the picker (Chrome 119). `systemAudio` (Chrome 105): with "exclude", audio is offered for tabs and windows but not screens. The default is "include". Firefox and Safari do not support these options. — [Chrome](https://developer.chrome.com/docs/web-platform/screen-sharing-controls.md.txt); [Chrome blog, avoid oversharing](https://developer.chrome.com/blog/avoiding-oversharing-when-screen-sharing)
- Discord offers a "Hide stream preview" option at share start, which controls whether others see a preview before joining. — [Discord Support](https://support.discord.com/hc/articles/360040816151)

### Inferences
- After `getDisplayMedia()` resolves, check `stream.getAudioTracks().length`. If it is 0, show a blocking-but-dismissible warning: "Suara tab tidak ikut terbagi. Ulangi dan nyalakan 'Bagikan audio tab'". Offer a re-share button and a small illustration of the checkbox.
- "You are sharing" state: a persistent status strip with a live dot, "Sedang berbagi: <tab title if available>", elapsed time, viewer presence ("1 penonton tersambung" / "Menunggu penonton…"), and Stop / Ganti tab buttons. Listen for the track's `ended` event (the host pressed Chrome's own "Stop sharing" bar) and reflect it on both sides ("Host menjeda berbagi layar").
- Invite: a "Salin tautan" button plus a WhatsApp share (Web Share API on mobile, a `wa.me/?text=` URL on desktop), with pre-written text that holds the link and the PIN on separate lines. Give copy confirmation inline ("Tersalin"), not as a modal.
- Presence for 2 people: show the viewer's connection quality and the quality they chose on the host's side, so the host can tell "dia di 480p, koneksi lemah".

### Gaps
- `suppressLocalAudioPlayback`, `restrictOwnAudio`, Captured Surface Control and Conditional Focus were not covered by the fetched doc. Check MDN or Chrome docs separately if they are needed (for example, to avoid audio echo on the host laptop while WhatsApp voice runs on a phone).
- No primary source on Teleparty or Rave host or invite flows.

## 8. Accessibility for video overlays: targets, contrast over video, reduced motion, live regions

### Takeaway
Use a 24×24 CSS px target floor (WCAG 2.2 AA 2.5.8) and aim for 44×44 (AAA 2.5.5), which also matches mobile platform norms. Gate floating reactions behind `prefers-reduced-motion` (WCAG 2.3.3, technique C39). Auto-started motion also falls under 2.2.2 Pause, Stop, Hide. Use `role="log"` for chat and `role="status"` for connection state.

### Cited Findings
- WCAG 2.2 SC 2.5.8 Target Size (Minimum), AA: pointer targets at least 24×24 CSS px, or with spacing so that a 24 px circle around each target does not overlap another target. Inline links are exempt. AAA 2.5.5 is 44×44. — [W3C Understanding 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum); [Smashing Magazine](https://smashingmagazine.com/2024/07/getting-bottom-minimum-wcag-conformant-interactive-element-size/)
- WCAG 2.3.3 Animation from Interactions (AAA): let users prevent non-essential motion triggered by interaction, because of vestibular disorders. Sufficient techniques: C39 (CSS `prefers-reduced-motion`), SCR40 (JS `matchMedia('(prefers-reduced-motion)')`), or a user preference. 2.2.2 covers auto-started animation, and one animation can fail both. — [W3C Understanding 2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)
- `role="log"` is for chat: new items are appended in order, the implicit live setting is polite, aria-atomic is false, and an accessible name is required. — [MDN, log role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/log_role)
- Apple: prefer translucent overlays and keep them short. — [Apple HIG, Playing video](https://developer.apple.com/design/human-interface-guidelines/playing-video.md)

### Inferences
- Text over live video can't be contrast-checked against a known background, so always put overlay text on its own scrim. Use a gradient at the top and bottom edges (for example black at 60 to 70% fading to 0) or a solid pill behind chat lines and status text, and check 4.5:1 for text against the scrim's darkest-guaranteed value. Icons need 3:1 (WCAG 1.4.11).
- Reactions from the other person are motion the user did not trigger, so 2.2.2 applies as well as 2.3.3. Provide the reduced-motion fallback and an in-app off switch.
- Don't announce every reaction to screen readers. Announce chat messages via the log. Announce reactions at most as aggregated text, or not at all.
- When controls auto-hide, keep them reachable by keyboard (focus reveals them) and don't hide while focus is inside them (WCAG 2.4.11 Focus Not Obscured, by inference).

### Gaps
- No source fetched on recommended scrim opacities for video. The values above are a starting point, not a cited standard.
