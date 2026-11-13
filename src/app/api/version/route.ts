import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Which build is live (the app reloads itself when this changes). No secrets: only the commit id of the deploy. */
export function GET() {
  const build = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_DEPLOYMENT_ID ?? 'dev';
  return NextResponse.json({ ok: true, data: { build } }, { headers: { 'cache-control': 'no-store' } });
}
