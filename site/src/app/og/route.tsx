import { renderOgImage } from '@/lib/og';
import type { NextRequest } from 'next/server';

/* Query-param-driven OG card generator.

   Next's file-convention `opengraph-image.tsx` cannot live inside the docs
   `[[...slug]]` optional-catch-all segment (the catch-all must be the terminal
   path segment, which Turbopack enforces), so per-page docs cards are produced
   here instead and wired explicitly from each page's `generateMetadata`.

       /og?title=Script%20runner&eyebrow=nub%20run

   The homepage uses its own static `(home)/opengraph-image.tsx`.

   The handler reads query params, so it must render dynamically — `force-static`
   would strip `searchParams` and every card would fall back to the defaults.
   Crawlers fetch the absolute `nubjs.com/og?…` URL live; Vercel caches the PNG
   by full query string, so each distinct card is computed at most once. */

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  // Parse from the raw request URL. In dev/Turbopack, `req.nextUrl.searchParams`
  // can come back empty for a dynamic route handler; the raw `req.url` retains
  // the query string reliably.
  const searchParams = new URL(req.url).searchParams;
  const title = searchParams.get('title') ?? 'Documentation';
  const eyebrow = searchParams.get('eyebrow') ?? 'Documentation';

  return renderOgImage({ title, eyebrow });
}
