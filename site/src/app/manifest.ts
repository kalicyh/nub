import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Nub',
    short_name: 'Nub',
    description:
      'Nub is a TypeScript-first toolkit for Node.js: run TypeScript files on stock Node, a faster npm run, a pnpm-compatible package manager, and a built-in Node version manager. No lock-in.',
    start_url: '/',
    display: 'standalone',
    theme_color: '#100f0d',
    background_color: '#100f0d',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
