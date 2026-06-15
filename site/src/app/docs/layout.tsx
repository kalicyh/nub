import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';
import type { Node as TreeNode, Root as TreeRoot } from 'fumadocs-core/page-tree';
import { baseOptions } from '@/lib/layout.shared';
import { source } from '@/lib/source';

/* Pages that map to a concrete command get a subtle, right-aligned mono chip
   in the sidebar — descriptive label on the left, the command on the right. */
const COMMAND_BY_URL: Record<string, string> = {
  '/docs/runtime': 'nub <file>',
  '/docs/run': 'nub run',
  '/docs/nubx': 'nubx',
  '/docs/install': 'nub install',
  '/docs/node': 'nub node',
  '/docs/pm': 'nub pm',
  '/docs/watch': 'nub watch',
};

function LabelWithChip({ label, command }: { label: ReactNode; command: string }) {
  return (
    <span className="flex w-full items-center justify-between gap-2">
      <span>{label}</span>
      <code className="shrink-0 whitespace-nowrap rounded border border-fd-border/50 bg-fd-muted px-1 py-px font-mono text-[0.58rem] leading-tight font-normal text-fd-muted-foreground in-data-[active=true]:border-fd-primary/30 in-data-[active=true]:bg-fd-primary/10 in-data-[active=true]:text-fd-primary">
        {command}
      </code>
    </span>
  );
}

function styleNode(node: TreeNode): TreeNode {
  if (node.type === 'folder') {
    const styled = { ...node, children: node.children.map(styleNode) };
    // A folder-with-index (e.g. install/) renders its title as a link to the
    // index page with a chevron beside it. Apply the same command chip the
    // index page would get, so the "nub install" chip stays visible instead of
    // being lost to the chevron slot.
    const command = node.index ? COMMAND_BY_URL[node.index.url] : undefined;
    if (command) {
      styled.name = <LabelWithChip label={node.name} command={command} />;
    }
    return styled;
  }
  if (node.type === 'page') {
    const command = COMMAND_BY_URL[node.url];
    if (command) {
      return { ...node, name: <LabelWithChip label={node.name} command={command} /> };
    }
  }
  return node;
}

export default function Layout({ children }: { children: ReactNode }) {
  // Keep the nav title + GitHub link, but drop the "Docs"/"Blog" nav links
  // from the docs sidebar — they only belong in the top home nav.
  const { links, ...base } = baseOptions();

  const tree: TreeRoot = {
    ...source.pageTree,
    children: source.pageTree.children.map(styleNode),
  };

  return (
    <DocsLayout tree={tree} {...base} links={[]}>
      {children}
    </DocsLayout>
  );
}
