import { AiSummaryResult, PhotoOcrResult } from '../types/pdfStudio';

export type LocalOcrMode =
  | 'verbatim'
  | 'structured'
  | 'clean-paragraphs'
  | 'bilingual-hin-eng';

const HINGLISH_STRONG_MARKERS = new Set([
  'kya',
  'kaun',
  'kitna',
  'kitne',
  'kitni',
  'kab',
  'kaise',
  'kahan',
  'kyu',
  'kyon',
  'batao',
  'bataiye',
  'samjhao',
  'hai',
  'hain',
  'aur',
  'mein',
  'isme',
  'iska',
  'iske',
  'iski',
  'kaunsa',
  'kaunse',
  'kaunsi',
  'chahiye',
  'dekho',
  'nikalo',
  'padhke',
  'sara',
  'poora',
  'sabhi',
  'mujhe',
  'humko',
  'likha',
  'point',
  'points',
]);

const HINGLISH_LIGHT_CONNECTORS = new Set([
  'me',
  'ka',
  'ki',
  'ke',
  'se',
  'ko',
  'par',
  'pe',
  'ye',
  'yeh',
  'wo',
  'woh',
  'bhi',
  'tak',
]);

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'are',
  'was',
  'were',
  'what',
  'which',
  'when',
  'where',
  'who',
  'how',
  'why',
  'can',
  'you',
  'please',
  'tell',
  'give',
  'show',
  'explain',
  'about',
  'into',
  'across',
  'all',
  'any',
  'does',
  'have',
  'has',
  'had',
  'pdf',
  'document',
  'file',
  'page',
  'pages',
  'kya',
  'hai',
  'hain',
  'aur',
  'me',
  'mein',
  'isme',
  'iska',
  'iske',
  'iski',
  'ka',
  'ki',
  'ke',
  'se',
  'ko',
  'batao',
  'bataiye',
  'samjhao',
  'ye',
  'yeh',
  'wo',
  'woh',
  'is',
  'iss',
  'us',
  'uss',
  'ek',
  'bhi',
]);

const BILINGUAL_SYNONYMS: Record<string, string[]> = {
  budget: ['budget', 'allocation', 'cost', 'usd', 'amount', 'spend', 'price', 'total', 'financial', 'capex', 'opex'],
  kharcha: ['budget', 'allocation', 'cost', 'usd', 'amount', 'spend', 'price', 'total'],
  paisa: ['budget', 'cost', 'usd', 'amount', 'price', 'total', 'fee', 'invoice'],
  amount: ['amount', 'total', 'due', 'usd', 'budget', 'allocation', 'cost', 'invoice'],
  total: ['total', 'sum', 'budget', 'allocation', 'amount', 'due', 'overall'],
  kitna: ['total', 'amount', 'budget', 'cost', 'allocation', 'target', 'percent', 'sla', 'latency'],
  deadline: ['deadline', 'deadlines', 'date', 'target', 'timeline', 'schedule', 'milestone', 'horizon', 'q1', 'q2', 'q3', 'q4'],
  deadlines: ['deadline', 'deadlines', 'date', 'target', 'timeline', 'schedule', 'milestone', 'horizon', 'q1', 'q2', 'q3', 'q4'],
  tarikh: ['date', 'deadline', 'timeline', 'schedule', 'target', 'due'],
  kab: ['date', 'deadline', 'timeline', 'schedule', 'target', 'quarter', 'due'],
  security: ['security', 'zero-trust', 'encryption', 'aes', 'tls', 'compliance', 'iso', 'soc', 'audit', 'access', 'control', 'controls', 'key', 'auth'],
  suraksha: ['security', 'zero-trust', 'encryption', 'compliance', 'audit', 'access', 'control'],
  rules: ['rules', 'rule', 'policy', 'policies', 'compliance', 'controls', 'mandates', 'governance', 'must', 'required', 'standard'],
  rule: ['rules', 'rule', 'policy', 'compliance', 'controls', 'governance', 'must', 'required'],
  niyam: ['rules', 'policy', 'compliance', 'controls', 'governance', 'must'],
  sla: ['sla', 'availability', 'uptime', 'latency', 'objective', 'objectives', 'target', '99.9'],
  invoice: ['invoice', 'bill', 'due', 'amount', 'subtotal', 'tax', 'vendor', 'payment'],
};

export function detectQueryLanguage(query: string): 'english' | 'hinglish' | 'hindi' {
  if (/[\u0900-\u097F]/.test(query)) {
    return 'hindi';
  }
  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  let strongHits = 0;
  let lightHits = 0;
  for (const t of tokens) {
    if (HINGLISH_STRONG_MARKERS.has(t)) strongHits++;
    if (HINGLISH_LIGHT_CONNECTORS.has(t)) lightHits++;
  }
  if (strongHits >= 1 && (strongHits + lightHits >= 2 || tokens.length <= 5)) {
    return 'hinglish';
  }
  if (lightHits >= 2 && strongHits >= 1) {
    return 'hinglish';
  }
  return 'english';
}

function tokenizeQueryWithSynonyms(query: string): {
  coreTerms: string[];
  expandedTerms: string[];
  asksNumeric: boolean;
  asksOverview: boolean;
  explicitPage: number | null;
} {
  const lower = query.toLowerCase();
  const explicitPageMatch =
    lower.match(/\b(?:page|pg|p\.?)\s*(\d{1,4})\b/) ||
    lower.match(/\b(\d{1,4})\s*page\b/);
  const explicitPage = explicitPageMatch ? Number(explicitPageMatch[1]) : null;

  const rawTokens = lower
    .replace(/[^\p{L}\p{N}$₹%-]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);

  const coreTerms = rawTokens.filter((w) => !STOPWORDS.has(w));
  const expandedSet = new Set<string>(coreTerms);

  for (const token of rawTokens) {
    const mapped = BILINGUAL_SYNONYMS[token];
    if (mapped) {
      mapped.forEach((syn) => expandedSet.add(syn));
    }
  }

  const asksNumeric =
    /\b(total|budget|cost|amount|price|how much|kitna|kitne|sum|allocation|sla|latency|target|due|invoice|fee|revenue)\b/i.test(
      query
    );

  const asksOverview =
    /\b(summarize|summary|overview|key details|main points|explain|what is this|saransh|poora|all points|key points)\b/i.test(
      query
    ) && coreTerms.length <= 5;

  return {
    coreTerms,
    expandedTerms: Array.from(expandedSet),
    asksNumeric,
    asksOverview,
    explicitPage,
  };
}

interface CandidatePassage {
  pageNumber: number;
  text: string;
  isAttachedPhoto?: boolean;
  score: number;
}

function splitPageIntoPassages(pageText: string): string[] {
  const normalized = pageText.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const rawLines = normalized
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 3 && !/^page\s+\d+(\s+of\s+\d+)?$/i.test(l));

  const passages: string[] = [];
  let buffer = '';

  for (const line of rawLines) {
    const looksStandalone =
      /^[-•*▪]\s+/.test(line) ||
      /^\d+[.)]\s+/.test(line) ||
      /[$₹€£]\s*\d/.test(line) ||
      /\b\d+(?:\.\d+)?%/.test(line) ||
      (line.includes(':') && line.length < 130);

    if (looksStandalone) {
      if (buffer) {
        passages.push(buffer.trim());
        buffer = '';
      }
      passages.push(line);
      continue;
    }

    if (!buffer) {
      buffer = line;
    } else if (buffer.length + line.length < 220 && !/[.!?]$/.test(buffer)) {
      buffer = `${buffer} ${line}`;
    } else {
      passages.push(buffer.trim());
      buffer = line;
    }
  }
  if (buffer) passages.push(buffer.trim());

  // Also split very long prose blocks by sentence boundaries
  const refined: string[] = [];
  for (const p of passages) {
    if (p.length <= 260) {
      refined.push(p);
    } else {
      const sentences = p.split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
      for (const s of sentences) {
        if (s.trim().length > 4) refined.push(s.trim());
      }
    }
  }
  return refined;
}

function parseDollarAmounts(passages: CandidatePassage[]): {
  formattedSum: string | null;
  count: number;
} {
  let total = 0;
  let count = 0;
  const seenAmounts = new Set<string>();

  for (const p of passages) {
    const regex = /\$\s*([\d,]+(?:\.\d{1,2})?)\s*(M|Million|K|Thousand)?\b/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(p.text)) !== null) {
      const base = Number(match[1].replace(/,/g, ''));
      if (Number.isNaN(base) || base <= 0) continue;
      const unit = (match[2] || '').toLowerCase();
      const multiplier = unit.startsWith('m')
        ? 1_000_000
        : unit.startsWith('k')
          ? 1_000
          : 1;
      const val = base * multiplier;
      const key = `${p.pageNumber}:${p.text.slice(0, 28)}:${val}`;
      if (!seenAmounts.has(key) && !/\btotal\b/i.test(p.text)) {
        seenAmounts.add(key);
        total += val;
        count++;
      }
    }
  }

  if (count < 2 || total <= 0) {
    return { formattedSum: null, count: 0 };
  }

  const formattedSum =
    total >= 1_000_000
      ? `$${(total / 1_000_000).toFixed(2).replace(/\.00$/, '')}M ($${total.toLocaleString('en-US')})`
      : `$${total.toLocaleString('en-US', { minimumFractionDigits: total % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;

  return { formattedSum, count };
}

export function answerPdfQuestionLocally(params: {
  documentTitle: string;
  pagesText: { pageNumber: number; text: string }[];
  activePage?: number;
  question: string;
  attachedImageText?: string;
  attachedImageLabel?: string;
}): {
  answer: string;
  citedPages: number[];
  followUpQuestions: string[];
} {
  const {
    documentTitle,
    pagesText,
    activePage = 1,
    question,
    attachedImageText,
    attachedImageLabel,
  } = params;

  const lang = detectQueryLanguage(question);
  const {
    coreTerms,
    expandedTerms,
    asksNumeric,
    asksOverview,
    explicitPage,
  } = tokenizeQueryWithSynonyms(question);

  const candidates: CandidatePassage[] = [];

  if (attachedImageText && attachedImageText.trim()) {
    const photoPassages = splitPageIntoPassages(attachedImageText);
    for (const text of photoPassages) {
      candidates.push({
        pageNumber: activePage,
        text,
        isAttachedPhoto: true,
        score: 4.5, // prioritize attached photo when user explicitly attached an image
      });
    }
  }

  for (const page of pagesText) {
    const passages = splitPageIntoPassages(page.text || '');
    for (const text of passages) {
      candidates.push({
        pageNumber: page.pageNumber,
        text,
        score: 0,
      });
    }
  }

  if (candidates.length === 0) {
    const emptyMsg =
      lang === 'hinglish'
        ? 'Is PDF page me embedded text layer nahi mili. Kripya upar "Photo OCR" tab se page scan karein taaki text extract ho sake.'
        : lang === 'hindi'
          ? 'इस PDF में टेक्स्ट लेयर नहीं मिली। कृपया "Photo OCR" टैब से पेज स्कैन करें।'
          : 'No selectable text layer was found in this PDF. Use the "Photo OCR" tab to optically read scanned pages first.';
    return {
      answer: emptyMsg,
      citedPages: [],
      followUpQuestions: [],
    };
  }

  // Document frequency for IDF weighting
  const docFreq = new Map<string, number>();
  for (const term of expandedTerms) {
    let df = 0;
    for (const c of candidates) {
      if (c.text.toLowerCase().includes(term)) df++;
    }
    docFreq.set(term, df);
  }

  const totalCandidates = candidates.length;
  const normalizedQuestionPhrase = coreTerms.slice(0, 3).join(' ');

  for (const c of candidates) {
    const lowerText = c.text.toLowerCase();
    let score = c.score;

    if (explicitPage !== null && c.pageNumber === explicitPage) {
      score += 8.0;
    } else if (explicitPage === null && c.pageNumber === activePage && asksOverview) {
      score += 1.2;
    }

    for (const term of expandedTerms) {
      if (lowerText.includes(term)) {
        const df = docFreq.get(term) || 1;
        const idf = Math.log(1 + totalCandidates / df);
        const isCore = coreTerms.includes(term);
        score += idf * (isCore ? 2.4 : 1.35);
      }
    }

    if (normalizedQuestionPhrase.length >= 5 && lowerText.includes(normalizedQuestionPhrase)) {
      score += 4.0;
    }

    if (asksNumeric && /([$₹€£]\s*\d|\b\d+(?:,\d{3})+|\b\d+(?:\.\d+)?%|\b202\d\b|\bQ[1-4]\b)/i.test(c.text)) {
      score += 2.6;
    }

    if (asksOverview && c.text.length >= 35 && c.text.length <= 200) {
      score += 1.5;
    }

    // Slight penalty for boilerplate headers or tiny fragments
    if (c.text.length < 16) {
      score -= 1.2;
    }

    c.score = score;
  }

  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const topPassages: CandidatePassage[] = [];
  const seenNormalized = new Set<string>();

  for (const item of sorted) {
    if (topPassages.length >= 5) break;
    if (item.score <= 0 && topPassages.length >= 2) break;
    const key = item.text.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 75);
    if (!key || seenNormalized.has(key)) continue;
    seenNormalized.add(key);
    topPassages.push(item);
  }

  // Fallback if query had zero lexical overlap: surface highest-signal lines from explicitPage or activePage
  const selectedPassages =
    topPassages.length > 0 && topPassages[0].score > 0
      ? topPassages
      : candidates
          .filter((c) => c.pageNumber === (explicitPage ?? activePage))
          .slice(0, 4);

  const citedPages = Array.from(
    new Set(
      selectedPassages
        .filter((p) => !p.isAttachedPhoto)
        .map((p) => p.pageNumber)
        .filter((n) => n >= 1 && n <= Math.max(1, pagesText.length))
    )
  ).sort((a, b) => a - b);

  const bulletLines = selectedPassages.map((p) => {
    const cleanLine = p.text.replace(/^[-•*▪]\s*/, '').trim();
    const sourceTag = p.isAttachedPhoto
      ? `(${attachedImageLabel || 'Attached Photo'})`
      : `(Page ${p.pageNumber})`;
    return `• ${cleanLine} ${sourceTag}`;
  });

  const { formattedSum, count: summedCount } =
    /\b(total|budget|sum|kitna|overall)\b/i.test(question)
      ? parseDollarAmounts(selectedPassages)
      : { formattedSum: null, count: 0 };

  let intro = '';
  if (lang === 'hinglish') {
    intro = explicitPage
      ? `"${documentTitle}" ke Page ${explicitPage} se mukhya jankari niche di gayi hai:`
      : `"${documentTitle}" PDF se aapke sawal ke mutabik exact points yeh hain:`;
  } else if (lang === 'hindi') {
    intro = explicitPage
      ? `"${documentTitle}" के पेज ${explicitPage} से प्रमुख विवरण नीचे दिए गए हैं:`
      : `"${documentTitle}" दस्तावेज़ के आधार पर सटीक जानकारी नीचे दी गई है:`;
  } else {
    intro = explicitPage
      ? `Key details found on Page ${explicitPage} of "${documentTitle}":`
      : `Based on "${documentTitle}", here are the matching details from the document:`;
  }

  const sumLine =
    formattedSum && summedCount >= 2
      ? lang === 'hinglish'
        ? `\n\nCalculated Sum (${summedCount} matched line items): ${formattedSum}`
        : `\n\nCalculated Total (${summedCount} matched items): ${formattedSum}`
      : '';

  const answer = `${intro}\n\n${bulletLines.join('\n')}${sumLine}`;

  // Build 2 dynamic contextual follow-up prompts
  const followUpQuestions: string[] = [];
  const otherPage = pagesText.find((p) => !citedPages.includes(p.pageNumber));
  if (otherPage) {
    followUpQuestions.push(
      lang === 'hinglish'
        ? `Page ${otherPage.pageNumber} ke main points kya hain?`
        : `What are the key takeaways on Page ${otherPage.pageNumber}?`
    );
  }
  followUpQuestions.push(
    lang === 'hinglish'
      ? 'Is PDF me sabhi numbers, targets aur dates ki list batao.'
      : 'List all key numbers, targets, and action items in this PDF.'
  );
  if (followUpQuestions.length < 2) {
    followUpQuestions.push(
      lang === 'hinglish'
        ? 'Is poore PDF ka executive summary aur main conclusions batao.'
        : 'Give a concise executive summary of all pages in this PDF.'
    );
  }

  return {
    answer,
    citedPages,
    followUpQuestions: followUpQuestions.slice(0, 2),
  };
}

export function summarizePdfLocally(params: {
  documentTitle: string;
  pagesText: { pageNumber: number; text: string }[];
  language?: 'english' | 'hinglish' | 'hindi';
  mode?: 'executive' | 'action-items' | 'page-by-page';
}): AiSummaryResult {
  const {
    documentTitle,
    pagesText,
    language = 'english',
    mode = 'executive',
  } = params;

  const cleanTitle = documentTitle.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim() || 'Document';
  const totalPages = pagesText.length;
  const totalWords = pagesText.reduce(
    (acc, p) => acc + (p.text.trim() ? p.text.trim().split(/\s+/).length : 0),
    0
  );

  const allPassages: { pageNumber: number; text: string; signal: number; isAction: boolean }[] = [];

  for (const p of pagesText) {
    const blocks = splitPageIntoPassages(p.text || '');
    blocks.forEach((b, idx) => {
      if (b.length < 18) return;
      let signal = 1;
      if (idx === 0) signal += 1.5;
      if (/([$₹€£]\s*\d|\b\d+(?:\.\d+)?%|\b202\d\b|\bQ[1-4]\b)/.test(b)) signal += 2.5;
      if (/\b(total|budget|target|sla|security|architecture|objective|summary|revenue|deadline|compliance)\b/i.test(b)) {
        signal += 1.8;
      }
      const isAction =
        /\b(must|shall|required|ensure|target|deploy|complete|deliver|enforce|implement|action|milestone|phase|review|audit|deadline)\b/i.test(
          b
        );
      if (isAction) signal += 1.2;
      allPassages.push({ pageNumber: p.pageNumber, text: b, signal, isAction });
    });
  }

  const ranked = [...allPassages].sort((a, b) => b.signal - a.signal);

  const keyTakeaways = ranked.slice(0, mode === 'executive' ? 5 : 6).map((item) => {
    const cleaned = item.text.replace(/^[-•*▪]\s*/, '').trim();
    return `${cleaned} (Page ${item.pageNumber})`;
  });

  const actionCandidates = ranked.filter((item) => item.isAction);
  const actionItems = (actionCandidates.length > 0 ? actionCandidates : ranked.slice(0, 4))
    .slice(0, mode === 'action-items' ? 6 : 4)
    .map((item) => `${item.text.replace(/^[-•*▪]\s*/, '').trim()} (Page ${item.pageNumber})`);

  const maxPageHighlights = mode === 'page-by-page' ? 30 : 10;
  const pageHighlights = pagesText.slice(0, maxPageHighlights).map((p) => {
    const blocks = splitPageIntoPassages(p.text || '').filter((b) => b.length >= 15);
    const bestBlock =
      blocks.find((b) => /([$₹€£]\s*\d|\b\d+(?:\.\d+)?%|:)/.test(b)) ||
      blocks[0] ||
      'Scanned or visual page content.';
    return {
      pageNumber: p.pageNumber,
      summary: bestBlock.slice(0, 220),
    };
  });

  const leadSnippet = ranked[0]?.text || 'Structured multi-page PDF document.';

  const headline =
    language === 'hindi'
      ? `${cleanTitle} — मुख्य सारांश (${totalPages} पेज)`
      : language === 'hinglish'
        ? `${cleanTitle} — Executive Summary (${totalPages} Pages)`
        : `${cleanTitle} — Executive Brief (${totalPages} ${totalPages === 1 ? 'Page' : 'Pages'})`;

  const executiveOverview =
    language === 'hindi'
      ? `इस दस्तावेज़ में कुल ${totalPages} पेज और लगभग ${totalWords.toLocaleString()} शब्द हैं। प्रमुख बिंदु: ${leadSnippet}`
      : language === 'hinglish'
        ? `Is PDF document me total ${totalPages} pages aur ~${totalWords.toLocaleString()} words hain. Sabse mahatvapurna highlight: ${leadSnippet}`
        : `This ${totalPages}-page document (${totalWords.toLocaleString()} words) covers ${cleanTitle}. Primary highlight: ${leadSnippet}`;

  return {
    headline,
    executiveOverview,
    keyTakeaways:
      keyTakeaways.length > 0
        ? keyTakeaways
        : ['No embedded text sentences found — run Photo OCR on scanned pages first.'],
    actionItems,
    pageHighlights,
  };
}

export function formatOcrTextByMode(
  rawText: string,
  mode: LocalOcrMode = 'verbatim'
): PhotoOcrResult {
  const normalizedLines = rawText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''));

  // Remove excessive blank runs (>2 consecutive empty lines)
  const compactLines: string[] = [];
  let blankRun = 0;
  for (const line of normalizedLines) {
    if (!line.trim()) {
      blankRun++;
      if (blankRun <= 1) compactLines.push('');
    } else {
      blankRun = 0;
      compactLines.push(line);
    }
  }

  let extractedText = compactLines.join('\n').trim();

  if (mode === 'clean-paragraphs') {
    const paragraphs: string[] = [];
    let current = '';
    for (const line of compactLines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (current) {
          paragraphs.push(current);
          current = '';
        }
        continue;
      }
      if (/^[-•*]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)) {
        if (current) {
          paragraphs.push(current);
          current = '';
        }
        paragraphs.push(trimmed);
      } else {
        current = current
          ? `${current.replace(/-$/, '')}${current.endsWith('-') ? '' : ' '}${trimmed}`
          : trimmed;
      }
    }
    if (current) paragraphs.push(current);
    extractedText = paragraphs.join('\n\n').trim();
  } else if (mode === 'structured') {
    extractedText = compactLines
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return '';
        // Short all-caps lines become Markdown headings
        if (
          trimmed.length >= 4 &&
          trimmed.length <= 58 &&
          trimmed === trimmed.toUpperCase() &&
          /[A-Z]{3}/.test(trimmed)
        ) {
          return `## ${trimmed}`;
        }
        // Multi-space tabular columns become clean pipe-separated columns
        if (/\S\s{3,}\S/.test(trimmed)) {
          return trimmed.replace(/\s{3,}/g, '  |  ');
        }
        return trimmed;
      })
      .join('\n')
      .trim();
  }

  const hasHindi = /[\u0900-\u097F]/.test(extractedText);
  const hasLatin = /[A-Za-z]/.test(extractedText);
  const detectedLanguage =
    hasHindi && hasLatin
      ? 'Hindi + English'
      : hasHindi
        ? 'Hindi (हिंदी)'
        : 'English';

  const documentType = /\b(invoice|subtotal|amount due|bill to|tax)\b/i.test(extractedText)
    ? 'Invoice / Billing Statement'
    : /\b(agreement|clause|whereas|party|contract|signature)\b/i.test(extractedText)
      ? 'Legal / Contract Document'
      : /\b(budget|revenue|quarter|sla|architecture|workstream)\b/i.test(extractedText)
        ? 'Enterprise / Technical Report'
        : 'Scanned Page / Photo';

  const wordCount = extractedText ? extractedText.split(/\s+/).filter(Boolean).length : 0;
  const summaryNote =
    wordCount > 0
      ? `Extracted ${wordCount} words locally in your browser (100% Free OCR · zero cloud upload).`
      : 'No readable characters were detected in this image. Try a clearer or higher-contrast crop.';

  return {
    extractedText,
    detectedLanguage,
    documentType,
    summaryNote,
  };
}

export function rewriteTextLocally(
  text: string,
  action: string = 'improve',
  customPrompt: string = ''
): { revisedText: string; changeNotes: string } {
  const cleanedWhitespace = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();

  if (!cleanedWhitespace) {
    return { revisedText: '', changeNotes: 'No input text provided.' };
  }

  const fixBasicTyposAndCase = (input: string): string => {
    let out = input
      .replace(/\b(\w+)\s+\1\b/gi, '$1')
      .replace(/\bi\b/g, 'I')
      .replace(/\brecieve\b/gi, 'receive')
      .replace(/\boccured\b/gi, 'occurred')
      .replace(/\bseperate\b/gi, 'separate')
      .replace(/\bdefinately\b/gi, 'definitely')
      .replace(/\baccomodate\b/gi, 'accommodate');
    out = out.replace(/(^|[.!?]\s+)([a-z])/g, (_m, p1: string, p2: string) => `${p1}${p2.toUpperCase()}`);
    if (!/[.!?]$/.test(out) && out.split(/\s+/).length > 4) {
      out += '.';
    }
    return out;
  };

  if (action === 'bullets') {
    const parts = cleanedWhitespace
      .split(/(?:\n+|(?<=[.!?])\s+)/)
      .map((s) => s.replace(/^[-•*▪\d.)]+\s*/, '').trim())
      .filter(Boolean);
    return {
      revisedText: parts.map((p) => `• ${fixBasicTyposAndCase(p)}`).join('\n'),
      changeNotes: `Converted passage into ${parts.length} structured bullet points locally.`,
    };
  }

  if (action === 'shorten') {
    const concise = fixBasicTyposAndCase(
      cleanedWhitespace
        .replace(/\bin order to\b/gi, 'to')
        .replace(/\bdue to the fact that\b/gi, 'because')
        .replace(/\bat this point in time\b/gi, 'now')
        .replace(/\bin the event that\b/gi, 'if')
        .replace(/\bfor the purpose of\b/gi, 'for')
        .replace(/\bwith regard to\b/gi, 'regarding')
        .replace(/\bas a matter of fact,?\s*/gi, '')
        .replace(/\bit is important to note that\s*/gi, '')
        .replace(/\s*\([^)]{15,}\)/g, '')
    );
    return {
      revisedText: concise,
      changeNotes: 'Condensed verbose phrasing while keeping numbers and core facts intact.',
    };
  }

  if (action === 'formal') {
    const formal = fixBasicTyposAndCase(
      cleanedWhitespace
        .replace(/\bdon't\b/gi, 'do not')
        .replace(/\bcan't\b/gi, 'cannot')
        .replace(/\bwon't\b/gi, 'will not')
        .replace(/\bit's\b/gi, 'it is')
        .replace(/\bwe're\b/gi, 'we are')
        .replace(/\bthey're\b/gi, 'they are')
        .replace(/\bisn't\b/gi, 'is not')
        .replace(/\baren't\b/gi, 'are not')
        .replace(/\bget\b/gi, 'obtain')
        .replace(/\bneed to\b/gi, 'must')
        .replace(/\bmake sure\b/gi, 'ensure')
    );
    return {
      revisedText: formal,
      changeNotes: 'Expanded contractions and applied executive formal tone.',
    };
  }

  if (action === 'simplify') {
    const simple = fixBasicTyposAndCase(
      cleanedWhitespace
        .replace(/\butilize\b/gi, 'use')
        .replace(/\bfacilitate\b/gi, 'help')
        .replace(/\bsubsequently\b/gi, 'later')
        .replace(/\bcommence\b/gi, 'start')
        .replace(/\bprior to\b/gi, 'before')
        .replace(/\bin excess of\b/gi, 'more than')
        .replace(/\bapproximately\b/gi, 'about')
        .replace(/\bmandatory\b/gi, 'required')
        .replace(/\bterminate\b/gi, 'end')
    );
    return {
      revisedText: simple,
      changeNotes: 'Simplified complex vocabulary into clear everyday language.',
    };
  }

  if (action === 'uppercase') {
    return {
      revisedText: cleanedWhitespace.toUpperCase(),
      changeNotes: 'Converted text to UPPERCASE.',
    };
  }

  if (action === 'titlecase') {
    const smallWords = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
    const titled = cleanedWhitespace
      .toLowerCase()
      .split(/\s+/)
      .map((word, index) =>
        index > 0 && smallWords.has(word)
          ? word
          : word.charAt(0).toUpperCase() + word.slice(1)
      )
      .join(' ');
    return {
      revisedText: titled,
      changeNotes: 'Formatted passage in Title Case.',
    };
  }

  if (action === 'custom' && customPrompt.trim()) {
    const directive = customPrompt.trim();
    const replaceMatch = directive.match(/replace\s+["']?(.+?)["']?\s+with\s+["']?(.+?)["']?$/i);
    if (replaceMatch) {
      const escaped = replaceMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const replaced = cleanedWhitespace.replace(new RegExp(escaped, 'gi'), replaceMatch[2]);
      return {
        revisedText: replaced,
        changeNotes: `Replaced "${replaceMatch[1]}" with "${replaceMatch[2]}".`,
      };
    }
    if (/\bbullet/i.test(directive)) {
      return rewriteTextLocally(cleanedWhitespace, 'bullets');
    }
    if (/\bupper/i.test(directive)) {
      return rewriteTextLocally(cleanedWhitespace, 'uppercase');
    }
    if (/\bshort|condense/i.test(directive)) {
      return rewriteTextLocally(cleanedWhitespace, 'shorten');
    }
  }

  // Default: 'improve' or 'grammar'
  const polished = fixBasicTyposAndCase(cleanedWhitespace.replace(/\n+/g, ' '));
  return {
    revisedText: polished,
    changeNotes: 'Cleaned line wraps, normalized spacing, and polished sentence punctuation.',
  };
}

let cachedWorkerPromise: {
  langKey: string;
  promise: Promise<import('tesseract.js').Worker>;
} | null = null;

export async function runBrowserPhotoOcr(
  imageDataUrl: string,
  mode: LocalOcrMode = 'verbatim',
  onProgress?: (percent: number, statusText: string) => void
): Promise<PhotoOcrResult> {
  const langKey = mode === 'bilingual-hin-eng' ? 'eng+hin' : 'eng';
  const langsArg = mode === 'bilingual-hin-eng' ? ['eng', 'hin'] : 'eng';

  if (cachedWorkerPromise && cachedWorkerPromise.langKey !== langKey) {
    try {
      const prevWorker = await cachedWorkerPromise.promise;
      await prevWorker.terminate();
    } catch {
      // ignore termination failure
    }
    cachedWorkerPromise = null;
  }

  const { createWorker } = await import('tesseract.js');

  if (!cachedWorkerPromise) {
    cachedWorkerPromise = {
      langKey,
      promise: createWorker(langsArg, 1, {
        logger: (m) => {
          if (onProgress && typeof m.progress === 'number') {
            onProgress(Math.round(m.progress * 100), m.status || 'Reading text...');
          }
        },
      }),
    };
  }

  try {
    onProgress?.(15, 'Initializing local browser OCR engine...');
    const worker = await cachedWorkerPromise.promise;
    onProgress?.(55, 'Scanning characters, numbers & layout...');
    const result = await worker.recognize(imageDataUrl);
    onProgress?.(100, 'Completed');
    return formatOcrTextByMode(result.data.text || '', mode);
  } catch (err) {
    cachedWorkerPromise = null;
    throw err instanceof Error
      ? err
      : new Error('Unable to run browser OCR on the selected image.');
  }
}
