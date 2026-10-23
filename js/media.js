/**
 * Turn a feed URL into an inline embed that starts muted or paused.
 * Only https URLs on the expected host are accepted.
 */

const YOUTUBE_ID = /^[\w-]{11}$/;

function asHttpUrl(input) {
  if (typeof input !== "string" || !input.trim()) return null;
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return url;
}

function host(url) {
  return url.hostname.replace(/^www\./, "").toLowerCase();
}

export function youtubeEmbed(input) {
  const url = asHttpUrl(input);
  if (!url) return "";
  const name = host(url);
  let id = "";
  if (name === "youtu.be") {
    id = url.pathname.split("/").filter(Boolean)[0] || "";
  } else if (
    name === "youtube.com" ||
    name === "m.youtube.com" ||
    name === "music.youtube.com" ||
    name === "youtube-nocookie.com"
  ) {
    if (url.pathname === "/watch") {
      id = url.searchParams.get("v") || "";
    } else {
      const parts = url.pathname.split("/").filter(Boolean);
      if (["embed", "shorts", "live", "v"].includes(parts[0])) id = parts[1] || "";
    }
  }
  if (!YOUTUBE_ID.test(id)) return "";
  const params = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
  });
  return `https://www.youtube-nocookie.com/embed/${id}?${params}`;
}

export function tiktokEmbed(input) {
  const url = asHttpUrl(input);
  if (!url) return "";
  const name = host(url);
  if (name !== "tiktok.com" && !name.endsWith(".tiktok.com")) return "";
  const match = url.pathname.match(/\/video\/(\d{6,})/);
  if (!match) return "";
  const params = new URLSearchParams({
    autoplay: "0",
    muted: "1",
    loop: "0",
    controls: "1",
    description: "0",
    music_info: "0",
    rel: "0",
  });
  return `https://www.tiktok.com/player/v1/${match[1]}?${params}`;
}

export function instagramEmbed(input) {
  const url = asHttpUrl(input);
  if (!url) return "";
  const name = host(url);
  if (name !== "instagram.com" && name !== "instagr.am") return "";
  const match = url.pathname.match(/\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]{5,})/);
  if (!match) return "";
  const kind = url.pathname.includes("/reel") ? "reel" : "p";
  return `https://www.instagram.com/${kind}/${match[1]}/embed`;
}

export function embedFor(type, input) {
  if (type === "youtube") return youtubeEmbed(input);
  if (type === "tiktok") return tiktokEmbed(input);
  if (type === "instagram") return instagramEmbed(input);
  return "";
}
