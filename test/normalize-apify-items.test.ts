import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalPostUrl, commenterKey, containsHashtag, isFacebookUrl, normalizeComment, normalizePost, toCount,
} from "../src/collectors/normalize-apify-items.ts";

describe("toCount", () => {
  it("handles numbers, abbreviations and junk", () => {
    assert.equal(toCount(42), 42);
    assert.equal(toCount("1,2K"), 1200);
    assert.equal(toCount("3.4M"), 3_400_000);
    assert.equal(toCount("1,234"), 1234);
    assert.equal(toCount(undefined, null, "abc"), 0);
    assert.equal(toCount(-5), 0);
    assert.equal(toCount(undefined, "7"), 7);
  });
});

describe("canonicalPostUrl", () => {
  it("strips tracking params and mobile hosts", () => {
    assert.equal(
      canonicalPostUrl("https://m.facebook.com/user/posts/pfbid0abc/?mibextid=xyz&__cft__=1#x"),
      "https://www.facebook.com/user/posts/pfbid0abc",
    );
    assert.equal(
      canonicalPostUrl("https://www.facebook.com/permalink.php?story_fbid=123&id=456&ref=share"),
      "https://www.facebook.com/permalink.php?story_fbid=123&id=456",
    );
  });
  it("returns invalid input trimmed", () => assert.equal(canonicalPostUrl("  not a url "), "not a url"));
});

describe("isFacebookUrl", () => {
  it("accepts facebook hosts only", () => {
    assert.ok(isFacebookUrl("https://www.facebook.com/x/posts/1"));
    assert.ok(isFacebookUrl("https://fb.watch/abc"));
    assert.ok(!isFacebookUrl("https://evil-facebook.com.attacker.io/x"));
    assert.ok(!isFacebookUrl("javascript:alert(1)"));
    assert.ok(!isFacebookUrl(""));
  });
});

describe("normalizePost", () => {
  it("maps hashtag-scraper output", () => {
    const post = normalizePost({
      postId: "5764693963629781",
      url: "https://www.facebook.com/groups/1/posts/5764693963629781/",
      text: "Hello #TrigXanh",
      date: "2026-10-01T07:12:00.000Z",
      user: { id: "100", name: "Lan", profileUrl: "https://www.facebook.com/lan" },
      likesCount: 5, sharesCount: 1, commentsCount: 21,
    });
    assert.deepEqual(post, {
      fbPostId: "5764693963629781",
      url: "https://www.facebook.com/groups/1/posts/5764693963629781",
      authorId: "100", authorName: "Lan", authorUrl: "https://www.facebook.com/lan",
      text: "Hello #TrigXanh", postedAt: "2026-10-01T07:12:00.000Z",
      reactions: 5, comments: 21, shares: 1,
    });
  });
  it("maps posts-scraper output with unix timestamp", () => {
    const post = normalizePost({ postId: "1", url: "https://www.facebook.com/p/1", timestamp: 1768914005, likes: 146, comments: 3, shares: 27 });
    assert.equal(post?.postedAt, "2026-01-20T13:00:05.000Z");
    assert.equal(post?.reactions, 146);
  });
  it("drops non-Facebook or script URLs before they reach the public page", () => {
    assert.equal(normalizePost({ postId: "1", url: "javascript:alert(1)" }), null);
    assert.equal(normalizePost({ postId: "1", url: "https://evil.example/p" }), null);
    const post = normalizePost({ url: "https://facebook.com/p/1", user: { profileUrl: "javascript:alert(1)" } });
    assert.equal(post?.authorUrl, null);
    assert.equal(post?.url, "https://www.facebook.com/p/1");
  });
  it("rejects items without url", () => {
    assert.equal(normalizePost({ postId: "1" }), null);
    assert.equal(normalizePost(null), null);
  });
});

describe("commenter identity", () => {
  it("prefers profile url, then id, then name", () => {
    assert.equal(commenterKey("https://www.facebook.com/Lan.Nguyen/", "x", "Lan"), "url:/lan.nguyen");
    assert.equal(commenterKey("https://www.facebook.com/profile.php?id=42", null, null), "fb:42");
    assert.equal(commenterKey(null, "pfbid9", "Lan"), "id:pfbid9");
    assert.equal(commenterKey(null, null, "Lan"), "name:lan");
    assert.equal(commenterKey(null, null, null), null);
  });
  it("normalizes a comments-scraper item", () => {
    const c = normalizeComment({
      commentId: "883", text: "Hay quá", date: "2026-06-05T04:06:45.000Z", profileName: "Laurie",
      profileId: "pfbid02", inputUrl: "https://www.facebook.com/x/posts/1",
    });
    assert.equal(c?.profileKey, "id:pfbid02");
    assert.equal(c?.postUrl, "https://www.facebook.com/x/posts/1");
  });
});

describe("containsHashtag", () => {
  it("matches case- and diacritic-insensitively, whole tag only", () => {
    assert.ok(containsHashtag("Mình tham gia #SốngXanh nhé", ["songxanh"]));
    assert.ok(containsHashtag("#trigxanh", ["TrigXanh"]));
    assert.ok(!containsHashtag("#trigxanh2026", ["trigxanh"]));
    assert.ok(!containsHashtag("trigxanh không có dấu #", ["trigxanh"]));
    assert.ok(!containsHashtag(null, ["trigxanh"]));
    assert.ok(containsHashtag("#a.b test", ["a.b"]));
  });
});
