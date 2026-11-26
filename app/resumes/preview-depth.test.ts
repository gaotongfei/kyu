import { isPreviewDepthSafe } from './preview-depth';
import type { BlockNode, InlineNode } from './resume-markdown';

function quotes(count: number): BlockNode {
  let node: BlockNode = { type: 'paragraph', children: [{ type: 'text', text: 'hello' }] };
  for (let i = 0; i < count; i += 1) {
    node = { type: 'quote', children: [node] };
  }
  return node;
}

it('allows shallow content but refuses excessive block nesting before React creates DOM', () => {
  expect(isPreviewDepthSafe([quotes(14)])).toBe(true);
  expect(isPreviewDepthSafe([quotes(15)])).toBe(false);
  expect(isPreviewDepthSafe([quotes(1700)])).toBe(false);
  expect(isPreviewDepthSafe([])).toBe(true);
});

it('checks inline nesting in paragraphs and headings as well as block nesting', () => {
  let node: InlineNode = { type: 'text', text: 'hello' };
  for (let i = 0; i < 14; i += 1) {
    node = { type: i % 2 ? 'strong' : 'em', children: [node] };
  }
  expect(isPreviewDepthSafe([{ type: 'heading', depth: 1, children: [node] }])).toBe(true);
  node = { type: 'link', href: 'https://example.com/', children: [node] };
  expect(isPreviewDepthSafe([{ type: 'paragraph', children: [node] }])).toBe(false);
  expect(isPreviewDepthSafe([{ type: 'heading', depth: 1, children: [node] }])).toBe(false);
});

it('counts list-item containers and traverses all siblings without recursive calls', () => {
  let node: BlockNode = { type: 'paragraph', children: [{ type: 'text', text: 'hello' }] };
  for (let i = 0; i < 7; i += 1) {
    node = { type: 'list', ordered: false, start: 1, items: [[node]] };
  }
  expect(isPreviewDepthSafe([node])).toBe(true);
  node = { type: 'list', ordered: false, start: 1, items: [[node]] };
  expect(isPreviewDepthSafe([{ type: 'rule' }, node])).toBe(false);
  expect(
    isPreviewDepthSafe(
      Array.from({ length: 10000 }, () => ({
        type: 'paragraph',
        children: [{ type: 'text', text: 'text' }],
      }))
    )
  ).toBe(true);
});
