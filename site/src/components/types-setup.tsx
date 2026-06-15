'use client';

import { useState, type ReactNode } from 'react';

/* lucide `Clipboard` / `Check` glyphs (24×24 viewBox, stroke-width 2, rendered at
   16px = Tailwind size-4) — a 1:1 match for the icon Fumadocs paints on every
   code-block copy button, so this control reads identically to the copy buttons
   the user already sees on the `<pre>` blocks just below it. */
function CopyIcon({ copied }: { copied: boolean }) {
  return copied ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </svg>
  );
}

const DEFAULT_INSTALL = 'npm i -D @nubjs/types @types/node@26';
const DEFAULT_TSCONFIG = `{ "compilerOptions": { "types": ["node", "@nubjs/types"] } }`;

export function TypesSetup({
  install = DEFAULT_INSTALL,
  tsconfig = DEFAULT_TSCONFIG,
  children,
}: {
  /** The install command shown + copied. */
  install?: string;
  /** The tsconfig.json snippet shown + copied. */
  tsconfig?: string;
  /** Page-specific one-liner: which types come from where. */
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  /* Agent-ready directive: a short, pasteable instruction the user drops into
     their AI coding agent. Plain imperative prose + the two snippets. */
  const prompt = [
    'Set up TypeScript types for nub in this project:',
    '',
    `1. Install the type packages: \`${install}\``,
    '',
    `2. In tsconfig.json, set compilerOptions.types: \`${tsconfig}\``,
  ].join('\n');

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    /* No outer card border/background — just a titled note + ONE code block, so it
       no longer reads as a box inside a box. The single code block (install line +
       tsconfig snippet merged) is the only bordered surface, and carries a subtle
       copy button in its top-right corner exactly like every other code block. */
    <div className="my-6">
      <div className="mb-1 font-medium text-fd-foreground">TypeScript setup</div>

      {children ? <div className="mb-3 text-fd-muted-foreground [&>p]:m-0">{children}</div> : null}

      <div className="relative">
        {/* Subtle copy control — same glyph, size, bordered `bg-fd-secondary` chip,
            and hover behavior as the Fumadocs copy button on every code block, so it's
            just as visible as the ones the user already sees. Copies the agent-ready
            prompt (not the raw text); flips to a checkmark on copy. */}
        <button
          type="button"
          onClick={copy}
          aria-label="Copy TypeScript setup instructions for your AI agent"
          title="Copy setup instructions for your AI agent"
          data-checked={copied || undefined}
          className="absolute right-2 top-2.5 z-10 inline-flex items-center justify-center rounded-md border bg-fd-secondary p-1 text-fd-muted-foreground backdrop-blur-lg transition-colors duration-100 hover:bg-fd-accent hover:text-fd-accent-foreground data-checked:text-fd-accent-foreground"
        >
          <CopyIcon copied={copied} />
        </button>

        <pre className="overflow-x-auto rounded-lg border border-fd-border bg-fd-card/60 px-4 py-3.5 font-mono text-[0.9rem] leading-relaxed text-fd-foreground">
          <code>
            <span className="select-none text-ember">$ </span>
            {install}
            {'\n\n'}
            <span className="select-none text-fd-muted-foreground">{'// tsconfig.json\n'}</span>
            {tsconfig}
          </code>
        </pre>
      </div>
    </div>
  );
}
