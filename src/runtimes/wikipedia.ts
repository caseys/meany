// Wikipedia's public API (browsers may call it: origin=*): the best article for some words, and
// the first sentences of its introduction, in one request.

export interface WikiFact {
  title: string;
  extract: string;
}

/** The top article for `query` and up to three sentences of its introduction, or null */
export async function lookUp(query: string, signal?: AbortSignal): Promise<WikiFact | null> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: '1',
    prop: 'extracts',
    exintro: '1',
    explaintext: '1',
    exsentences: '3',
    redirects: '1',
  });
  const response = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { signal });
  if (!response.ok) return null;
  const pages = (await response.json())?.query?.pages as Record<string, { title: string; extract?: string }> | undefined;
  const page = pages && Object.values(pages)[0];
  const extract = page?.extract?.replace(/\s+/g, ' ').trim();
  return page && extract ? { title: page.title, extract } : null;
}
