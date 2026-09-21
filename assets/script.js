const ARTICLE_TYPES = ['Article', 'NewsArticle', 'BlogPosting', 'Report', 'TechArticle', 'ScholarlyArticle'];

const form = document.getElementById('audit-form');
const urlInput = document.getElementById('url-input');
const statusLine = document.getElementById('status-line');
const analyzeBtn = document.getElementById('analyze-btn');
const results = document.getElementById('results');
const togglePasteBtn = document.getElementById('toggle-paste');
const pasteArea = document.getElementById('paste-area');
const htmlInput = document.getElementById('html-input');
const analyzePasteBtn = document.getElementById('analyze-paste-btn');

togglePasteBtn.addEventListener('click', () => {
  pasteArea.classList.toggle('hidden');
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;
  await runAudit({ url });
});

analyzePasteBtn.addEventListener('click', () => {
  const html = htmlInput.value.trim();
  if (!html) {
    setStatus('Paste some HTML first.', true);
    return;
  }
  runAudit({ html, url: urlInput.value.trim() || '(pasted HTML)' });
});

function setStatus(msg, isError = false) {
  statusLine.textContent = msg;
  statusLine.classList.toggle('error', isError);
}

async function runAudit({ url, html }) {
  setBusy(true);
  setStatus('Fetching page…');
  results.classList.add('hidden');

  try {
    let sourceHtml = html;
    let finalUrl = url;

    if (!sourceHtml) {
      const resp = await fetch('api/fetch.php?url=' + encodeURIComponent(url));
      const data = await resp.json();
      if (!resp.ok || data.error) {
        throw new Error(data.error || 'Could not fetch that URL.');
      }
      sourceHtml = data.html;
      finalUrl = data.finalUrl || url;
    }

    setStatus('Analyzing…');
    const doc = new DOMParser().parseFromString(sourceHtml, 'text/html');
    const report = analyze(doc, finalUrl);
    renderReport(report, finalUrl);
    setStatus('Done.');
  } catch (err) {
    setStatus(err.message || 'Something went wrong.', true);
  } finally {
    setBusy(false);
  }
}

function setBusy(busy) {
  analyzeBtn.disabled = busy;
  analyzePasteBtn.disabled = busy;
}

// ---------- Analysis ----------

function analyze(doc, pageUrl) {
  const jsonLdBlocks = extractJsonLd(doc);
  const articleNode = findArticleNode(jsonLdBlocks);
  const orgOrWebsiteNodes = jsonLdBlocks.filter(n => matchesType(n, ['Organization', 'WebSite', 'Person']));

  const schemaChecks = buildSchemaChecks(articleNode, jsonLdBlocks);
  const eeatChecks = buildEeatChecks(doc, articleNode, orgOrWebsiteNodes);
  const techChecks = buildTechChecks(doc, pageUrl);

  const all = [...schemaChecks, ...eeatChecks, ...techChecks];
  const score = computeScore(all);

  return { schemaChecks, eeatChecks, techChecks, score, jsonLdBlocks };
}

function extractJsonLd(doc) {
  const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
  const nodes = [];
  for (const s of scripts) {
    try {
      const parsed = JSON.parse(s.textContent);
      const arr = Array.isArray(parsed) ? parsed : (parsed['@graph'] ? parsed['@graph'] : [parsed]);
      for (const node of arr) {
        if (node && typeof node === 'object') nodes.push(node);
      }
    } catch (e) {
      // Malformed JSON-LD block — ignore but could be flagged separately.
    }
  }
  return nodes;
}

function matchesType(node, types) {
  if (!node || !node['@type']) return false;
  const nodeTypes = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
  return nodeTypes.some(t => types.includes(t));
}

function findArticleNode(nodes) {
  return nodes.find(n => matchesType(n, ARTICLE_TYPES)) || null;
}

function check(id, label, status, detail) {
  return { id, label, status, detail };
}

function buildSchemaChecks(articleNode, allNodes) {
  const checks = [];

  if (!articleNode) {
    checks.push(check('has-article', 'Article/NewsArticle/BlogPosting JSON-LD present', 'fail',
      'No Article-family structured data found. Google states there are no required properties for Article markup — but having none at all means Google and AI systems have to infer headline, author, and publish date instead of reading them directly.'));
    return checks;
  }

  checks.push(check('has-article', 'Article/NewsArticle/BlogPosting JSON-LD present', 'pass',
    `Found type: ${[].concat(articleNode['@type']).join(', ')}`));

  checks.push(fieldCheck(articleNode, 'headline', 'headline field present', {
    pass: v => typeof v === 'string' && v.length > 0,
    warnMsg: 'Recommended by Google. Add a concise headline — long titles may be truncated in search results.',
    extra: v => (typeof v === 'string' && v.length > 110) ? { status: 'warn', detail: `Headline is ${v.length} characters — consider trimming, as long titles may be truncated on some devices.` } : null
  }));

  checks.push(fieldCheck(articleNode, 'image', 'image field present', {
    pass: v => v && (typeof v === 'string' || Array.isArray(v) || typeof v === 'object'),
    warnMsg: 'Recommended by Google. Add at least one image, ideally 3 aspect ratios (16x9, 4x3, 1x1) at 50K+ pixels (width × height).'
  }));

  checks.push(fieldCheck(articleNode, 'datePublished', 'datePublished present (ISO 8601)', {
    pass: v => typeof v === 'string' && !isNaN(Date.parse(v)),
    warnMsg: 'Recommended by Google, with timezone info, for accurate freshness signals.'
  }));

  checks.push(fieldCheck(articleNode, 'dateModified', 'dateModified present', {
    pass: v => typeof v === 'string' && !isNaN(Date.parse(v)),
    warnMsg: 'Recommended by Google when applicable. Helps signal freshness when content is updated — important for AI systems weighing recency.'
  }));

  const author = articleNode.author;
  if (!author) {
    checks.push(check('author-present', 'author field present', 'warn',
      'Recommended by Google. Without an author entity, there is a weaker E-E-A-T signal for who is accountable for this content.'));
  } else {
    checks.push(check('author-present', 'author field present', 'pass', ''));
    const authorObj = Array.isArray(author) ? author[0] : author;
    const isPersonType = typeof authorObj === 'object' && matchesType(authorObj, ['Person']);
    checks.push(check('author-typed', 'author uses Person/Organization type (not a plain string)', isPersonType || matchesType(authorObj, ['Organization']) ? 'pass' : 'warn',
      (isPersonType || matchesType(authorObj, ['Organization'])) ? '' : 'Google\'s author best practices call for a typed Person or Organization object, not a plain string — this gives search engines and LLMs something to connect the byline to a real, verifiable identity.'));
  }

  const publisher = articleNode.publisher;
  if (!publisher) {
    checks.push(check('publisher-present', 'publisher field present', 'warn',
      'Not in Google\'s current documented Article properties, but still a standard schema.org field and used by other platforms (e.g. Google News) to identify the organization behind the content.'));
  } else {
    checks.push(check('publisher-present', 'publisher field present', 'pass', ''));
    const hasLogo = publisher.logo && (publisher.logo.url || typeof publisher.logo === 'string');
    checks.push(check('publisher-logo', 'publisher.logo present', hasLogo ? 'pass' : 'warn',
      hasLogo ? '' : 'A logo on the publisher entity is still expected by several Google Search features (e.g. Top Stories) even though it is not on the current Article properties list.'));
  }

  const mainEntity = articleNode.mainEntityOfPage;
  checks.push(check('main-entity', 'mainEntityOfPage present', mainEntity ? 'pass' : 'warn',
    mainEntity ? '' : 'Not on Google\'s current Article properties list, but still useful schema.org practice — it should point to the canonical WebPage @id to disambiguate this article.'));

  return checks;
}

function fieldCheck(node, field, label, opts) {
  const v = node[field];
  const passed = opts.pass(v);
  if (!passed) {
    return check(`field-${field}`, label, 'warn', opts.warnMsg || '');
  }
  if (opts.extra) {
    const extra = opts.extra(v);
    if (extra) return check(`field-${field}`, label, extra.status, extra.detail);
  }
  return check(`field-${field}`, label, 'pass', '');
}

function buildEeatChecks(doc, articleNode, orgOrWebsiteNodes) {
  const checks = [];

  // Visible byline in the actual HTML (not just schema)
  const bylineSelectors = ['[rel="author"]', '.byline', '.author', '[itemprop="author"]', '[class*="author-name"]'];
  const hasVisibleByline = bylineSelectors.some(sel => doc.querySelector(sel)) ||
    /\bby\s+[A-Z][a-z]+\s+[A-Z][a-z]+/i.test(doc.body ? doc.body.textContent || '' : '');
  checks.push(check('visible-byline', 'Visible author byline in page content', hasVisibleByline ? 'pass' : 'warn',
    hasVisibleByline ? '' : 'Readers (and AI systems reading rendered content) should be able to see who wrote this without inspecting schema.'));

  // Author entity depth: url / sameAs / jobTitle / description
  let authorObj = null;
  if (articleNode && articleNode.author) {
    authorObj = Array.isArray(articleNode.author) ? articleNode.author[0] : articleNode.author;
  }
  if (authorObj && typeof authorObj === 'object') {
    const hasUrl = !!authorObj.url;
    checks.push(check('author-url', 'author.url (links to a bio/profile page)', hasUrl ? 'pass' : 'warn',
      hasUrl ? '' : 'A bio page lets Google and LLMs verify the author\'s expertise and track record — a core E-E-A-T signal.'));

    const sameAs = authorObj.sameAs;
    const hasSameAs = sameAs && (Array.isArray(sameAs) ? sameAs.length > 0 : typeof sameAs === 'string');
    checks.push(check('author-sameas', 'author.sameAs (links to social/professional profiles)', hasSameAs ? 'pass' : 'warn',
      hasSameAs ? '' : 'Linking to LinkedIn, X, or a professional profile helps establish the author as a real, verifiable entity.'));

    const hasCredentials = !!(authorObj.jobTitle || authorObj.description || authorObj.honorificPrefix);
    checks.push(check('author-credentials', 'author credentials (jobTitle/description present)', hasCredentials ? 'pass' : 'warn',
      hasCredentials ? '' : 'Stating the author\'s role or expertise (e.g. "Senior Health Reporter") strengthens the Expertise/Authoritativeness signal.'));
  } else if (articleNode) {
    checks.push(check('author-depth', 'Author entity has depth (url/sameAs/credentials)', 'warn',
      'Author is missing or not a structured Person object — see the schema section above.'));
  }

  // Organization-level trust: sameAs on Organization/WebSite
  const orgNode = orgOrWebsiteNodes.find(n => matchesType(n, ['Organization']));
  if (orgNode) {
    const sameAs = orgNode.sameAs;
    const hasSameAs = sameAs && (Array.isArray(sameAs) ? sameAs.length > 0 : typeof sameAs === 'string');
    checks.push(check('org-sameas', 'Publisher Organization has sameAs links', hasSameAs ? 'pass' : 'warn',
      hasSameAs ? '' : 'Linking the publisher entity to its official social/Wikipedia/Wikidata profiles helps establish it as a known, trusted entity graph node.'));
  } else {
    checks.push(check('org-node', 'Site-wide Organization schema present', 'warn',
      'No Organization JSON-LD detected on this page. Usually lives sitewide (e.g. in the footer/header template) — worth checking a homepage or template file directly.'));
  }

  return checks;
}

function buildTechChecks(doc, pageUrl) {
  const checks = [];

  const canonical = doc.querySelector('link[rel="canonical"]');
  checks.push(check('canonical', 'Canonical tag present', canonical ? 'pass' : 'warn',
    canonical ? `Points to: ${canonical.getAttribute('href')}` : 'Helps prevent duplicate-content confusion across URL variants.'));

  const isHttps = pageUrl.startsWith('https://');
  checks.push(check('https', 'Served over HTTPS', isHttps ? 'pass' : 'fail',
    isHttps ? '' : 'HTTPS is a baseline trust and ranking signal.'));

  const title = doc.querySelector('title');
  const titleLen = title ? title.textContent.trim().length : 0;
  checks.push(check('title', 'Title tag present and reasonable length', (titleLen > 0 && titleLen <= 65) ? 'pass' : (titleLen > 0 ? 'warn' : 'fail'),
    titleLen === 0 ? 'Missing <title> tag.' : (titleLen > 65 ? `Title is ${titleLen} characters — may get truncated in search results (~60-65 recommended).` : '')));

  const metaDesc = doc.querySelector('meta[name="description"]');
  const descLen = metaDesc ? (metaDesc.getAttribute('content') || '').trim().length : 0;
  checks.push(check('meta-description', 'Meta description present', descLen > 0 ? 'pass' : 'warn',
    descLen > 0 ? `${descLen} characters` : 'Missing — used as fallback snippet text and context for AI summarization.'));

  const htmlLang = doc.documentElement.getAttribute('lang');
  checks.push(check('lang-attr', 'html lang attribute present', htmlLang ? 'pass' : 'warn',
    htmlLang ? `lang="${htmlLang}"` : 'Helps crawlers and assistive tech determine content language.'));

  const ogTitle = doc.querySelector('meta[property="og:title"]');
  const ogImage = doc.querySelector('meta[property="og:image"]');
  const ogType = doc.querySelector('meta[property="og:type"]');
  const ogCount = [ogTitle, ogImage, ogType].filter(Boolean).length;
  checks.push(check('open-graph', 'Open Graph tags (title/image/type)', ogCount === 3 ? 'pass' : (ogCount > 0 ? 'warn' : 'fail'),
    ogCount === 3 ? '' : `${ogCount}/3 present — used when content is shared or previewed by platforms and some AI agents.`));

  const twitterCard = doc.querySelector('meta[name="twitter:card"]');
  checks.push(check('twitter-card', 'Twitter/X card meta present', twitterCard ? 'pass' : 'warn',
    twitterCard ? '' : 'Optional but common social preview signal.'));

  return checks;
}

function computeScore(checks) {
  const weights = { pass: 1, warn: 0.5, fail: 0 };
  const total = checks.length;
  const sum = checks.reduce((acc, c) => acc + weights[c.status], 0);
  return Math.round((sum / total) * 100);
}

// ---------- Rendering ----------

function renderReport(report, pageUrl) {
  results.classList.remove('hidden');

  const scoreCircle = document.getElementById('score-circle');
  const scoreNumber = document.getElementById('score-number');
  const scoreLabel = document.getElementById('score-label');
  const scoreSub = document.getElementById('score-sub');
  const analyzedUrl = document.getElementById('analyzed-url');

  scoreNumber.textContent = report.score;
  scoreCircle.classList.remove('score-good', 'score-mid', 'score-bad');
  let tier = 'score-bad';
  let label = 'Needs work';
  if (report.score >= 85) { tier = 'score-good'; label = 'Strong'; }
  else if (report.score >= 60) { tier = 'score-mid'; label = 'Partial'; }
  scoreCircle.classList.add(tier);
  scoreLabel.textContent = `${label} — Schema & E-E-A-T readiness`;

  const failCount = countStatus(report, 'fail');
  const warnCount = countStatus(report, 'warn');
  scoreSub.textContent = `${failCount} critical issue(s), ${warnCount} recommended improvement(s).`;
  analyzedUrl.textContent = pageUrl;

  renderChecklist('schema-checks', report.schemaChecks);
  renderChecklist('eeat-checks', report.eeatChecks);
  renderChecklist('tech-checks', report.techChecks);

  const rawEl = document.getElementById('jsonld-raw');
  rawEl.textContent = report.jsonLdBlocks.length
    ? JSON.stringify(report.jsonLdBlocks, null, 2)
    : 'No JSON-LD found.';
}

function countStatus(report, status) {
  return [...report.schemaChecks, ...report.eeatChecks, ...report.techChecks]
    .filter(c => c.status === status).length;
}

function renderChecklist(elId, items) {
  const el = document.getElementById(elId);
  el.innerHTML = '';
  const iconMap = { pass: '✓', warn: '!', fail: '✕' };
  for (const item of items) {
    const li = document.createElement('li');
    const icon = document.createElement('span');
    icon.className = `check-icon ${item.status}`;
    icon.textContent = iconMap[item.status];
    const body = document.createElement('div');
    body.className = 'check-body';
    const strong = document.createElement('strong');
    strong.textContent = item.label;
    body.appendChild(strong);
    if (item.detail) {
      const span = document.createElement('span');
      span.textContent = item.detail;
      body.appendChild(span);
    }
    li.appendChild(icon);
    li.appendChild(body);
    el.appendChild(li);
  }
}
