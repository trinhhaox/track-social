/**
 * Maps raw Apify dataset items into our domain shapes. Actor outputs vary between
 * actors and versions, so every field is read defensively from several known names.
 */
import type { CollectedComment, CollectedPost } from "../domain-types.ts";

type Raw = Record<string, unknown>;

const isObject = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

function str(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/** Accepts numbers and numeric strings such as "1,2K" or "3.4M" as Facebook renders them. */
export function toCount(...values: unknown[]): number {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.round(v));
    if (typeof v === "string" && v.trim()) {
      const match = v.trim().replace(/\s/g, "").match(/^([\d.,]+)([KkMm])?$/);
      if (!match?.[1]) continue;
      const unit = match[2]?.toLowerCase();
      // "1,2K" (vi) and "1.2K" (en) are decimals; "1,234" without unit is thousands.
      const numeric = unit ? Number(match[1].replace(",", ".")) : Number(match[1].replace(/[.,]/g, ""));
      if (!Number.isFinite(numeric)) continue;
      const multiplier = unit === "k" ? 1_000 : unit === "m" ? 1_000_000 : 1;
      return Math.round(numeric * multiplier);
    }
  }
  return 0;
}

function toIso(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) {
      // Unix seconds vs milliseconds.
      return new Date(v < 1e12 ? v * 1000 : v).toISOString();
    }
    if (typeof v === "string" && v.trim()) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  return null;
}

/** Strips tracking params so the same post submitted twice maps to one row. */
export function canonicalPostUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hostname = u.hostname.replace(/^(m|mbasic|web|business)\./, "www.").replace(/^facebook\.com$/, "www.facebook.com");
    for (const key of [...u.searchParams.keys()]) {
      if (!["story_fbid", "id", "fbid", "v", "set"].includes(key)) u.searchParams.delete(key);
    }
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url.trim();
  }
}

export function isFacebookUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url.trim());
    return (protocol === "https:" || protocol === "http:") && /(^|\.)(facebook\.com|fb\.watch|fb\.com)$/i.test(hostname);
  } catch {
    return false;
  }
}

/** Scraped URLs are rendered as links on the public page, so only Facebook http(s) URLs pass. */
const safeFacebookUrl = (url: string | null): string | null => (url && isFacebookUrl(url) ? url : null);

export function normalizePost(item: unknown): CollectedPost | null {
  if (!isObject(item)) return null;
  const user = isObject(item.user) ? item.user : isObject(item.author) ? item.author : {};
  const url = safeFacebookUrl(str(item.url, item.postUrl, item.topLevelUrl, item.facebookUrl));
  if (!url) return null;
  return {
    fbPostId: str(item.postId, item.post_id),
    url: canonicalPostUrl(url),
    authorId: str(user.id, item.facebookId, item.pageId),
    authorName: str(user.name, item.pageName),
    authorUrl: safeFacebookUrl(str(user.profileUrl, user.url)),
    text: str(item.text, item.message, item.postText),
    postedAt: toIso(item.time, item.date, item.timestamp, item.publishedAt),
    reactions: toCount(item.reactionsCount, item.likes, item.likesCount, item.reactions),
    comments: toCount(item.comments, item.commentsCount),
    shares: toCount(item.shares, item.sharesCount),
  };
}

/**
 * Identity for "unique commenter" counting: profile URL is the most stable signal,
 * then profile id, then display name as a last resort.
 */
export function commenterKey(profileUrl: string | null, profileId: string | null, name: string | null): string | null {
  if (profileUrl) {
    try {
      const u = new URL(profileUrl);
      const id = u.searchParams.get("id");
      const path = u.pathname.replace(/\/$/, "").toLowerCase();
      return id ? `fb:${id}` : `url:${path}`;
    } catch {
      /* fall through to the next identity signal */
    }
  }
  if (profileId) return `id:${profileId}`;
  if (name) return `name:${name.toLowerCase()}`;
  return null;
}

export function normalizeComment(item: unknown): (CollectedComment & { postUrl: string | null }) | null {
  if (!isObject(item)) return null;
  const commentId = str(item.commentId, item.id);
  const profileUrl = safeFacebookUrl(str(item.profileUrl, item.authorUrl));
  const profileId = str(item.profileId, item.authorId);
  const profileName = str(item.profileName, item.authorName);
  const profileKey = commenterKey(profileUrl, profileId, profileName);
  if (!commentId || !profileKey) return null;
  return {
    commentId,
    profileKey,
    profileName,
    profileUrl,
    text: str(item.text),
    commentedAt: toIso(item.date, item.publishedAt),
    postUrl: str(item.inputUrl, item.facebookUrl, item.postUrl),
  };
}

/** True when the text contains any of the campaign hashtags (case/diacritic-insensitive). */
export function containsHashtag(text: string | null, hashtags: string[]): boolean {
  if (!text) return false;
  const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase();
  const folded = fold(text);
  const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return hashtags.some((tag) => new RegExp(`#${escape(fold(tag))}(?![\\p{L}\\p{N}_])`, "u").test(folded));
}
