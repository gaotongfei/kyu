import { createElement, type CSSProperties, type ReactNode } from 'react';
import { CLASSIC_THEME as theme, classicListMarkerWidth } from './classic-theme';
import type { BlockNode, InlineNode, parseResumeMarkdown } from './resume-markdown';

const pt = (value: number) => `${value}pt`;
const paragraphStyle: CSSProperties = { margin: `0 0 ${pt(theme.paragraphGap)}` };

function inline(nodes: InlineNode[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return node.text;
      case 'strong':
        return (
          <strong key={index} style={{ fontWeight: 700 }}>
            {inline(node.children)}
          </strong>
        );
      case 'em':
        return <em key={index}>{inline(node.children)}</em>;
      case 'code':
        return (
          <code
            key={index}
            style={{
              fontFamily: 'inherit',
              fontSize: pt(theme.codeSize),
              backgroundColor: theme.surface,
            }}
          >
            {node.text}
          </code>
        );
      case 'link':
        return (
          <a
            key={index}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            style={{ color: theme.accent, textDecoration: 'underline' }}
          >
            {inline(node.children)}
          </a>
        );
      case 'break':
        return <br key={index} />;
      default:
        throw new Error('Unsupported Classic inline node.');
    }
  });
}

function blocks(nodes: BlockNode[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'paragraph':
        return (
          <p
            key={index}
            style={{ ...paragraphStyle, whiteSpace: node.literal ? 'pre-wrap' : 'normal' }}
          >
            {inline(node.children)}
          </p>
        );
      case 'heading':
        return createElement(
          `h${node.depth}`,
          {
            key: index,
            style: {
              fontSize: pt(theme.headingSizes[node.depth - 1]),
              fontWeight: 700,
              lineHeight: theme.headingLineHeight,
              textAlign: node.depth === 1 ? 'center' : 'left',
              letterSpacing: pt(node.depth === 1 ? theme.titleLetterSpacing : 0),
              borderBottom: `${pt(theme.headingRuleWidth)} solid ${theme.headingRuleColor}`,
              paddingBottom: pt(theme.headingPaddingBottom),
              margin: `${pt(theme.headingBefore)} 0 ${pt(theme.headingAfter)}`,
            },
          },
          inline(node.children)
        );
      case 'quote':
        return (
          <blockquote
            key={index}
            style={{
              margin: `0 0 ${pt(theme.paragraphGap)}`,
              borderLeft: `1pt solid ${theme.controlBorder}`,
              paddingLeft: pt(theme.quoteInset),
            }}
          >
            {blocks(node.children)}
          </blockquote>
        );
      case 'rule':
        return (
          <hr
            key={index}
            style={{
              border: 0,
              borderBottom: `${pt(theme.ruleWidth)} solid ${theme.border}`,
              margin: `${pt(theme.ruleGap)} 0`,
            }}
          />
        );
      case 'code':
        return (
          <pre
            key={index}
            style={{
              ...paragraphStyle,
              fontFamily: 'inherit',
              fontSize: pt(theme.codeSize),
              backgroundColor: theme.surface,
              padding: pt(theme.codePadding),
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
            }}
          >
            <code style={{ font: 'inherit' }}>{node.text}</code>
          </pre>
        );
      case 'list': {
        const items = node.items.map((item, itemIndex) => (
          <li key={itemIndex} style={{ marginBottom: pt(theme.listItemGap) }}>
            {blocks(item)}
          </li>
        ));
        const style: CSSProperties = {
          margin: `0 0 ${pt(theme.paragraphGap)}`,
          paddingLeft: pt(
            classicListMarkerWidth(node.ordered ? node.start + node.items.length - 1 : undefined)
          ),
          listStyleType: node.ordered ? 'decimal' : 'disc',
        };
        return node.ordered ? (
          <ol key={index} start={node.start} style={style}>
            {items}
          </ol>
        ) : (
          <ul key={index} style={style}>
            {items}
          </ul>
        );
      }
      default:
        throw new Error('Unsupported Classic block node.');
    }
  });
}

export const classicDocumentStyle: CSSProperties = {
  fontSize: pt(theme.fontSize),
  lineHeight: theme.lineHeight,
  fontWeight: 400,
  color: theme.ink,
  backgroundColor: theme.paper,
  paddingTop: `${(theme.paddingTop / theme.pageWidth) * 100}%`,
  paddingBottom: `${(theme.paddingBottom / theme.pageWidth) * 100}%`,
  paddingInline: `${(theme.paddingHorizontal / theme.pageWidth) * 100}%`,
};

export function MarkdownContent({ parsed }: { parsed: ReturnType<typeof parseResumeMarkdown> }) {
  return blocks(parsed.blocks);
}
