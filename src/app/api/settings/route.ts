import { api, readJson } from '@/lib/server/api';
import { HttpError } from '@/lib/server/db';
import * as repo from '@/lib/server/repo';
import { getConfig } from '@/lib/server/config';
import { resolveCredentials } from '@/lib/server/telegram';
import { encryptSecret, maskToken } from '@/lib/core/crypto';

export const dynamic = 'force-dynamic';

const TZS = ['UTC', 'America/New_York', 'Asia/Seoul'];

/** Returns settings with secrets MASKED. The full token never leaves the server. */
export async function GET() {
  return api(async (db) => {
    const cfg = getConfig();
    const [tg, v] = await Promise.all([resolveCredentials(db, cfg), repo.getAppSettings(db, ['display_timezone', 'replay_defaults', 'providers'])]);
    return {
      timezone: v.display_timezone ?? 'UTC',
      replay: v.replay_defaults ?? {},
      providers: v.providers ?? {},
      telegram: {
        tokenHint: tg.tokenSource === 'env' ? `${maskToken(cfg.telegramBotTokenEnv!)} (env)` : tg.settings.bot_token_hint,
        tokenSource: tg.tokenSource, chatId: tg.chatId, chatSource: tg.settings.chat_id ? 'database' : cfg.telegramChatIdEnv ? 'env' : null,
        liveEnabled: tg.settings.live_enabled, backtestEnabled: tg.settings.backtest_enabled,
        cooldownSeconds: tg.settings.cooldown_seconds, maxPerMinute: tg.settings.max_per_minute,
        lastTest: { at: tg.settings.last_test_at, ok: tg.settings.last_test_ok, error: tg.settings.last_test_error },
        canStoreToken: !!cfg.encryptionKey,
      },
      tradingview: {
        secretConfigured: !!cfg.webhookSecret, ipAllowlist: cfg.enforceTvIpAllowlist,
        webhookUrl: cfg.appBaseUrl ? `${cfg.appBaseUrl}/api/webhooks/tradingview` : null,
      },
      appBaseUrl: cfg.appBaseUrl,
    };
  });
}

export async function PUT(req: Request) {
  return api(async (db) => {
    const b = await readJson(req);
    const cfg = getConfig();
    if (b.timezone !== undefined) {
      if (!TZS.includes(String(b.timezone))) throw new HttpError(422, 'timezone: UTC | America/New_York | Asia/Seoul');
      await repo.setAppSetting(db, 'display_timezone', b.timezone);
    }
    if (b.replay !== undefined && typeof b.replay === 'object') await repo.setAppSetting(db, 'replay_defaults', b.replay);
    if (b.providers !== undefined && typeof b.providers === 'object') await repo.setAppSetting(db, 'providers', b.providers);
    const t = b.telegram as Record<string, unknown> | undefined;
    if (t) {
      const patch: Parameters<typeof repo.updateTelegramSettings>[1] = {};
      if (typeof t.botToken === 'string' && t.botToken.trim()) {
        if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(t.botToken.trim())) throw new HttpError(422, 'Format bot token tidak valid');
        if (!cfg.encryptionKey) throw new HttpError(422, 'APP_ENCRYPTION_KEY belum diatur; simpan token lewat env TELEGRAM_BOT_TOKEN');
        patch.bot_token_encrypted = await encryptSecret(t.botToken.trim(), cfg.encryptionKey);
        patch.bot_token_hint = maskToken(t.botToken.trim());
      }
      if (t.clearToken === true) { patch.bot_token_encrypted = null; patch.bot_token_hint = null; }
      if (t.chatId !== undefined) {
        const c = String(t.chatId).trim();
        if (c && !/^(-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/.test(c)) throw new HttpError(422, 'Chat ID tidak valid');
        patch.chat_id = c || null;
      }
      if (t.liveEnabled !== undefined) patch.live_enabled = t.liveEnabled === true;
      if (t.backtestEnabled !== undefined) patch.backtest_enabled = t.backtestEnabled === true;
      if (t.cooldownSeconds !== undefined) {
        const n = Number(t.cooldownSeconds);
        if (!Number.isInteger(n) || n < 0 || n > 86_400) throw new HttpError(422, 'Cooldown 0–86400 detik');
        patch.cooldown_seconds = n;
      }
      if (t.maxPerMinute !== undefined) {
        const n = Number(t.maxPerMinute);
        if (!Number.isInteger(n) || n < 1 || n > 60) throw new HttpError(422, 'Batas per menit 1–60');
        patch.max_per_minute = n;
      }
      await repo.updateTelegramSettings(db, patch);
    }
    return { saved: true };
  });
}
