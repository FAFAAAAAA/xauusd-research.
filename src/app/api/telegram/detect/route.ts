import { api } from '@/lib/server/api';
import { getConfig } from '@/lib/server/config';
import { resolveCredentials } from '@/lib/server/telegram';

export const dynamic = 'force-dynamic';

/**
 * Verifies the bot token with Telegram (getMe) and lists chats that have messaged the bot
 * (getUpdates), so the owner can pick a Chat ID without visiting the Bot API by hand.
 * Never returns the token itself.
 */
export async function POST() {
  return api(async (db) => {
    const cfg = getConfig();
    const { token, tokenSource, chatId } = await resolveCredentials(db, cfg);
    if (!token) return { tokenOk: false, error: 'Bot token belum diisi. Tempel token di kolom Bot token lalu Simpan, atau isi TELEGRAM_BOT_TOKEN di Vercel lalu Redeploy.' };
    const scrub = (s: string) => s.split(token).join('[TOKEN]');
    const tg = async (method: string) => {
      try {
        const r = await fetch(`${cfg.telegramApiBase}/bot${token}/${method}`, { cache: 'no-store' });
        return (await r.json()) as { ok: boolean; result?: unknown; description?: string; error_code?: number };
      } catch (e) {
        return { ok: false, description: scrub((e as Error).message) };
      }
    };
    const me = await tg('getMe');
    if (!me.ok) {
      const d = me.description ?? 'unknown';
      return {
        tokenOk: false, tokenSource,
        error: /Unauthorized|Not Found/i.test(d)
          ? `Token ditolak Telegram (${d}). Salin ulang token dari @BotFather — pastikan lengkap, tanpa spasi.`
          : `Gagal menghubungi Telegram: ${d}`,
      };
    }
    const bot = me.result as { username: string; first_name: string };
    const up = await tg('getUpdates');
    const chats = new Map<string, { id: string; name: string; type: string }>();
    if (up.ok && Array.isArray(up.result)) {
      for (const u of up.result as Array<Record<string, any>>) { // eslint-disable-line @typescript-eslint/no-explicit-any
        const c = (u.message ?? u.channel_post ?? u.my_chat_member ?? u.edited_message)?.chat;
        if (c?.id != null) chats.set(String(c.id), { id: String(c.id), name: c.title ?? [c.first_name, c.last_name].filter(Boolean).join(' ') ?? c.username ?? '', type: c.type });
      }
    }
    return {
      tokenOk: true, tokenSource, bot: { username: bot.username, name: bot.first_name },
      currentChatId: chatId, chats: [...chats.values()],
      hint: chats.size ? null : `Belum ada pesan masuk. Buka t.me/${bot.username}, tekan Start, kirim "halo", lalu tekan tombol ini lagi.`,
      webhookConflict: up.ok ? null : up.description ?? null,
    };
  });
}
