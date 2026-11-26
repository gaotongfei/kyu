import { Lexer, type Token, type Tokens } from 'marked';

export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'strong' | 'em'; children: InlineNode[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: InlineNode[] }
  | { type: 'break' };

export type BlockNode =
  | { type: 'paragraph'; children: InlineNode[]; literal?: boolean }
  | { type: 'heading'; depth: number; children: InlineNode[] }
  | { type: 'quote'; children: BlockNode[] }
  | { type: 'rule' }
  | { type: 'code'; text: string }
  | { type: 'list'; ordered: boolean; start: number; items: BlockNode[][] };

// This module is universal: adapters receive only safe nodes, never marked tokens or HTML.
// Decode references as text only. Renderers must use text nodes, not HTML injection.
function text(value: string) {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: '\u00a0',
    copy: '©',
    reg: '®',
    hellip: '…',
    ndash: '–',
    mdash: '—',
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (!entity.startsWith('#')) {
      const name = entity.toLowerCase();
      return Object.hasOwn(named, name) ? named[name] : whole;
    }
    const point =
      entity[1].toLowerCase() === 'x'
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point)
      : '�';
  });
}

function safeHref(href: string): string | null {
  const decoded = text(href);
  const hasControls = Array.from(decoded).some(
    (character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127
  );
  if (hasControls || !/^(https?:\/\/|mailto:)/i.test(decoded)) {
    return null;
  }
  try {
    const url = new URL(decoded);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function parseResumeMarkdown(contentMarkdown: string): {
  blocks: BlockNode[];
  warnings: string[];
} {
  const warnings = new Set<string>();
  const unsupported = (token: Token) => {
    const label = {
      html: 'Raw HTML',
      image: 'Images',
      table: 'Tables',
      del: 'Strikethrough',
      checkbox: 'Task lists',
    }[token.type];
    warnings.add(
      `${label ?? `Markdown token “${token.type}”`}: unsupported in Classic; its source is displayed as text.`
    );
    return token.raw || ('text' in token ? String(token.text) : '');
  };
  const literal = (token: Token): BlockNode => ({
    type: 'paragraph',
    literal: true,
    children: [{ type: 'text', text: unsupported(token) }],
  });

  function inline(tokens: Token[] = [], insideLink = false): InlineNode[] {
    return tokens.flatMap((token): InlineNode[] => {
      switch (token.type) {
        case 'text':
          return token.tokens
            ? inline(token.tokens, insideLink)
            : [{ type: 'text', text: text(token.text).replace(/\n/g, ' ') }];
        case 'escape':
          return [{ type: 'text', text: token.text }];
        case 'strong':
        case 'em':
          return [{ type: token.type, children: inline(token.tokens, insideLink) }];
        case 'codespan':
          return [{ type: 'code', text: token.text }];
        case 'br':
          return [{ type: 'break' }];
        case 'link': {
          const href = safeHref(token.href);
          if (!href) {
            warnings.add(
              'An unsafe or unsupported link destination was disabled; its Markdown source is displayed as text.'
            );
            return [{ type: 'text', text: token.raw }];
          }
          const children = inline(token.tokens, true);
          return insideLink ? children : [{ type: 'link', href, children }];
        }
        default:
          return [{ type: 'text', text: unsupported(token) }];
      }
    });
  }

  function blocks(tokens: Token[] = []): BlockNode[] {
    return tokens.flatMap((token): BlockNode[] => {
      switch (token.type) {
        case 'space':
        case 'def':
          return [];
        case 'heading':
          return [{ type: 'heading', depth: token.depth, children: inline(token.tokens) }];
        case 'paragraph':
        case 'text':
          return [
            {
              type: 'paragraph',
              children: token.tokens
                ? inline(token.tokens)
                : [{ type: 'text', text: text(token.text).replace(/\n/g, ' ') }],
            },
          ];
        case 'blockquote':
          return [{ type: 'quote', children: blocks(token.tokens) }];
        case 'hr':
          return [{ type: 'rule' }];
        case 'code':
          return [{ type: 'code', text: token.text }];
        case 'list': {
          const nodes: BlockNode[] = [];
          let list: Extract<BlockNode, { type: 'list' }> | undefined;
          (token.items as Tokens.ListItem[]).forEach((item, index) => {
            if (item.task) {
              // Preserve each task item's entire source, without rendering its nested
              // Markdown. Split supported list runs so adapters need no task-list logic;
              // ordered runs after a literal item retain their original numbering.
              nodes.push(literal({ ...item, type: 'checkbox' }));
              list = undefined;
              return;
            }
            if (!list) {
              list = {
                type: 'list',
                ordered: token.ordered,
                start: token.ordered ? Number(token.start) + index : 1,
                items: [],
              };
              nodes.push(list);
            }
            list.items.push(blocks(item.tokens));
          });
          return nodes;
        }
        default:
          return [literal(token)];
      }
    });
  }

  // Fresh options/tokenizers avoid global marked extensions and cross-document state.
  // One whole-source lex resolves forward references; the first definition wins.
  // A null-prototype map also permits names such as “constructor” and “__proto__”.
  const lexer = new Lexer({ gfm: true, breaks: false });
  lexer.tokens.links = Object.create(null);
  const parsedBlocks = blocks(lexer.lex(contentMarkdown));
  return { blocks: parsedBlocks, warnings: [...warnings] };
}
