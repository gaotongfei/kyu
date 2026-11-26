import React, { type ReactNode } from 'react';
// Node-only PDF export adapter; the live HTML preview shares its safe AST and theme.
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
import { CLASSIC_THEME, classicListMarkerWidth } from './classic-theme';
import type { Resume } from './model';
import { parseResumeMarkdown, type BlockNode, type InlineNode } from './resume-markdown';

// Renderer-only alias for the unmodified Lato faces, not a custom-designed font.
// Attribution and license: fonts/OFL.txt.
const FAMILY = 'Kyu Classic Lato';
let fontsRegistered = false;

function registerFonts() {
  if (fontsRegistered) {
    return;
  }
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
  // Replace React PDF's default English-pattern hyphenation with our overflow policy.
  Font.registerHyphenationCallback((word) => hyphenate(word, 24));
  fontsRegistered = true;
}

// Graphemes keep combining accents and joined emoji together; 'en' does not limit
// input to English. This is character segmentation, not language-specific syllables.
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

// Overflow heuristic (kyu-resume-editor SPEC.md), not dictionary hyphenation:
// keep body tokens of <=24 graphemes whole; longer tokens offer breaks every 12.
// React PDF chooses breaks to fit the line and can add a visible hyphen.
// This is not Chinese/Japanese line-breaking support; Lato also lacks CJK glyphs.
function hyphenate(word: string, unbrokenLimit: number) {
  const letters = Array.from(graphemes.segment(word), (part) => part.segment);
  if (letters.length <= unbrokenLimit) {
    return [word];
  }
  const parts: string[] = [];
  for (let i = 0; i < letters.length; i += 12) {
    parts.push(letters.slice(i, i + 12).join(''));
  }
  return parts;
}

const hyphenateHeading = (word: string) => hyphenate(word, 12);

// Classic uses the pack's semantic ink, accent, surface, and rule colors, in print points.
const styles = StyleSheet.create({
  page: {
    paddingTop: CLASSIC_THEME.paddingTop,
    paddingBottom: CLASSIC_THEME.paddingBottom,
    paddingHorizontal: CLASSIC_THEME.paddingHorizontal,
    fontFamily: FAMILY,
    fontSize: CLASSIC_THEME.fontSize,
    lineHeight: CLASSIC_THEME.lineHeight,
    color: CLASSIC_THEME.ink,
    backgroundColor: CLASSIC_THEME.paper,
  },
  paragraph: { marginBottom: CLASSIC_THEME.paragraphGap },
  heading: {
    fontWeight: 700,
    marginTop: CLASSIC_THEME.headingBefore,
    marginBottom: CLASSIC_THEME.headingAfter,
    lineHeight: CLASSIC_THEME.headingLineHeight,
    borderBottomWidth: CLASSIC_THEME.headingRuleWidth,
    borderBottomColor: CLASSIC_THEME.headingRuleColor,
    paddingBottom: CLASSIC_THEME.headingPaddingBottom,
  },
  strong: { fontWeight: 700 },
  emphasis: { fontStyle: 'italic' },
  link: { color: CLASSIC_THEME.accent, textDecoration: 'underline' },
  quote: {
    borderLeftWidth: 1,
    borderLeftColor: CLASSIC_THEME.controlBorder,
    paddingLeft: CLASSIC_THEME.quoteInset,
    marginBottom: CLASSIC_THEME.paragraphGap,
  },
  rule: {
    borderBottomWidth: CLASSIC_THEME.ruleWidth,
    borderBottomColor: CLASSIC_THEME.border,
    marginVertical: CLASSIC_THEME.ruleGap,
  },
  code: { fontSize: CLASSIC_THEME.codeSize, backgroundColor: CLASSIC_THEME.surface },
  codeBlock: {
    fontSize: CLASSIC_THEME.codeSize,
    backgroundColor: CLASSIC_THEME.surface,
    padding: CLASSIC_THEME.codePadding,
    marginBottom: CLASSIC_THEME.paragraphGap,
  },
  list: { marginBottom: CLASSIC_THEME.paragraphGap },
  listItem: { flexDirection: 'row', marginBottom: CLASSIC_THEME.listItemGap },
  marker: { flexShrink: 0 },
  listBody: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
});

function inline(nodes: InlineNode[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
        return node.text;
      case 'strong':
        return (
          <Text key={i} style={styles.strong}>
            {inline(node.children)}
          </Text>
        );
      case 'em':
        return (
          <Text key={i} style={styles.emphasis}>
            {inline(node.children)}
          </Text>
        );
      case 'code':
        return (
          <Text key={i} style={styles.code}>
            {node.text}
          </Text>
        );
      case 'break':
        return '\n';
      case 'link':
        return (
          <Link key={i} src={node.href} style={styles.link}>
            {inline(node.children)}
          </Link>
        );
      default:
        throw new Error('Unsupported Classic inline node.');
    }
  });
}

function blocks(nodes: BlockNode[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'heading':
        return (
          <Text
            key={i}
            minPresenceAhead={24}
            hyphenationCallback={hyphenateHeading}
            style={[
              styles.heading,
              {
                fontSize: CLASSIC_THEME.headingSizes[node.depth - 1],
                textAlign: node.depth === 1 ? 'center' : 'left',
                letterSpacing: node.depth === 1 ? CLASSIC_THEME.titleLetterSpacing : 0,
              },
            ]}
          >
            {inline(node.children)}
          </Text>
        );
      case 'paragraph':
        return (
          <Text key={i} style={styles.paragraph}>
            {inline(node.children)}
          </Text>
        );
      case 'quote':
        return (
          <View key={i} style={styles.quote}>
            {blocks(node.children)}
          </View>
        );
      case 'rule':
        return <View key={i} style={styles.rule} />;
      case 'code':
        // Keep code literal, without syntax highlighting or external resources.
        return (
          <Text key={i} style={styles.codeBlock}>
            {node.text}
          </Text>
        );
      case 'list': {
        const markerWidth = classicListMarkerWidth(
          node.ordered ? node.start + node.items.length - 1 : undefined
        );
        return (
          <View key={i} style={styles.list}>
            {node.items.map((item, index) => (
              <View key={index} style={styles.listItem}>
                <Text style={[styles.marker, { width: markerWidth }]}>
                  {node.ordered ? `${node.start + index}.` : '•'}
                </Text>
                <View style={styles.listBody}>{blocks(item)}</View>
              </View>
            ))}
          </View>
        );
      }
      default:
        throw new Error('Unsupported Classic block node.');
    }
  });
}

export async function renderResumePdf(
  resume: Pick<Resume, 'name' | 'contentMarkdown'>
): Promise<{ buffer: Buffer; warnings: string[] }> {
  registerFonts();
  const parsed = parseResumeMarkdown(resume.contentMarkdown);
  const buffer = await renderToBuffer(
    <Document title={resume.name} creator="Kyu" language="en">
      <Page size={[CLASSIC_THEME.pageWidth, CLASSIC_THEME.pageHeight]} wrap style={styles.page}>
        {blocks(parsed.blocks)}
      </Page>
    </Document>
  );
  return { buffer, warnings: parsed.warnings };
}
