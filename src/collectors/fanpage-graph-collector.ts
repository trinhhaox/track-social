/**
 * Reads posts (including visitor posts) and their comments from a Facebook Page the
 * campaign owner manages, via the official Graph API and a Page access token.
 */
import type { AppConfig } from "../config.ts";
import type { CollectedComment, CollectedPost } from "../domain-types.ts";
import { commenterKey, containsHashtag } from "./normalize-apify-items.ts";

const MAX_PAGES = 50;

interface GraphPost {
  id: string;
  message?: string;
  created_time?: string;
  permalink_url?: string;
  from?: { id: string; name: string };
  shares?: { count: number };
  reactions?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
}

interface GraphComment {
  id: string;
  message?: string;
  created_time?: string;
  from?: { id: string; name: string };
}

interface GraphPage<T> {
  data: T[];
  paging?: { next?: string };
}

function credentials(config: AppConfig): { pageId: string; token: string } | null {
  if (!config.FB_PAGE_ID || !config.FB_PAGE_TOKEN) return null;
  return { pageId: config.FB_PAGE_ID, token: config.FB_PAGE_TOKEN };
}

async function graphGetAll<T>(firstUrl: string, token: string): Promise<T[]> {
  const results: T[] = [];
  let next: string | undefined = firstUrl;
  for (let page = 0; next && page < MAX_PAGES; page++) {
    const response: Response = await fetch(next, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await response.json()) as GraphPage<T> & { error?: { message: string } };
    if (!response.ok || body.error) {
      throw new Error(`Graph API lỗi ${response.status}: ${body.error?.message ?? "không rõ"}`);
    }
    results.push(...body.data);
    next = body.paging?.next;
  }
  return results;
}

export function isFanpageConfigured(config: AppConfig): boolean {
  return credentials(config) !== null;
}

/** Page feed posts created inside the campaign window that carry a campaign hashtag. */
export async function fetchFanpagePosts(config: AppConfig): Promise<CollectedPost[]> {
  const creds = credentials(config);
  if (!creds) return [];
  const fields = "id,message,created_time,permalink_url,from,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)";
  const params = new URLSearchParams({
    fields,
    // Unix timestamps: Graph reads bare dates as UTC, but the campaign runs on Vietnam time.
    since: String(Date.parse(`${config.CAMPAIGN_START}T00:00:00+07:00`) / 1000),
    until: String(Date.parse(`${config.CAMPAIGN_END}T23:59:59+07:00`) / 1000),
    limit: "100",
  });
  const url = `https://graph.facebook.com/${config.FB_GRAPH_VERSION}/${encodeURIComponent(creds.pageId)}/feed?${params}`;
  const posts = await graphGetAll<GraphPost>(url, creds.token);
  return posts
    .filter((p) => containsHashtag(p.message ?? null, config.CAMPAIGN_HASHTAGS))
    .map((p) => ({
      fbPostId: p.id,
      url: p.permalink_url ?? `https://www.facebook.com/${p.id}`,
      authorId: p.from?.id ?? null,
      authorName: p.from?.name ?? null,
      authorUrl: p.from ? `https://www.facebook.com/${p.from.id}` : null,
      text: p.message ?? null,
      postedAt: p.created_time ? new Date(p.created_time).toISOString() : null,
      reactions: p.reactions?.summary?.total_count ?? 0,
      comments: p.comments?.summary?.total_count ?? 0,
      shares: p.shares?.count ?? 0,
    }));
}

export async function fetchFanpageComments(config: AppConfig, fbPostId: string): Promise<CollectedComment[]> {
  const creds = credentials(config);
  if (!creds) return [];
  const params = new URLSearchParams({ fields: "id,message,created_time,from", filter: "stream", limit: "100" });
  const url = `https://graph.facebook.com/${config.FB_GRAPH_VERSION}/${encodeURIComponent(fbPostId)}/comments?${params}`;
  const comments = await graphGetAll<GraphComment>(url, creds.token);
  return comments.flatMap((c) => {
    const key = commenterKey(null, c.from?.id ?? null, c.from?.name ?? null);
    if (!key) return [];
    return [{
      commentId: c.id,
      profileKey: key,
      profileName: c.from?.name ?? null,
      profileUrl: c.from ? `https://www.facebook.com/${c.from.id}` : null,
      text: c.message ?? null,
      commentedAt: c.created_time ? new Date(c.created_time).toISOString() : null,
    }];
  });
}
