import React, { type ReactNode } from 'react';
// Node-only: preview and download must both call this renderer, never an HTML template.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Document,
  Font,
  Link,
  Page,
  renderToBuffer,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer';
import { Lexer, type Token } from 'marked';
import type { Resume } from './model';

const FAMILY = 'Kyu Classic Lato';
let fontsRegistered = false;

function registerFonts() {
  if (fontsRegistered) {return;}
  // Explicit local reads also let Next's output tracing discover the bundled assets.
  const source = (file: string) =>
    `data:font/ttf;base64,${readFileSync(join(process.cwd(), 'app/resumes/fonts', file)).toString('base64')}`;
  Font.register({
    family: FAMILY,
    fonts: [
      { src: source('Lato-Regular.ttf'), fontWeight: 400 },
      { src: source('Lato-Bold.ttf'), fontWeight: 700 },
      { src: source('Lato-Italic.ttf'), fontWeight: 400, fontStyle: 'italic' },
      { src: source('Lato-BoldItalic.ttf'), fontWeight: 700, fontStyle: 'italic' },
    ],
  });
  Font.registerHyphenationCallback(hyphenate);
  fontsRegistered = true;
}

// Keep normal words intact; permit emergency wrapping of URLs/identifiers rather
// than clipping them or shrinking the whole document. Segment on grapheme boundaries.
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
function hyphenate(word: string) {
  const letters = Array.from(graphemes.segment(word), (part) => part.segment);
  if (letters.length <= 24) {return [word];}
  const parts: string[] = [];
  for (let i = 0; i < letters.length; i += 12) {parts.push(letters.slice(i, i + 12).join(''));}
  return parts;
}

// Classic uses the pack's semantic ink, accent, surface, and rule colors, in print points.
const styles = StyleSheet.create({
  page: {
    paddingTop: 42,
    paddingBottom: 42,
    paddingHorizontal: 48,
    fontFamily: FAMILY,
    fontSize: 10.5,
    lineHeight: 1.45,
    color: '#272c28',
    backgroundColor: '#ffffff',
  },
  paragraph: { marginBottom: 7 },
  sectionTitle: { fontSize: 13, fontWeight: 700, marginTop: 12, marginBottom: 7 },
  heading: { fontWeight: 700, marginTop: 8, marginBottom: 6, lineHeight: 1.25 },
  strong: { fontWeight: 700 },
  emphasis: { fontStyle: 'italic' },
  link: { color: '#516c55', textDecoration: 'underline' },
  quote: { borderLeftWidth: 1, borderLeftColor: '#858f82', paddingLeft: 10, marginBottom: 7 },
  rule: { borderBottomWidth: 0.6, borderBottomColor: '#e5e8e1', marginVertical: 9 },
  code: { fontSize: 9.5, backgroundColor: '#f5f6f3' },
  codeBlock: { fontSize: 9.5, backgroundColor: '#f5f6f3', padding: 8, marginBottom: 7 },
  listItem: { flexDirection: 'row', marginBottom: 3 },
  marker: { width: 24, flexShrink: 0 },
  listBody: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
});

// Decode references as text only. Neither these strings nor raw Markdown ever enter HTML.
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
    if (!entity.startsWith('#')) {return named[entity.toLowerCase()] ?? whole;}
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
  if (/[\u0000-\u0020\u007f]/.test(decoded) || !/^(https?:\/\/|mailto:)/i.test(decoded))
    {return null;}
  try {
    const url = new URL(decoded);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export async function renderResumePdf(
  resume: Pick<Resume, 'name' | 'sections'>
): Promise<{ buffer: Buffer; warnings: string[] }> {
  registerFonts();
  // A fresh lexer avoids shared marked extensions/options changing this allowlist.
  const options = { gfm: true, breaks: false };
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
      `${label ?? `Markdown token “${token.type}”`} is not supported in Classic PDF; its source is displayed as text.`
    );
    return token.raw || ('text' in token ? String(token.text) : '');
  };

  function inline(tokens: Token[] = [], insideLink = false): ReactNode[] {
    return tokens.map((token, i) => {
      switch (token.type) {
        case 'text':
          return token.tokens ? inline(token.tokens, insideLink) : text(token.text);
        case 'escape':
          return token.text;
        case 'strong':
          return (
            <Text key={i} style={styles.strong}>
              {inline(token.tokens, insideLink)}
            </Text>
          );
        case 'em':
          return (
            <Text key={i} style={styles.emphasis}>
              {inline(token.tokens, insideLink)}
            </Text>
          );
        case 'codespan':
          return (
            <Text key={i} style={styles.code}>
              {token.text}
            </Text>
          );
        case 'br':
          return '\n';
        case 'link': {
          const href = safeHref(token.href);
          if (!href) {
            warnings.add(
              'An unsafe or unsupported link destination was disabled; its Markdown source is displayed as text.'
            );
            return token.raw;
          }
          if (insideLink) {return inline(token.tokens, true);}
          return (
            <Link key={i} src={href} style={styles.link}>
              {inline(token.tokens, true)}
            </Link>
          );
        }
        default:
          return unsupported(token);
      }
    });
  }

  function blocks(tokens: Token[] = []): ReactNode[] {
    return tokens.map((token, i) => {
      switch (token.type) {
        case 'space':
        case 'def':
          return null;
        case 'heading':
          return (
            <Text
              key={i}
              minPresenceAhead={24}
              style={[styles.heading, { fontSize: [22, 15, 12, 11, 10.5, 10.5][token.depth - 1] }]}
            >
              {inline(token.tokens)}
            </Text>
          );
        case 'paragraph':
        case 'text':
          return (
            <Text key={i} style={styles.paragraph}>
              {token.tokens ? inline(token.tokens) : text(token.text)}
            </Text>
          );
        case 'blockquote':
          return (
            <View key={i} style={styles.quote}>
              {blocks(token.tokens)}
            </View>
          );
        case 'hr':
          return <View key={i} style={styles.rule} />;
        case 'code':
          // Keep code literal, without syntax highlighting or external resources.
          return (
            <Text key={i} style={styles.codeBlock}>
              {token.text}
            </Text>
          );
        case 'list':
          return (
            <View key={i}>
              {(token.items as import('marked').Tokens.ListItem[]).map((item, index) => {
                if (item.task)
                  {return (
                    <Text key={index} style={styles.paragraph}>
                      {unsupported({ ...item, type: 'checkbox' })}
                    </Text>
                  );}
                return (
                  <View key={index} style={styles.listItem}>
                    <Text style={styles.marker}>
                      {token.ordered ? `${Number(token.start) + index}.` : '•'}
                    </Text>
                    <View style={styles.listBody}>{blocks(item.tokens)}</View>
                  </View>
                );
              })}
            </View>
          );
        default:
          return (
            <Text key={i} style={styles.paragraph}>
              {unsupported(token)}
            </Text>
          );
      }
    });
  }

  const content = resume.sections.map((section) => (
    <View key={section.id}>
      {section.titleMarkdown.trim() && (
        <Text style={styles.sectionTitle} minPresenceAhead={24}>
          {inline(new Lexer(options).inlineTokens(section.titleMarkdown))}
        </Text>
      )}
      {blocks(new Lexer(options).lex(section.contentMarkdown))}
    </View>
  ));
  const buffer = await renderToBuffer(
    <Document title={resume.name} creator="Kyu" language="en">
      <Page size="LETTER" wrap style={styles.page}>
        {content}
      </Page>
    </Document>
  );
  return { buffer, warnings: [...warnings] };
}
