import type { BlockNode, InlineNode } from './resume-markdown';

const MAX_PREVIEW_DEPTH = 16;

export function isPreviewDepthSafe(blocks: BlockNode[]): boolean {
  const pending: { node: BlockNode | InlineNode; depth: number }[] = blocks.map((node) => ({
    node,
    depth: 1,
  }));
  while (pending.length > 0) {
    const { node, depth } = pending.pop()!;
    if (depth > MAX_PREVIEW_DEPTH) {
      return false;
    }
    if ('children' in node) {
      for (const child of node.children) {
        pending.push({ node: child, depth: depth + 1 });
      }
    }
    if (node.type === 'list') {
      for (const item of node.items) {
        for (const child of item) {
          pending.push({ node: child, depth: depth + 2 });
        }
      }
    }
  }
  return true;
}
