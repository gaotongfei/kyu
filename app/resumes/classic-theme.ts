// Classic document geometry and typography use print points in every adapter.
// Browser adapters convert points to CSS units; UI canvas/control themes are separate.
export const CLASSIC_THEME = {
  fontSize: 10.5,
  lineHeight: 1.3,
  ink: '#272c28',
  paper: '#ffffff',
  accent: '#516c55',
  surface: '#f5f6f3',
  controlBorder: '#858f82',
  border: '#e5e8e1',
  pageWidth: 612,
  pageHeight: 792,
  paddingTop: 42,
  paddingBottom: 42,
  paddingHorizontal: 48,
  paragraphGap: 4,
  headingSizes: [24, 12, 11, 10.5, 10.5, 10.5],
  headingBefore: 10,
  headingAfter: 4,
  headingLineHeight: 1.25,
  headingPaddingBottom: 2,
  headingRuleWidth: 0.6,
  headingRuleColor: '#858f82',
  titleLetterSpacing: 2.4,
  quoteInset: 10,
  ruleWidth: 0.6,
  ruleGap: 9,
  codeSize: 9.5,
  codePadding: 8,
  listItemGap: 1.5,
  listMarkerWidth: 15.75,
} as const;

export function classicListMarkerWidth(lastOrdinal?: number) {
  const extraDigits = lastOrdinal === undefined ? 0 : Math.max(0, String(lastOrdinal).length - 1);
  return CLASSIC_THEME.listMarkerWidth + extraDigits * CLASSIC_THEME.fontSize * 0.6;
}
