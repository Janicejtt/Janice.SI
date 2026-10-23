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
const POSTER_NAME = /-poster\.[^.]+$/i;

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
    if (!name || name.startsWith(".") || POSTER_NAME.test(name)) continue;
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
    const type = IMAGE_EXT.has(ext) ? "image" : VIDEO_EXT.has(ext) ? "video" : "";
    if (!type) continue;
    const path = typeof entry.path === "string" && entry.path ? entry.path : `${ART_DIR}/${name}`;
    const download = typeof entry.download_url === "string" ? entry.download_url : "";
    files.push({ name, path, type, download });
  }
  return files;
}

export function mediaKey(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || /^(javascript|data|vbscript):/i.test(raw)) return "";
  let path = raw.split("#")[0].split("?")[0].replace(/\\/g, "/");
  try {
    path = new URL(raw, "https://example.invalid/").pathname;
  } catch {
    /* keep the trimmed path */
  }
  path = path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  try {
    path = decodeURIComponent(path);
  } catch {
    /* keep the encoded path */
  }
  return path.toLowerCase();
}

function fileStem(name) {
  const base = (name || "").toLowerCase();
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

function isPosterFile(file, posterKeys) {
  const name = file.name || "";
  if (POSTER_NAME.test(name)) return true;
  const key = mediaKey(file.path || name);
  return Boolean(key && posterKeys.has(key));
}

export function mergeArt(feedItems, files) {
  const posterKeys = new Set();
  const videoStems = new Set();
  for (const item of feedItems) {
    const poster = mediaKey(item.poster);
    if (poster) posterKeys.add(poster);
    if (item.type === "video") {
      const stem = fileStem(item.src || item.url);
      if (stem) videoStems.add(stem.split("/").pop());
    }
  }
  for (const file of files) {
    if (file.type === "video") videoStems.add(fileStem(file.name));
  }
  const byPath = new Map();
  for (const file of files) {
    const key = mediaKey(file.path || file.name);
    if (!key || isPosterFile(file, posterKeys)) continue;
    if (file.type === "image" && videoStems.has(fileStem(file.name))) continue;
    byPath.set(key, file);
  }
  const merged = [];
  for (const item of feedItems) {
    const next = { ...item };
    if (next.type === "image" || next.type === "video") {
      const key = mediaKey(next.src || next.url);
      const file = key ? byPath.get(key) : undefined;
      if (file) {
        if (!next.src) next.src = file.path;
        if (file.download) next.download = file.download;
        byPath.delete(key);
      } else if (key) {
        byPath.delete(key);
      }
    }
    merged.push(next);
  }
  const extras = [...byPath.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
  );
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
