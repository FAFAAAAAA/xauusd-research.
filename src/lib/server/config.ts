/** Server-only configuration. Never import this from a client component. */
export interface ServerConfig {
  adminPassword: string | null;
  sessionSecret: string | null;
  encryptionKey: string | null;
  webhookSecret: string | null;
  enforceTvIpAllowlist: boolean;
  telegramBotTokenEnv: string | null;
  telegramChatIdEnv: string | null;
  appBaseUrl: string | null;
  telegramApiBase: string;
}

export function getConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const s = (k: string) => (env[k] && env[k]!.trim() ? env[k]!.trim() : null);
  return {
    adminPassword: s('ADMIN_PASSWORD'),
    sessionSecret: s('SESSION_SECRET'),
    encryptionKey: s('APP_ENCRYPTION_KEY'),
    webhookSecret: s('TRADINGVIEW_WEBHOOK_SECRET'),
    enforceTvIpAllowlist: env.TRADINGVIEW_ENFORCE_IP_ALLOWLIST === 'true',
    telegramBotTokenEnv: s('TELEGRAM_BOT_TOKEN'),
    telegramChatIdEnv: s('TELEGRAM_CHAT_ID'),
    appBaseUrl: s('APP_BASE_URL')?.replace(/\/$/, '') ?? null,
    telegramApiBase: s('TELEGRAM_API_BASE') ?? 'https://api.telegram.org',
  };
}

/**
 * TradingView's published webhook source IPs. Verify against
 * https://www.tradingview.com/support/solutions/43000529348 before enabling the allowlist,
 * as TradingView may change them.
 */
export const TRADINGVIEW_IPS = ['52.89.214.238', '34.212.75.30', '54.218.53.128', '52.32.178.7'];
