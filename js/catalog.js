/**
 * Edit mode and the public art folder.
 * Files dropped in assets/art are listed from the GitHub contents API.
 * content/feed.json sets order, captions, and embed links.
 */

export const ART_DIR = "assets/art";
export const UPLOAD_URL = "https://github.com/Janicejtt/Janice.SI/upload/main/assets/art";
export const CONTENTS_URL =
  "https://api.github.com/repos/Janicejtt/Janice.SI/contents/assets/art?ref=main";

const IMAGE_EXT = new Set(["avif", "gif", "jpeg", "jpg", "png", "svg", "webp"]);
const VIDEO_EXT = new Set(["m4v", "mov", "mp4", "webm"]);
const OFF_VALUES = new Set(["0", "false", "no", "off"]);

export function wantsEdit(search) {
  const params = new URLSearchParams(search || "");
  if (!params.has("edit")) return null;
  const value = (params.get("edit") || "").trim().toLowerCase();
  return !OFF_VALUES.has(value);
}

export function filesFromContents(data) {
  if (!Array.isArray(data)) return [];
  const files = [];
  for (const entry of data) {
    if (!entry || entry.type !== "file") continue;
    const name = typeof entry.name === "string" ? entry.name : "";
    if (!name || name.startsWith(".")) continue;
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
    const type = IMAGE_EXT.has(ext) ? "image" : VIDEO_EXT.has(ext) ? "video" : "";
    if (!type) continue;
    const path = typeof entry.path === "string" && entry.path ? entry.path : `${ART_DIR}/${name}`;
    const download = typeof entry.download_url === "string" ? entry.download_url : "";
    files.push({ name, path, type, download });
  }
  return files;
}

function fileName(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  let path = raw.split("#")[0].split("?")[0];
  try {
    path = new URL(raw, "https://example.invalid/").pathname;
  } catch {
    /* keep the trimmed path */
  }
  const parts = path.split("/").filter(Boolean);
  const last = parts[parts.length - 1] || "";
  try {
    return decodeURIComponent(last).toLowerCase();
  } catch {
    return last.toLowerCase();
  }
}

export function mergeArt(feedItems, files) {
  const byName = new Map();
  for (const file of files) byName.set(file.name.toLowerCase(), file);
  const used = new Set();
  const merged = [];
  for (const item of feedItems) {
    const next = { ...item };
    if (next.type === "image" || next.type === "video") {
      const name = fileName(next.src || next.url);
      const file = name ? byName.get(name) : undefined;
      if (file) {
        used.add(file.name.toLowerCase());
        if (!next.src) next.src = file.path;
        if (file.download) next.download = file.download;
      }
    }
    merged.push(next);
  }
  const extras = files
    .filter((file) => !used.has(file.name.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  for (const file of extras) {
    merged.push({
      type: file.type,
      src: file.path,
      url: "",
      poster: "",
      full: "",
      caption: "",
      alt: "Artwork by Janice SI",
      download: file.download || "",
    });
  }
  return merged;
}
