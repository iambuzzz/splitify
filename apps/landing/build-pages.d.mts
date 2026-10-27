// Types for build-pages.mjs (plain JavaScript, so deploy can run it with node).
export interface PageMeta {
  title: string;
  description: string;
  crumb: string;
  type: 'article' | 'tool';
  updated: string;
  h1?: string;
  blurb?: string;
  published?: string;
}
export interface Page {
  slug: string;
  meta: PageMeta;
  body: string;
}
export const SITE: string;
export function questionsOf(body: string): { q: string; a: string }[];
export function readPages(dir?: string): Page[];
export function renderPage(page: Page, pages: Page[]): string;
export function sitemap(pages: Page[], landingUpdated: string): string;
