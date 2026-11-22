/**
 * Street cross-section templates (docs/urbanos/CROSS_SECTIONS.md). SCREENING templates: a starting cross-section for a
 * sketch, never a design, a compliance statement or an approval.
 *
 * Every width below was read from the source by code only (user rule: PDFs are read by pdftotext; OCR only where a page
 * has no text layer):
 *  - USDG templates: Pune Municipal Corporation, *Urban Street Design Guidelines, Pune*, Version I: 2016, ch. 8
 *    "USDG Reference Templates". The template pages are 150 ppi raster drawings with no text layer, so their dimension
 *    strings were read by OCR (pdfimages → upscale → tesseract, several passes voted) and each template was accepted only
 *    when its widths add up to the RoW printed in its title. They are labelled "OCR of a drawing — verify against the
 *    drawing before use" (`widthsRead`).
 *  - IRC:86-2018 has NO street templates: its Table 5.3 refers to "Annexure 2: Street Design Templates", but the code has
 *    only Annexures I and II (grade-separated NMT; superelevation). IRC values are used by the checks (checks.ts), not here.
 */

export type XsElementKind = 'footpath' | 'furniture' | 'cycle_track' | 'buffer' | 'parking' | 'carriageway' | 'median';

export interface XsElement {
  kind: XsElementKind;
  /** Width across the street (m). */
  widthM: number;
  /** The source's own label for the strip, e.g. "Tree pits / street furniture / bus stop". */
  label: string;
  /** Carriageway only: lanes and the traffic direction relative to the drawn line. */
  lanes?: number;
  direction?: 'forward' | 'backward' | 'both';
}

export interface SourceRef {
  /** Short key (see SOURCES). */
  key: keyof typeof SOURCES;
  /** Clause / chapter / table. */
  section: string;
  /** Page number printed on the page. */
  printedPage: number;
  /** Page number in the PDF file. */
  pdfPage: number;
}

export const SOURCES = {
  USDG: {
    title: 'Urban Street Design Guidelines, Pune — Pune Municipal Corporation, Version I: 2016',
    url: 'https://pmc.gov.in/sites/default/files/road_img/USDG_Final_July2016.pdf',
    status: 'official (PMC)',
    note: 'The pmc.gov.in link now redirects to the new PMC site. Text read from the copy at itdp.in/wp-content/uploads/2016/07/Urban-street-design-guidelines.pdf (sha256 2f0df4a0…889a, 130 pages), which has the same size (17,708,161 bytes) and the same first 1 MB as the pmc.gov.in file captured by the Internet Archive on 2021-03-05.',
  },
  IRC86: {
    title: 'IRC:86-2018 Geometric Design Standards for Urban Roads and Streets (1st revision, Nov 2018)',
    url: 'https://law.resource.org/pub/in/bis/irc/irc.gov.in.086.2018.pdf',
    status: 'IRC text, third-party copy — unconfirmed against an IRC-issued copy',
    note: 'IRC sells the code and hosts no free copy; read from the Public.Resource.Org mirror.',
  },
} as const;

export const sourceLabel = (s: SourceRef) => `${s.key === 'USDG' ? 'Pune USDG 2016' : 'IRC:86-2018'} ${s.section}, p. ${s.printedPage} (PDF p. ${s.pdfPage}) — ${SOURCES[s.key].status}`;

export interface CrossSectionTemplate {
  id: string;
  /** The source's template code, e.g. "18A". */
  code: string;
  name: string;
  rowM: number;
  /** "Recommended for …" line of the template page (OCR, text). */
  use: string;
  /** Elements from the left edge of the right-of-way to the right edge, looking along the drawn line. */
  elements: XsElement[];
  divided: boolean;
  /** Road class UrbanOS suggests for it — an UrbanOS mapping, NOT stated by the source. */
  suggestedClass: 'arterial' | 'collector' | 'local';
  source: SourceRef;
  /** How the widths were read. */
  widthsRead: string;
}

const OCR_NOTE = 'Widths read by OCR from a raster drawing (no text layer); they add up to the RoW in the title. Verify against the drawing before use.';

const fp = (w: number, label = 'Clear walkway'): XsElement => ({ kind: 'footpath', widthM: w, label });
const mz = (w: number, label: string): XsElement => ({ kind: 'furniture', widthM: w, label });
const ct = (w: number): XsElement => ({ kind: 'cycle_track', widthM: w, label: 'Cycle track' });
const bf = (w: number): XsElement => ({ kind: 'buffer', widthM: w, label: 'Buffer' });
const pk = (w: number, label = 'Parking'): XsElement => ({ kind: 'parking', widthM: w, label });
const cw = (w: number, lanes: number, direction: XsElement['direction']): XsElement => ({ kind: 'carriageway', widthM: w, lanes, direction, label: `Carriageway, ${lanes} lane${lanes > 1 ? 's' : ''}` });
const md = (w: number, label = 'Centre verge'): XsElement => ({ kind: 'median', widthM: w, label });

/** USDG ch. 8 templates; printed page = PDF page − 21. "A" variants only (the B–E variants differ in parking / BRT). */
export const CROSS_SECTION_TEMPLATES: readonly CrossSectionTemplate[] = [
  {
    id: 'usdg-12a', code: '12A', name: 'USDG 12A — 12 m RoW, two-way undivided', rowM: 12,
    use: 'Recommended for through traffic in a residential or mixed land-use area.',
    elements: [fp(2), mz(1, 'Tree pit / furniture / bus stop / auto stand'), cw(6, 2, 'both'), mz(1, 'Tree pit / furniture / bus stop / auto stand'), fp(2)],
    divided: false, suggestedClass: 'collector',
    source: { key: 'USDG', section: 'ch. 8 template 12A "12 m right of way – A"', printedPage: 55, pdfPage: 76 }, widthsRead: OCR_NOTE,
  },
  {
    id: 'usdg-18a', code: '18A', name: 'USDG 18A — 18 m RoW, two-way undivided, cycle track one side', rowM: 18,
    use: 'Recommended for streets alongside educational institutes, schools, colleges and with through traffic.',
    elements: [fp(2.5), mz(1, 'Tree pit / furniture'), ct(2.5), bf(0.5), cw(6.5, 2, 'both'), pk(2, 'Bus stop / parking / tree pit'), fp(3)],
    divided: false, suggestedClass: 'collector',
    source: { key: 'USDG', section: 'ch. 8 template 18A "18 m right of way – A"', printedPage: 64, pdfPage: 85 }, widthsRead: OCR_NOTE,
  },
  {
    id: 'usdg-24a', code: '24A', name: 'USDG 24A — 24 m RoW, 2+2 lanes divided, cycle tracks', rowM: 24,
    use: 'Recommended for streets with heavy through traffic, such as mobility corridors.',
    elements: [fp(2.5), mz(1, 'Tree pits / furniture'), ct(2), bf(0.5), cw(5.5, 2, 'forward'), md(1), cw(5.5, 2, 'backward'), mz(1.5, 'Bus stop / tree pits / furniture'), ct(2), fp(2.5)],
    divided: true, suggestedClass: 'arterial',
    source: { key: 'USDG', section: 'ch. 8 template 24A "24 m right of way – A"', printedPage: 73, pdfPage: 94 }, widthsRead: OCR_NOTE,
  },
  {
    id: 'usdg-30a', code: '30A', name: 'USDG 30A — 30 m RoW, 2+2 lanes divided, cycle tracks, parking', rowM: 30,
    use: 'Recommended for streets with heavy through traffic.',
    elements: [fp(4), ct(2), bf(0.5), pk(2, 'Parking / tree pit / furniture'), cw(6, 2, 'forward'), md(1), cw(6, 2, 'backward'), mz(2.5, 'Bus stop / tree pit / furniture'), ct(2), fp(4)],
    divided: true, suggestedClass: 'arterial',
    source: { key: 'USDG', section: 'ch. 8 template 30A "30 m right of way – A"', printedPage: 78, pdfPage: 99 }, widthsRead: OCR_NOTE,
  },
  {
    id: 'usdg-36a', code: '36A', name: 'USDG 36A — 36 m RoW, 2+2 lanes divided, cycle tracks, parking', rowM: 36,
    use: 'Recommended for streets with through traffic.',
    elements: [fp(3.5), mz(2, 'Tree pits / street vending'), ct(2.5), bf(1.5), pk(2), cw(6, 2, 'forward'), md(1), cw(6, 2, 'backward'), mz(3.5, 'Bus stop / tree pits'), ct(2.5), mz(2, 'Tree pits / furniture'), fp(3.5)],
    divided: true, suggestedClass: 'arterial',
    source: { key: 'USDG', section: 'ch. 8 template 36A "36 m right of way – A"', printedPage: 82, pdfPage: 103 }, widthsRead: OCR_NOTE,
  },
];

/** USDG §8 intro (p. 48, PDF p. 69): a RoW between templates uses the next SMALLER template; the rest goes to NMT space. */
export const USDG_IN_BETWEEN_RULE = {
  text: 'For a RoW not in the templates, use the template of the next smaller RoW and give the remaining width to footpath / cycle track / MUZ (e.g. 20 m → 18 m template + 2 m NMT).',
  source: { key: 'USDG', section: 'ch. 8 introduction', printedPage: 48, pdfPage: 69 } as SourceRef,
};

export const templateById = (id: string | null | undefined) => CROSS_SECTION_TEMPLATES.find(t => t.id === id);

/** The template USDG says to use for an available RoW (next smaller or equal); undefined below the smallest. */
export function templateForRow(rowM: number): CrossSectionTemplate | undefined {
  let best: CrossSectionTemplate | undefined;
  for (const t of CROSS_SECTION_TEMPLATES) if (t.rowM <= rowM + 1e-6 && (!best || t.rowM > best.rowM)) best = t;
  return best;
}

export const elementsTotalM = (els: readonly XsElement[]) => Math.round(els.reduce((n, e) => n + e.widthM, 0) * 100) / 100;
