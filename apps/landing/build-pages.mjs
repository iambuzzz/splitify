#!/usr/bin/env node
// Builds the calculator and guide pages (apps/landing/pages/*.html) into finished pages, plus
// guides.css and sitemap.xml. deploy/deploy.sh runs it: node apps/landing/build-pages.mjs dist/web
//
// Each page file starts with a comment holding its details as JSON, then the page's own content:
//   <!--page {"title": "...", "description": "...", "crumb": "...", "type": "article" | "tool", "updated": "2026-10-27"} -->
// The shared top bar, footer, search tags and structured data (breadcrumbs, the article or tool,
// and the questions in the page's <section class="faq">) are added here, so they never drift apart.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SITE = 'https://splitify.iambuzzdev.in';
const HERE = dirname(fileURLToPath(import.meta.url));
const PAGES = join(HERE, 'pages');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const text = (html) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** The page's questions and answers, read from its own markup (so the data always matches what's shown). */
export function questionsOf(body) {
  const faq = body.match(/<section class="faq"[\s\S]*?<\/section>/)?.[0] ?? '';
  return [...faq.matchAll(/<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)].map((m) => ({ q: text(m[1]), a: text(m[2]) }));
}

export function readPages(dir = PAGES) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.html'))
    .sort()
    .map((f) => {
      const src = readFileSync(join(dir, f), 'utf8');
      const m = src.match(/^<!--page\s+([\s\S]*?)\s*-->\s*/);
      if (!m) throw new Error(`${f}: starts without its <!--page {...} --> details`);
      const meta = JSON.parse(m[1]);
      for (const k of ['title', 'description', 'crumb', 'type', 'updated']) if (!meta[k]) throw new Error(`${f}: no "${k}" in its details`);
      return { slug: f.replace(/\.html$/, ''), meta, body: src.slice(m[0].length) };
    });
}

const TOP = `<header class="top"><div class="wrap wide">
  <a class="logo" href="/"><span class="mark" aria-hidden="true"></span>Splitify</a>
  <a class="btn btn-primary" href="/groups">Open Splitify</a>
</div></header>`;

function footer(pages) {
  const links = pages.map((p) => `<a href="/${p.slug}">${esc(p.meta.crumb)}</a>`).join('\n    ');
  return `<footer class="foot"><div class="wrap wide">
    <a class="logo" href="/"><span class="mark" aria-hidden="true"></span>Splitify</a>
    ${links}
    <a href="/?tour">About Splitify</a>
  </div></footer>`;
}

export function renderPage(page, pages) {
  const { slug, meta, body } = page;
  const url = `${SITE}/${slug}`;
  const faq = questionsOf(body);
  const graph = [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Splitify', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: meta.crumb, item: url },
      ],
    },
    meta.type === 'tool'
      ? {
          '@type': 'WebApplication',
          name: meta.h1 ?? meta.crumb,
          url,
          description: meta.description,
          applicationCategory: 'FinanceApplication',
          operatingSystem: 'Any (web browser)',
          browserRequirements: 'Requires JavaScript',
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' },
          inLanguage: 'en-IN',
        }
      : {
          '@type': 'Article',
          headline: meta.h1 ?? meta.title,
          description: meta.description,
          url,
          mainEntityOfPage: url,
          image: `${SITE}/og.jpg`,
          datePublished: meta.published ?? meta.updated,
          dateModified: meta.updated,
          inLanguage: 'en-IN',
          author: { '@type': 'Organization', name: 'Splitify', url: `${SITE}/` },
          publisher: { '@type': 'Organization', name: 'Splitify', url: `${SITE}/`, logo: { '@type': 'ImageObject', url: `${SITE}/icons/icon-512.png` } },
        },
  ];
  if (faq.length) graph.push({ '@type': 'FAQPage', mainEntity: faq.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(meta.title)}</title>
<meta name="description" content="${esc(meta.description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="${meta.type === 'tool' ? 'website' : 'article'}">
<meta property="og:site_name" content="Splitify">
<meta property="og:locale" content="en_IN">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(meta.title)}">
<meta property="og:description" content="${esc(meta.description)}">
<meta property="og:image" content="${SITE}/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#F4F7F5" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#050506" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/icons/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;700;800&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/guides.css">
<script type="application/ld+json">${ld}</script>
</head>
<body>
${TOP}
<main>
<div class="wrap${meta.type === 'tool' ? ' wide' : ''}">
<ol class="crumbs"><li><a href="/">Splitify</a></li><li aria-current="page">${esc(meta.crumb)}</li></ol>
${body.trim()}
<nav class="related" aria-label="More guides">
  <h2>More from Splitify</h2>
  <ul>
${pages
  .filter((p) => p.slug !== slug)
  .map((p) => `    <li><a href="/${p.slug}">${esc(p.meta.crumb)}<small>${esc(p.meta.blurb ?? '')}</small></a></li>`)
  .join('\n')}
  </ul>
</nav>
</div>
</main>
${footer(pages)}
</body>
</html>
`;
}

export function sitemap(pages, landingUpdated) {
  const urls = [{ loc: `${SITE}/`, lastmod: landingUpdated }, ...pages.map((p) => ({ loc: `${SITE}/${p.slug}`, lastmod: p.meta.updated }))];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod></url>`).join('\n')}
</urlset>
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = process.argv[2];
  if (!out) throw new Error('Usage: node apps/landing/build-pages.mjs <output folder>');
  mkdirSync(out, { recursive: true });
  const pages = readPages();
  for (const p of pages) writeFileSync(join(out, `${p.slug}.html`), renderPage(p, pages));
  copyFileSync(join(PAGES, 'guides.css'), join(out, 'guides.css'));
  const newest = pages.map((p) => p.meta.updated).sort().at(-1);
  writeFileSync(join(out, 'sitemap.xml'), sitemap(pages, newest));
  console.log(`Built ${pages.length} pages and sitemap.xml`);
}
