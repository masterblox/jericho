import { randomBytes } from 'node:crypto';

const DUCKDUCKGO_URL = 'https://html.duckduckgo.com/html/';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchPort {
  search(query: string, numResults: number, signal: AbortSignal): Promise<{
    results: WebSearchResult[];
  }>;
}

export interface DuckDuckGoSearchOptions {
  timeoutMs?: number;
  maxResults?: number;
  fetch?: typeof globalThis.fetch;
}

/**
 * DuckDuckGo HTML search backend.
 * Scrapes the HTML results page for privacy-respecting web search.
 * No API key required.
 */
export class DuckDuckGoSearch implements WebSearchPort {
  readonly #timeoutMs: number;
  readonly #maxResults: number;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options?: DuckDuckGoSearchOptions) {
    this.#timeoutMs = options?.timeoutMs ?? 10_000;
    this.#maxResults = options?.maxResults ?? 5;
    this.#fetch = options?.fetch ?? globalThis.fetch;
  }

  async search(query: string, numResults: number, signal: AbortSignal): Promise<{
    results: WebSearchResult[];
  }> {
    const bounded = query.replace(/\s+/gu, ' ').trim().slice(0, 500);
    if (!bounded) return { results: [] };

    const limit = Math.min(numResults, this.#maxResults);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    timeout.unref?.();
    const combined = AbortSignal.any([signal, controller.signal]);

    try {
      const body = new URLSearchParams({
        q: bounded,
        kl: 'us-en',
      });

      const response = await this.#fetch(DUCKDUCKGO_URL, {
        method: 'POST',
        signal: combined,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': USER_AGENT,
          accept: 'text/html',
        },
        body: body.toString(),
      });

      if (!response.ok) return { results: [] };
      const html = await response.text();
      return { results: parseResults(html, limit) };
    } catch {
      return { results: [] };
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Parse DuckDuckGo HTML results into structured data.
 */
function parseResults(html: string, limit: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  
  // Match result blocks: <a class="result__a" href="...">title</a>
  // followed by <a class="result__snippet">snippet</a>
  const resultPattern = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  
  let match;
  while ((match = resultPattern.exec(html)) !== null && results.length < limit) {
    const rawUrl = match[1];
    const title = decodeHtmlEntities(stripTags(match[2]));
    const snippet = decodeHtmlEntities(stripTags(match[3]));
    
    // DuckDuckGo wraps URLs in a redirect; extract the actual URL
    const url = extractUrl(rawUrl);
    if (!url || !title) continue;
    
    results.push({ title, url, snippet });
  }
  
  return results;
}

function extractUrl(rawUrl: string): string | null {
  // DuckDuckGo uses //duckduckgo.com/l/?uddg=ENCODED_URL&rut=...
  const uddgMatch = /[?&]uddg=([^&]+)/i.exec(rawUrl);
  if (uddgMatch) {
    try {
      return decodeURIComponent(uddgMatch[1]);
    } catch {
      return null;
    }
  }
  // Direct URL
  if (rawUrl.startsWith('http')) return rawUrl;
  return null;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/gu, '');
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&#x27;/gu, "'")
    .replace(/&#(\d+);/gu, (_, code) => String.fromCharCode(Number(code)));
}
