import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

function loadModule(entryPoint) {
  const output = buildSync({
    entryPoints: [entryPoint],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    write: false,
    alias: { "@": "./src" },
  }).outputFiles[0].text;
  const module = { exports: {} };
  new Function("exports", "module", output)(module.exports, module);
  return module.exports;
}

const links = loadModule("src/features/itinerary/utils/sharedLinks.ts");
const places = loadModule("src/features/trips/data/destinations.ts");

test("finds the link inside shared text", () => {
  assert.equal(links.extractLink("Check this out! https://www.instagram.com/reel/C9xYz12AbC/?igsh=abc123."), "https://www.instagram.com/reel/C9xYz12AbC/?igsh=abc123");
  assert.equal(links.extractLink("no link here"), null);
});

test("Instagram reels and posts drop tracking and keep the account when present", () => {
  assert.deepEqual(links.classifyLink("https://www.instagram.com/reel/C9xYz12AbC/?igsh=abc"), { url: "https://www.instagram.com/reel/C9xYz12AbC/", provider: "instagram", video: true });
  const post = links.classifyLink("https://instagram.com/natgeo/p/Babc_123/?utm_source=ig_web");
  assert.equal(post.url, "https://www.instagram.com/p/Babc_123/");
  assert.equal(post.video, false);
  assert.equal(post.author, "natgeo");
  assert.equal(links.classifyLink("https://www.instagram.com/reels/XYZ/").url, "https://www.instagram.com/reel/XYZ/");
});

test("TikTok videos and short links", () => {
  const video = links.classifyLink("https://www.tiktok.com/@travelwithsam/video/7412345678901234567?is_from_webapp=1");
  assert.equal(video.url, "https://www.tiktok.com/@travelwithsam/video/7412345678901234567");
  assert.equal(video.author, "travelwithsam");
  assert.equal(links.classifyLink("https://vm.tiktok.com/ZMabc123/").provider, "tiktok");
});

test("YouTube Shorts, watch and youtu.be links", () => {
  assert.deepEqual(links.classifyLink("https://youtube.com/shorts/dQw4w9WgXcQ?si=xyz"), { url: "https://www.youtube.com/shorts/dQw4w9WgXcQ", provider: "youtube", video: true, youtubeId: "dQw4w9WgXcQ" });
  assert.equal(links.classifyLink("https://youtu.be/dQw4w9WgXcQ?t=10").youtubeId, "dQw4w9WgXcQ");
  assert.equal(links.classifyLink("https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share").url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
});

test("other links keep real query parameters but not tracking ones", () => {
  const web = links.classifyLink("https://www.timeout.com/tokyo/bars?page=2&utm_source=x&fbclid=y");
  assert.deepEqual(web, { url: "https://www.timeout.com/tokyo/bars?page=2", provider: "web", video: false });
  assert.equal(links.classifyLink("ftp://example.com/file"), null);
});

test("finds the most specific place in a caption", () => {
  assert.equal(places.findPlaceInText("3 perfect days in Bali 🇮🇩 #travel").label, "Bali, Indonesia");
  assert.equal(places.findPlaceInText("Hidden ramen spots in Kyoto, Japan").label, "Kyoto, Japan");
  assert.equal(places.findPlaceInText("best of #tokyo food").label, "Tokyo, Japan");
  assert.equal(places.findPlaceInText("Why everyone is moving to Portugal").kind, "country");
  assert.equal(places.findPlaceInText("such a nice split second"), null);
});

const shareLink = loadModule("src/features/itinerary/utils/shareLink.ts");

test("reads the iOS Share Extension's save-link deep link", () => {
  assert.equal(shareLink.sharedTextFromLink("nomadsafe://save-link?url=https%3A%2F%2Fyoutu.be%2Fabc&text=3%20days%20in%20Bali"), "3 days in Bali https://youtu.be/abc");
  assert.equal(shareLink.sharedTextFromLink("/save-link?url=https%3A%2F%2Fexample.com"), "https://example.com");
  assert.equal(shareLink.sharedTextFromLink("nomadsafe://save-link"), "");
  assert.equal(shareLink.sharedTextFromLink("nomadsafe://join/ABC"), null);
});

test("embeds for saved links", () => {
  assert.deepEqual(links.embedFor({ url: "https://www.instagram.com/reel/C9xYz12AbC/", provider: "instagram" }), { kind: "page", uri: "https://www.instagram.com/reel/C9xYz12AbC/embed/" });
  assert.deepEqual(links.embedFor({ url: "https://www.tiktok.com/@sam/video/7412345678901234567", provider: "tiktok" }), { kind: "page", uri: "https://www.tiktok.com/embed/v2/7412345678901234567" });
  assert.deepEqual(links.embedFor({ url: "https://www.youtube.com/shorts/dQw4w9WgXcQ", provider: "youtube" }), { kind: "youtube", id: "dQw4w9WgXcQ" });
  assert.equal(links.embedFor({ url: "https://vm.tiktok.com/ZMabc123/", provider: "tiktok" }), null);
  assert.equal(links.embedFor({ url: "https://www.timeout.com/tokyo", provider: "web" }), null);
});
