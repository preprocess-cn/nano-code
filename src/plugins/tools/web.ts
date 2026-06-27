import { NanoPlugin } from '../../plugin.js';
import { ToolDefinition, ToolResponse, ToolContext } from '../../contract.js';

// ── Helpers ──

const toolError = (msg: string): ToolResponse => ({ status: 'error', message: msg });

// ── Web settings (populated by onInit or env vars) ──

let _webSettings: Record<string, any> | undefined;

// ── Turndown lazy singleton ──
// Defer the turndown + domino import (~1.4MB retained heap) until first web_fetch call

let turndownPromise: Promise<any> | undefined;

async function getTurndown(): Promise<any> {
  if (!turndownPromise) {
    turndownPromise = import('turndown').then(m => {
      const TurndownService = (m as any).default || m;
      const td = new TurndownService({
        headingStyle: 'atx',
        hr: '---',
        bulletListMarker: '-',
        codeBlockStyle: 'fenced',
        emDelimiter: '*',
      });
      return td;
    });
  }
  return turndownPromise;
}

// ── Simple LRU cache for web_fetch ──

interface CacheEntry {
  content: string;
  contentType: string;
  timestamp: number;
}

const FETCH_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const fetchCache = new Map<string, CacheEntry>();

function getCached(url: string): string | undefined {
  const entry = fetchCache.get(url);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > FETCH_CACHE_TTL) {
    fetchCache.delete(url);
    return undefined;
  }
  return entry.content;
}

function setCache(url: string, content: string, contentType: string): void {
  // Evict oldest entries if cache grows too large
  if (fetchCache.size > 50) {
    const oldest = fetchCache.entries().next().value;
    if (oldest) fetchCache.delete(oldest[0]);
  }
  fetchCache.set(url, { content, contentType, timestamp: Date.now() });
}

// ── HTML to text / markdown ──

async function htmlToMarkdown(html: string): Promise<string> {
  const turndown = await getTurndown();
  return turndown.turndown(html);
}

function htmlToPlainText(html: string): string {
  // Quick plain-text extraction for non-HTML responses that contain HTML-like content
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Web Fetch ──

interface FetchResult {
  content: string;
  contentType: string;
  code: number;
  codeText: string;
  redirected?: boolean;
  redirectUrl?: string;
}

async function fetchUrl(url: string, signal: AbortSignal): Promise<FetchResult> {
  // Upgrade http to https
  let targetUrl = url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:') {
      parsed.protocol = 'https:';
      targetUrl = parsed.toString();
    }
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  const response = await fetch(targetUrl, {
    signal,
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NanoCode/1.0; +https://github.com/nano-code)',
      Accept: 'text/html, text/markdown, text/plain, application/json, */*',
    },
  });

  const contentType = response.headers.get('content-type') || 'text/plain';
  const mime = contentType.split(';')[0]?.trim().toLowerCase() || 'text/plain';
  const code = response.status;
  const codeText = response.statusText;

  // Detect binary content types
  if (mime.startsWith('image/') || mime === 'application/pdf' || mime.startsWith('audio/') || mime.startsWith('video/')) {
    throw new Error(`Cannot fetch binary content type: ${mime}`);
  }

  const buffer = await response.arrayBuffer();
  const text = new TextDecoder().decode(buffer);

  return { content: text, contentType, code, codeText };
}

async function handleWebFetch(args: any): Promise<ToolResponse> {
  try {
    const url = args?.url;
    if (!url) return toolError('Missing required parameter: "url"');
    const maxChars = args?.maxChars ?? 15000;

    // Check cache
    const cached = getCached(url);
    if (cached) {
      const truncated = cached.length > maxChars ? cached.slice(0, maxChars) + '\n\n[Content truncated due to length...]' : cached;
      return { status: 'success', data: truncated };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    let result: FetchResult;
    try {
      result = await fetchUrl(url, controller.signal);
    } finally {
      clearTimeout(timeout);
    }

    const mime = result.contentType.split(';')[0]?.trim().toLowerCase() || 'text/plain';
    let markdown: string;

    if (mime === 'text/html' || mime.includes('html')) {
      markdown = await htmlToMarkdown(result.content);
    } else if (mime === 'application/json') {
      try {
        const parsed = JSON.parse(result.content);
        markdown = JSON.stringify(parsed, null, 2);
      } catch {
        markdown = result.content;
      }
    } else {
      markdown = result.content;
    }

    // Cache the result
    setCache(url, markdown, result.contentType);

    const truncated = markdown.length > maxChars
      ? markdown.slice(0, maxChars) + '\n\n[Content truncated due to length...]'
      : markdown;

    return {
      status: 'success',
      data: `URL: ${url}\nStatus: ${result.code} ${result.codeText}\nContent-Type: ${result.contentType}\n\n${truncated}`,
    };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return toolError(`web_fetch timed out after 30s for: ${args?.url}`);
    }
    return toolError(`web_fetch failed: ${err.message}`);
  }
}

// ── Tavily Search API ──

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const TAVILY_API_ENDPOINT = 'https://api.tavily.com/search';

function getSearchApiKey(settings?: Record<string, any>): string | undefined {
  return process.env['TAVILY_API_KEY'] ?? settings?.searchApiKey as string | undefined;
}

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

async function searchTavily(query: string, count: number, apiKey: string, signal: AbortSignal): Promise<SearchResult[]> {
  const response = await fetch(TAVILY_API_ENDPOINT, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: count,
      search_depth: 'basic',
      include_answer: false,
    }),
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error('Tavily API returned invalid key or access denied. Check your TAVILY_API_KEY.');
  }
  if (!response.ok) {
    throw new Error(`Tavily API returned HTTP ${response.status}`);
  }

  const data: any = await response.json();
  const results = data?.results as TavilyResult[] | undefined;
  if (!Array.isArray(results) || results.length === 0) {
    return [];
  }

  return results.map((r: TavilyResult) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.content ?? '',
  }));
}

async function handleWebSearch(args: any): Promise<ToolResponse> {
  try {
    const query = args?.query;
    if (!query || (typeof query === 'string' && query.length < 2)) {
      return toolError('Missing required parameter: "query" (min 2 characters)');
    }

    const count = Math.min(args?.count ?? 5, 10);
    const allowedDomains: string[] = args?.allowed_domains ?? [];
    const blockedDomains: string[] = args?.blocked_domains ?? [];

    const apiKey = getSearchApiKey(_webSettings);
    if (!apiKey) {
      return {
        status: 'success',
        data: `Web search is not configured. To enable web search, set the TAVILY_API_KEY environment variable in .env:

\`\`\`
TAVILY_API_KEY=your-api-key-here
\`\`\`

Get a free API key (1000 queries/month) at: https://app.tavily.com`,
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let allResults: SearchResult[];
    try {
      allResults = await searchTavily(query, count + Math.max(allowedDomains.length, blockedDomains.length), apiKey, controller.signal);
    } finally {
      clearTimeout(timeout);
    }

    // Apply domain filters
    let filtered = allResults;
    if (allowedDomains.length > 0) {
      filtered = filtered.filter(r => allowedDomains.some(d => r.url.includes(d)));
    }
    if (blockedDomains.length > 0) {
      filtered = filtered.filter(r => !blockedDomains.some(d => r.url.includes(d)));
    }

    const results = filtered.slice(0, count);

    if (results.length === 0) {
      if (allResults.length > 0 && (allowedDomains.length > 0 || blockedDomains.length > 0)) {
        return { status: 'success', data: 'No search results matched the domain filters. Try removing domain restrictions.' };
      }
      return { status: 'success', data: 'No search results found. Please try a different query.' };
    }

    const output = results.map((r, i) =>
      `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet || '(no description)'}`
    ).join('\n\n');

    return {
      status: 'success',
      data: `Web search results for "${query}":\n\n${output}\n\nREMINDER: You MUST include the sources above in your response using markdown hyperlinks.`,
    };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return toolError('web_search timed out after 15s. Try a more specific query.');
    }
    return toolError(`web_search failed: ${err.message}`);
  }
}

// ── Tool descriptions ──

export const webPlugin: NanoPlugin = {
  name: 'web',
  description: 'Web fetch and search tools',

  async onInit(registry) {
    _webSettings = registry.getPluginConfig('web') as Record<string, any> | undefined;
  },

  getTools(): ToolDefinition[] {
    return [
      {
        type: 'function',
        function: {
          name: 'web_fetch',
          description: 'Fetch content from a URL and return it as readable markdown text. Use this to access documentation, web pages, or any online resource. Converts HTML to Markdown for better readability. Automatically upgrades HTTP to HTTPS. Includes a 10-minute self-cleaning cache for faster repeated access to the same URL.',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'The URL to fetch content from (supports http/https)' },
              maxChars: { type: 'number', description: 'Maximum characters to return (default 15000)' },
            },
            required: ['url'],
          },
          sideEffect: false,
        },
      },
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Search the web for current information using Tavily AI Search. Use this to find documentation, solutions, or any up-to-date information beyond your knowledge cutoff. Returns results with title, URL, and description. Requires a TAVILY_API_KEY environment variable configured in .env (free tier: 1000 queries/month).',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query (min 2 characters)' },
              count: { type: 'number', description: 'Number of results to return (default 5, max 10)' },
              allowed_domains: {
                type: 'array',
                items: { type: 'string' },
                description: 'Only include results from these domains (e.g., ["developer.mozilla.org", "react.dev"])',
              },
              blocked_domains: {
                type: 'array',
                items: { type: 'string' },
                description: 'Exclude results from these domains',
              },
            },
            required: ['query'],
          },
          sideEffect: false,
        },
      },
    ];
  },

  async execute(name: string, args: any, _ctx: ToolContext): Promise<ToolResponse> {
    switch (name) {
      case 'web_fetch':
        return handleWebFetch(args);
      case 'web_search':
        return handleWebSearch(args);
      default:
        throw new Error(`Unknown web tool: ${name}`);
    }
  },
};
