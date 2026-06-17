import type { ShikiTransformer } from '@shikijs/types';
import type { Element, Text } from 'hast';

/* A shiki transformer that gives ```console fences a terminal look: the `$ `
   prompt renders in the ember accent (and is unselectable, so copy skips it),
   command text reads bright, and every non-command (output) line is dimmed.
   Mirrors the hand-built `Terminal`/`ShimDemo` components, but applied
   automatically to every MDX `console` fence — no per-block authoring.

   Gated on `lang === 'console'`, so bash/text/ts/json fences are untouched.

   Mechanism: in the `line()` hook we read the line's plain text. If it starts
   with `$ ` we tag the line `data-cmd` and replace the leading `$ ` glyph with
   a dedicated, `select-none` ember span; otherwise we tag it `data-output`.
   The actual colors live in `global.css` (so the rule set stays in one place
   and the transformer stays presentation-free). */

function lineText(node: Element): string {
  let out = '';
  for (const child of node.children) {
    if (child.type === 'text') out += child.value;
    else if (child.type === 'element') out += lineText(child);
  }
  return out;
}

// Strip the leading `$ ` from the line's hast so we can re-add it as a styled,
// unselectable prompt span. Walks the token spans, dropping the first two
// characters (`$` then a space) wherever they fall.
function stripPrompt(node: Element): void {
  let remaining = 2; // "$ "
  for (const child of node.children) {
    if (remaining === 0) break;
    if (child.type !== 'element') continue;
    for (const grandchild of child.children) {
      if (remaining === 0) break;
      if (grandchild.type === 'text') {
        const t = grandchild as Text;
        const take = Math.min(remaining, t.value.length);
        t.value = t.value.slice(take);
        remaining -= take;
      }
    }
  }
}

export function transformerConsole(): ShikiTransformer {
  return {
    name: 'nub:console',
    line(node) {
      if (this.options.lang !== 'console') return;

      const text = lineText(node);
      if (text.startsWith('$ ')) {
        node.properties['data-cmd'] = '';
        stripPrompt(node);
        node.children.unshift({
          type: 'element',
          tagName: 'span',
          properties: { class: 'console-prompt' },
          children: [{ type: 'text', value: '$ ' }],
        });
      } else {
        node.properties['data-output'] = '';
      }
    },
  };
}
