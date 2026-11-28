# Infrastruktur nonton bareng WebRTC 2 orang: Cloudflare signaling, TURN, dan NAT Indonesia ke Korea Selatan

Researched 2026-11-28. All Cloudflare figures were read from developers.cloudflare.com on that date. Network data comes from APNIC (daily series through 2026-11-27), Ookla (via news) and Opensignal.

## Q1. Cloudflare Workers Free plan limits for a WebSocket signaling server

### Takeaway
Two people doing signaling fit inside Workers Free with a lot of room to spare. The real cap is 100,000 requests/day (UTC reset). The 10 ms CPU limit applies per HTTP request. An HTTP or WebSocket Worker has no hard wall-clock duration limit while the client stays connected. Cloudflare documents no idle timeout for WebSockets.

### Cited Findings
- Workers Free: 100,000 requests/day, reset at midnight UTC. Going over returns Error 1027, which fails open or closed depending on route mode. — [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- CPU time: 10 ms per HTTP request on Free (also 10 ms per Cron Trigger). Memory is 128 MB per isolate. Subrequests: 50 per invocation, plus 1,000 to internal services. — [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- Duration: "There is no hard limit on duration for HTTP-triggered Workers" while the client stays connected. `waitUntil()` can run up to 30 s after the response. Cron, DO alarms and Queues get 15 min. — [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- The limits page gives no WebSocket message size limit and no idle timeout for Workers WebSockets. During runtime updates, existing connections (WebSockets included) get a grace period of up to 20 minutes, and crashes or resource pressure can cut them earlier. — [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- Outbound WebSockets count toward the 6 simultaneous outgoing connections per invocation. — [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

### Inferences
- A 2-person session uses only a few dozen requests (page load, WS upgrade, offer/answer/ICE messages). 100k/day is effectively unlimited for this use.
- Even without a documented idle timeout, the client should reconnect automatically: deploys and runtime updates can drop connections after the 20-minute grace period. After the P2P connection is up, signaling can be closed or left idle.

### Gaps
- No official figure for idle timeout or message size on WebSockets in a plain Worker without a DO. The 32 MiB DO figure is in Q2.

## Q2. Durable Objects on Workers Free: SQLite, Hibernation API, billing, alarms, wrangler config

### Takeaway
Yes. On Workers Free, **only** SQLite-backed Durable Objects are available. Free quotas: 100k requests/day and 13,000 GB-s/day. Incoming WS messages are billed at 20:1, and outgoing messages and pings are free. The Hibernation API (acceptWebSocket + auto-response) stops duration billing while sockets sit idle. Config: migration `new_sqlite_classes`.

### Cited Findings
- Free plan: "only SQLite-backed Durable Objects are available"; key-value storage is not. Free limits reset at 00:00 UTC, and operations over a limit fail. — [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- Requests (HTTP, RPC, WS messages, alarm invocations): Free 100,000/day. Paid: 1M/month included, then $0.15/M. — [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- Duration: Free 13,000 GB-s/day. Paid: 400,000 GB-s/month, then $12.50/M GB-s. — [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- Incoming WS messages are billed at 20:1 (100 messages = 5 requests). Outgoing messages are not charged, and incoming protocol pings are not charged. — [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- SQLite storage billing started January 2026 (target 7 Jan 2026). Free: 5M rows read/day, 100k rows written/day, 5 GB total. Paid: 25B reads/month and 50M writes/month included, then $0.001/M reads, $1.00/M writes, $0.20/GB-month. — [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- Alarms: each invocation counts as a request, and each `setAlarm()` is billed as one row written. — [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- DO limits (SQLite): unlimited number of objects; 100 classes/account on Free (500 Paid); 5 GB storage/account on Free; received WS messages up to 32 MiB; CPU 30 s per request by default (configurable up to 5 min), reset on every request or WS message; soft limit of 1,000 req/s per object. The per-object storage figure is inconsistent (table says 10 GB, FAQ says 1 GB on Free). — [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- `ctx.acceptWebSocket(ws, tags?)`: up to 10 tags per socket, 256 chars each. Do not call `ws.accept()` or use `addEventListener`. `getWebSockets(tag?)` returns active sockets. Hibernation allows up to 32,768 WebSockets per DO. — [DO State API](https://developers.cloudflare.com/durable-objects/api/state/)
- `setWebSocketAutoResponse(new WebSocketRequestResponsePair(req, res))`: request and response up to 2,048 chars each. Matching requests get the response without waking the object and without incurring billable duration. `getWebSocketAutoResponseTimestamp(ws)` returns the time of the last auto-response, which is useful for heartbeat detection. `setHibernatableWebSocketEventTimeout(ms)` accepts up to 7 days. — [DO State API](https://developers.cloudflare.com/durable-objects/api/state/)
- Compatibility flag `web_socket_auto_reply_to_close` is on by default for compatibility dates ≥ 2026-04-07, so sockets move from CLOSING to CLOSED faster. — [DO State API](https://developers.cloudflare.com/durable-objects/api/state/)
- `serializeAttachment` / `deserializeAttachment`: max 16,384 bytes. Survives hibernation and is lost when the connection closes. Accepts any structured-clone type. — [DO WebSockets best practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- Handlers: `webSocketMessage(ws, msg)` (not called for ping frames), `webSocketClose(ws, code, reason, wasClean)` (echo the close code for 1000–4999 except 1004/1005/1006/1015). No GB-s billing during hibernation, and clients stay connected. Alarms, `setTimeout`/`setInterval` and incoming requests prevent hibernation. Ping/pong does not wake the object. Hibernated connections survive code updates, but a standard (non-hibernation) API connection drops on every update. — [DO WebSockets best practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- Wrangler config: `"migrations": [{ "tag": "v1", "new_sqlite_classes": ["Room"] }]` plus `"durable_objects": { "bindings": [{ "name": "ROOM", "class_name": "Room" }] }`. Note: DO entries in the newer `exports` key cannot be combined with `migrations`, and a Worker deployed with `exports` cannot go back to `migrations`. — [DO migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)

### Inferences
- Pattern: one DO per room (`idFromName(roomCode)`), hibernation API, `setWebSocketAutoResponse("ping","pong")` for app-level heartbeats so the object never wakes up. Store the role (host/viewer) in tags or the attachment.
- Avoid `setInterval` in the DO, because it blocks hibernation. Use an alarm for room expiry. Each alarm costs 1 request + 1 row write, which is negligible.
- Estimate: 1 session = about 50–200 incoming messages (SDP + trickle ICE) ≈ 3–10 billed requests. Far below 100k/day.

### Gaps
- Exact idle time before a DO hibernates ("a short period"; no number given).
- Per-object storage on Free (1 GB vs 10 GB) is inconsistent in the docs. Irrelevant for signaling.

## Q3. Workers Static Assets vs Pages; one Worker for frontend + DO

### Takeaway
Cloudflare now officially says: "For new static sites and full-stack applications, start with Cloudflare Workers." Workers Static Assets supports `_headers`, `_redirects`, `run_worker_first` (boolean or pattern array with `!` negation), and `not_found_handling`. One Worker can serve both static assets and the DO signaling: assets are served first, and `/ws` or `/api/*` is routed to the Worker.

### Cited Findings
- Pages docs banner: "For new static sites and full-stack applications, start with Cloudflare Workers," with a migration guide to Workers. — [Cloudflare Pages docs](https://developers.cloudflare.com/pages/)
- Migration guide: Workers has "a distinctly broader set of features." Static asset requests are free on both. `_headers`, `_redirects` and `run_worker_first` are supported on Workers. `not_found_handling: "single-page-application"` must be set manually (Pages detects it automatically). — [Migrate from Pages](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)
- Example config: `"assets": { "directory": "./dist/client/", "binding": "ASSETS", "not_found_handling": "single-page-application", "run_worker_first": true }`. Workers serve static assets ahead of the script by default unless `run_worker_first` is set. — [Migrate from Pages](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)
- `run_worker_first` can be `true` or an array of patterns, e.g. `["/api/*", "!/api/docs/*"]`. `not_found_handling`: `"single-page-application"` (200 + index.html) or `"404-page"`. — [Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- Static asset limits: 20,000 files per version, 25 MiB per file, 100 `_headers` rules (2,000 chars/line), 2,100 `_redirects` entries. — [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- A Worker invocation via `run_worker_first` is charged like a normal Worker invocation. — [Migrate from Pages](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)

### Inferences
- Recommended setup: one Worker, `assets.directory` = static build, `run_worker_first: ["/ws", "/api/*"]` (or no run_worker_first at all, so the Worker only runs for paths that don't match an asset). The Worker exports the DO class and forwards the WebSocket upgrade to the DO stub. Only page visits and WS upgrades consume the 100k/day quota; static assets are free.
- Use `_headers` for security headers (CSP, Permissions-Policy camera/mic, etc.).

### Gaps
- The `html_handling` option (`auto-trailing-slash` / `force-trailing-slash` / `drop-trailing-slash` / `none`) is not mentioned on the pages I fetched. Check the [Static Assets configuration/routing docs](https://developers.cloudflare.com/workers/static-assets/) before relying on it.
- The Static Assets page I fetched does not explicitly say "a Worker with assets can export a DO". The migration guide and DO config use the same Worker, but no official full-stack + DO example was verified.

## Q4. Cloudflare Realtime TURN: pricing, credentials API, ports; alternatives

### Takeaway
Cloudflare Realtime TURN costs $0.05/GB of egress, and **the first 1,000 GB/month is free** (shared with the SFU). It is anycast. Ports: 3478 UDP/TCP, 443 UDP, 80 TCP, 5349/443 TLS. Short-lived credentials come from `POST https://rtc.live.cloudflare.com/v1/turn/keys/{KEY_ID}/credentials/generate-ice-servers` with `{"ttl": 86400}`. The best free alternative is Metered Open Relay at 20 GB/month (hard cap).

### Cited Findings
- "The SFU and TURN services cost $0.05 per GB of egress." "The first 1,000 GB each month is free." "SFU and TURN share this allowance." Page last updated 2026-09-22. — [Realtime pricing](https://developers.cloudflare.com/realtime/pricing/)
- The TURN page says TURN is free when used together with the Realtime SFU. Otherwise it is $0.05 per GB outbound from Cloudflare to the TURN client. — [Realtime TURN](https://developers.cloudflare.com/realtime/turn/)
- Addresses: STUN `stun.cloudflare.com:3478/udp`. TURN UDP `turn.cloudflare.com:3478` (alternate 443/udp). TURN TCP 3478 (alternate 80/tcp). TURN TLS 5349 (alternate 443/tcp). Anycast routes the client to the nearest Cloudflare location. — [Realtime TURN](https://developers.cloudflare.com/realtime/turn/)
- Generate: `curl https://rtc.live.cloudflare.com/v1/turn/keys/$TURN_KEY_ID/credentials/generate-ice-servers -H "Authorization: Bearer $TURN_KEY_API_TOKEN" -H "Content-Type: application/json" --data '{"ttl": 86400}'` returns 201 with `{"iceServers":[{"urls":["stun:stun.cloudflare.com:3478", ...]},{"urls":["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp", ...],"username":"...","credential":"..."}]}`. The TTL should be longer than the expected usage time. — [Generate credentials](https://developers.cloudflare.com/realtime/turn/generate-credentials/)
- Revoke: `POST .../v1/turn/keys/$TURN_KEY_ID/credentials/$USERNAME/revoke` returns 204. Port 53 is blocked by browsers and will time out. Filter out URLs with port 53 if you are not using trickle ICE. — [Generate credentials](https://developers.cloudflare.com/realtime/turn/generate-credentials/)
- Metered Open Relay: free 20 GB/month of TURN, hard-capped, requires a free account plus API key, standard endpoint `standard.relay.metered.ca` only (regional endpoints are paid). An older source said 50 GB, which conflicts and is likely outdated. — [Metered Open Relay](https://metered.ca/tools/openrelay/); [Metered blog list of ICE servers](https://www.metered.ca/blog/list-of-webrtc-ice-servers/)

### Inferences
- 1,000 GB/month free ≈ 2,200 hours of 1 Mbps video or ≈ 440 hours at 5 Mbps (1 Mbps × 3600 s ≈ 0.45 GB/hour). For 2 people, TURN is effectively free even if every session were relayed.
- Credentials must be generated server-side (in the Worker, with the token in a Wrangler secret) and returned to the client. Do not put the API token in the frontend. A TTL of a few hours is enough for one viewing session.
- `turns:...:443?transport=tcp` is the fallback for restrictive networks (firewalls that only allow 443).
- Self-hosted coturn: no free quota (needs a VPS). Not researched in detail; the free VPS egress cost is a gap.

### Gaps
- Exact Cloudflare TURN rate limits per key were not checked.
- Coturn / free VPS (e.g. Oracle free tier) egress quotas were not verified.

## Q5. NAT: CGNAT/symmetric in ID and KR, P2P success rates without TURN, IPv6

### Takeaway
No public measurement of symmetric NAT per Indonesian or Korean carrier was found. Industry figures put about 15–25% of WebRTC calls on TURN, which are rough vendor estimates. IPv6 data is a big plus: SK Telecom ≈94% IPv6-capable, Telkomsel ≈59%, XL ≈45%, IndiHome (Telkom) ≈44%, Biznet ≈39%. But Indosat ≈3% and First Media/Linknet ≈2%, and KT/LG U+ are low (17–29%).

### Cited Findings
- APNIC IPv6 Capable (30-day window, data through 2026-11-27): Indonesia overall ≈30.2% capable / 29.1% preferred; Korea overall ≈30.9% capable / 27.5% preferred. — [APNIC IPv6 ID](https://stats.labs.apnic.net/ipv6/ID); [APNIC IPv6 KR](https://stats.labs.apnic.net/ipv6/KR)
- Indonesia per ASN (IPv6 capable / preferred): Telkomsel AS23693 59.09% / 56.29%; Telkom Indonesia (IndiHome) AS7713 44.15% / 43.01%; XL Axiata AS24203 44.71% / 44.32%; Indosat AS4761 2.74% / 2.61%; Biznet AS17451 38.53% / 36.70%; Linknet-Fastnet (First Media) AS23700 1.66% / 0.15%. — [APNIC IPv6 ID](https://stats.labs.apnic.net/ipv6/ID)
- Korea per ASN (IPv6 capable): SK Telecom AS9644 94.42%; Korea Telecom AS4766 17.40%; LG Powercomm AS17858 21.38%; LG Dacom AS3786 29.35%; SK Broadband AS9318 7.42%. AS4766/AS3786 mix fixed and mobile (KT and LG U+ mobile are not split out). — [APNIC IPv6 KR](https://stats.labs.apnic.net/ipv6/KR)
- Philipp Hancke (fippo) analysis of one platform: ≈17.7% of calls were relayed. Of those, ~20% TURN/UDP, ~78% TURN/TCP, ~2% TURN/TLS. (Summary from search results; the article returned 403 when fetched directly, so the numbers were not verified first-hand.) — [fippo, "So I read that 20% of WebRTC calls fail"](https://medium.com/@fippo/67b185e49765); [fippo, "What kind of TURN server is being used?"](https://medium.com/@fippo/what-kind-of-turn-server-is-being-used-d67dbfc2ff5d)
- Vendor claim: about 1 in 5 connections need TURN, citing Chrome UMA but with no data shown. — [Metered: what is a TURN server](https://www.metered.ca/blog/what-is-a-turn-server/); see also [BlogGeek.me TURN glossary](https://bloggeek.me/webrtcglossary/turn/)
- Mobile CGNAT often behaves like symmetric NAT and blocks unsolicited inbound UDP (general vendor/practitioner claim). — [Metered: what is a TURN server](https://www.metered.ca/blog/what-is-a-turn-server/)

### Inferences
- Direct IPv6 P2P is quite likely in the combination Telkomsel tethering or IndiHome/Biznet ↔ SKT mobile, because both sides are often IPv6 and avoid IPv4 CGNAT. It is not guaranteed, since some carrier IPv6 firewalls block unsolicited inbound traffic. If the host uses First Media or Indosat, or the viewer is on KT/LG U+, the connection depends on IPv4 hole punching through CGNAT and the chance of needing TURN goes up.
- Practical implication: always include TURN (Cloudflare, free up to 1 TB) in `iceServers`, including `turns:443`. Don't rely only on Google STUN. Log `candidate-pair` types via `getStats()` to measure the real direct vs relay rate between this pair.
- The 15–25% figure is a mixed global average. For the cross-border mobile ↔ CGNAT home case it could be higher, but there is no data.

### Gaps
- No public measurements of NAT type (symmetric vs cone) for IndiHome, Biznet, First Media, Telkomsel, XL, Indosat, SKT, KT or LG U+ were found.
- No academic study of WebRTC success rates for the Indonesia↔Korea route.
- Whether Korean carriers' IPv6 firewalls allow inbound P2P was not verified.

## Q6. Indonesian broadband upload speeds and Jakarta–Seoul latency

### Takeaway
Upload is not the bottleneck: the Ookla median for Indonesian fixed broadband is ≈36 Mbps upload (Aug 2026), and measured averages for the major ISPs are around 27–33 Mbps. Biznet markets symmetric speeds. Jakarta–Seoul RTT is ≈90 ms between AWS regions. Consumer paths can be much higher (one anecdote says 170–180 ms).

### Cited Findings
- Ookla Speedtest Global Index, Aug 2026: Indonesian fixed broadband median upload 36.23 Mbps (global 64.69), ranked 113th. Fixed median download: 43.18 Mbps (Nov 2025) → 45.40 (Feb 2026) → 47.10 (May 2026) → 51.40 (Aug 2026). — [Bisnis.com, Oct 2026](https://teknologi.bisnis.com/read/20261014/101/2012346/peringkat-kecepatan-internet-ri-merangkak-di-global-agustus-2026-berkat-5g)
- Opensignal Oct 2026 (data Jul–Sep 2026), average upload: MyRepublic 32.9 Mbps, XL Home 29.6, Biznet Home 28.7, Indosat HiFi 27.2. IndiHome is not in the top list (figure not available in the summary). — [Opensignal Indonesia fixed broadband, Oct 2026](https://insights.opensignal.com/reports/2026/10/indonesia/fixed-broadband-experience)
- The Biznet Home brochure (Jan 2026) states symmetric upload/download. Example plan: 200 Mbps for Rp350,000/month. — [Biznet Home brochure Jan 2026](https://www.biznetnetworks.com/wp-content/uploads/2026/01/Biznet-Home-IND-15-Jan-2026-2.pdf)
- Biznet raised speeds by up to 30% in 2026 at the same prices (e.g. 65→100 Mbps for Rp250,000). — [Bisnis.com, Mar 2026](https://teknologi.bisnis.com/read/20260304/101/1957518/kecepatan-fixed-broadband-tembus-1-gbps-biznet-500-mbps-sangat-mudah-kami-beri)
- MyRepublic is known for symmetric 1:1 plans. No IndiHome symmetric plan was found. — [Bisnis.com plan comparison, Dec 2025](https://teknologi.bisnis.com/read/20251204/101/1932755/perbandingan-tarif-langganan-internet-indihome-myrepublic-first-media-dan-biznet-home)
- AWS ap-southeast-3 (Jakarta) ↔ ap-northeast-2 (Seoul): ≈92 ms RTT. — [Economize AWS latency](https://www.economize.cloud/resources/aws/latency/ap-southeast-3-vs-ap-northeast-2/)
- A user anecdote reports 170–180 ms gaming ping from Jakarta to Asian servers. This is not a backbone measurement. — [Blizzard forum](https://us.forums.blizzard.com/en/wow/t/anyone-else-playing-from-indonesia/1056453)

### Inferences
- 1–5 Mbps of video upload is safe on almost any home plan, including lower tiers. The risk comes from Wi-Fi, peak-hour congestion and FUP, not nominal speed.
- An RTT of ≈90–180 ms is fine for watch-party sync (target a drift of < 500 ms). For relay, Cloudflare anycast TURN adds at most a little latency, because each side connects to its nearest PoP (Jakarta and Seoul) and traffic crosses the Cloudflare backbone.

### Gaps
- No exact IndiHome upload figure (the IndiHome upload:download ratio per plan was not verified).
- No direct RIPE Atlas or WonderNetwork Jakarta–Seoul measurement.
- Korean mobile plan costs: skipped as instructed.
