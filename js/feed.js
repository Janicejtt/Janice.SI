import { CONTENTS_URL, UPLOAD_URL, filesFromContents, mergeArt, wantsEdit } from "./catalog.js";
import { embedFor } from "./media.js";

const BATCH = 2;
const CACHE_KEY = "janice.si.art";
const CACHE_MS = 60_000;
const EDIT_KEY = "janice.si.edit";
const TYPES = new Set(["image", "video", "youtube", "tiktok", "instagram"]);

const feed = document.querySelector("#feed");
const statusEl = document.querySelector("#feed-status");
const sentinel = document.querySelector("#sentinel");
const lightbox = document.querySelector("#lightbox");
const lightboxImg = document.querySelector("#lightbox-img");
const lightboxCaption = document.querySelector("#lightbox-caption");

let items = [];
let cursor = 0;
let total = 0;
let opener = null;
let observer = null;
let finished = false;
const editMode = readEditMode();

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function resource(value) {
  const trimmed = text(value);
  if (!trimmed || /^(javascript|data|vbscript):/i.test(trimmed)) return "";
  return trimmed;
}

function positiveInt(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  return String(Math.round(number));
}

function normalize(raw) {
  if (!raw || typeof raw !== "object") return null;
  const type = text(raw.type).toLowerCase();
  if (!TYPES.has(type)) return null;
  const item = {
    type,
    src: resource(raw.src),
    url: resource(raw.url),
    poster: resource(raw.poster),
    full: resource(raw.full),
    caption: text(raw.caption),
    alt: text(raw.alt),
    download: "",
    width: positiveInt(raw.width),
    height: positiveInt(raw.height),
  };
  if ((type === "image" || type === "video") && !item.src && !item.url) return null;
  if (!item.alt) item.alt = item.caption || "Artwork by Janice SI";
  return item;
}

function readEditMode() {
  let stored = "";
  try {
    stored = localStorage.getItem(EDIT_KEY) || "";
  } catch {
    stored = "";
  }
  const requested = wantsEdit(location.search);
  if (requested === null) return stored === "1";
  try {
    if (requested) localStorage.setItem(EDIT_KEY, "1");
    else localStorage.removeItem(EDIT_KEY);
  } catch {
    /* private mode still honors this visit */
  }
  return requested;
}

function readCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached || !Array.isArray(cached.files)) return null;
    return cached;
  } catch {
    return null;
  }
}

async function listRepoArt() {
  const cached = readCache();
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.files;
  try {
    const response = await fetch(CONTENTS_URL, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error(String(response.status));
    const files = filesFromContents(await response.json());
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), files }));
    } catch {
      /* ignore quota or private mode */
    }
    return files;
  } catch {
    return cached ? cached.files : [];
  }
}

function locationOf(item) {
  return item.src || item.url;
}

function el(tag, className, attrs = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value);
  }
  return node;
}

function captionBar(caption) {
  if (!caption) return null;
  const bar = el("p", "caption");
  bar.textContent = caption;
  return bar;
}

function playButton(label) {
  const button = el("button", "play-btn", { type: "button" });
  button.setAttribute("aria-label", label);
  const pill = el("span", "play-pill");
  pill.setAttribute("aria-hidden", "true");
  pill.innerHTML =
    '<svg viewBox="0 0 12 14" width="12" height="14" focusable="false"><path d="M1 1.2v11.6L11 7 1 1.2z" fill="currentColor"/></svg><span>Play</span>';
  button.append(pill);
  return button;
}

function marfaLayer() {
  const layer = el("span", "marfa");
  layer.setAttribute("aria-hidden", "true");
  for (const name of ["violet", "magenta", "amber", "terra", "beige"]) {
    layer.append(el("span", `marfa-blob marfa-${name}`));
  }
  return layer;
}

function platformPoster(kind) {
  const poster = el("div", `poster poster-${kind}`);
  poster.append(marfaLayer());
  const name = el("p", "kind");
  const labels = { youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram" };
  name.textContent = labels[kind] || kind;
  poster.append(name);
  return poster;
}

function noteIn(media, message) {
  const note = el("p", "media-note");
  note.textContent = message;
  media.querySelector(".media-note")?.remove();
  media.append(note);
}

function stopOtherMedia(except) {
  feed.querySelectorAll("video").forEach((video) => {
    if (video !== except && !video.paused) video.pause();
  });
  feed.querySelectorAll("iframe.embed").forEach((frame) => {
    if (frame === except) return;
    const media = frame.closest(".card-media");
    frame.remove();
    const button = media?.querySelector(".play-btn");
    if (button) button.hidden = false;
    media?.classList.remove("is-playing");
  });
}

function useDownloadOnError(node, item, rewrite) {
  node.addEventListener("error", () => {
    if (item.download && node.dataset.fallback !== "1") {
      node.dataset.fallback = "1";
      node.src = typeof rewrite === "function" ? rewrite(item.download) : item.download;
      return;
    }
    if (node.tagName === "IMG") node.alt = `${item.alt} (image failed to load)`;
  });
}

function frameSrc(src, poster) {
  if (!src || poster || src.includes("#")) return src;
  return `${src}#t=0.1`;
}

function audioPresence(video) {
  if (typeof video.mozHasAudio === "boolean") return video.mozHasAudio;
  const tracks = video.audioTracks;
  if (tracks && typeof tracks.length === "number") return tracks.length > 0;
  return null;
}

function soundButton(video, play) {
  const button = el("button", "sound", { type: "button" });
  button.innerHTML =
    '<svg class="sound-off" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4.5 9.5h3.2L12 5.8v12.4l-4.3-3.7H4.5v-5z"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M16 10l4 4m0-4-4 4"/></svg>' +
    '<svg class="sound-on" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4.5 9.5h3.2L12 5.8v12.4l-4.3-3.7H4.5v-5z"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M15.6 9.2a3.4 3.4 0 0 1 0 5.6M18 7a6.2 6.2 0 0 1 0 10"/></svg>';
  const paint = () => {
    const on = !video.muted;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.setAttribute("aria-label", on ? "Mute" : "Unmute");
  };
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const turnOn = video.muted;
    if (turnOn) {
      feed.querySelectorAll("video").forEach((other) => {
        if (other !== video) other.muted = true;
      });
      video.defaultMuted = false;
      video.removeAttribute("muted");
      video.muted = false;
      video.volume = 1;
      play.hidden = true;
      const pending = video.play();
      if (pending && typeof pending.catch === "function") {
        pending.catch(() => {
          play.hidden = false;
        });
      }
    } else {
      video.muted = true;
    }
    paint();
  });
  video.addEventListener("volumechange", paint);
  const reveal = () => {
    const presence = audioPresence(video);
    if (presence === false) button.hidden = true;
    else if (presence === true) button.hidden = false;
  };
  video.addEventListener("loadedmetadata", reveal);
  video.addEventListener("loadeddata", reveal);
  if (video.readyState >= 1) reveal();
  paint();
  return button;
}

function renderImage(item, eager) {
  const src = locationOf(item);
  const button = el("button", "zoom", { type: "button" });
  const hidden = el("span", "visually-hidden");
  hidden.textContent = "View full size: ";
  const img = el("img", null, {
    src,
    alt: item.alt,
    width: "800",
    height: "1000",
    decoding: "async",
    loading: eager ? "eager" : "lazy",
  });
  useDownloadOnError(img, item);
  button.append(hidden, img);
  button.addEventListener("click", () => {
    const shown = img.currentSrc || img.src;
    openLightbox(item.full || shown, item.alt, item.caption, button);
  });
  return button;
}

function renderFileVideo(item, eager) {
  const src = frameSrc(locationOf(item), item.poster);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const video = el("video", null, {
    src,
    poster: item.poster || undefined,
    preload: item.poster && eager && !reduceMotion ? "auto" : "metadata",
    playsinline: "",
    "webkit-playsinline": "",
    muted: "",
    loop: "",
    autoplay: reduceMotion ? false : "",
    width: item.width || undefined,
    height: item.height || undefined,
  });
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.loop = true;
  video.setAttribute("aria-label", item.alt);
  useDownloadOnError(video, item, (url) => frameSrc(url, item.poster));
  const button = playButton(`Play video: ${item.alt}`);
  const start = () => {
    button.hidden = true;
    if (!video.muted) return;
    video.muted = true;
    const pending = video.play();
    if (pending && typeof pending.catch === "function") {
      pending.catch(() => {
        button.hidden = false;
      });
    }
  };
  button.addEventListener("click", start);
  const sound = soundButton(video, button);
  if (reduceMotion) {
    video.autoplay = false;
    video.removeAttribute("autoplay");
  } else {
    video.autoplay = true;
    button.hidden = true;
    if (video.readyState >= 2) start();
    else video.addEventListener("loadeddata", start, { once: true });
  }
  return [video, button, sound];
}

function renderEmbed(item) {
  const button = playButton(`Play ${item.type} video: ${item.alt}`);
  button.addEventListener("click", () => {
    const media = button.closest(".card-media");
    const link = item.url || item.src;
    if (!link) {
      noteIn(media, "Add a video link in content/feed.json.");
      return;
    }
    const embedUrl = embedFor(item.type, link);
    if (!embedUrl) {
      noteIn(
        media,
        "This link can’t be embedded. Use a full YouTube, TikTok, or Instagram video URL."
      );
      return;
    }
    stopOtherMedia(null);
    const frame = el("iframe", "embed", {
      src: embedUrl,
      title: item.alt,
      loading: "lazy",
      allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
      referrerpolicy: "strict-origin-when-cross-origin",
    });
    frame.setAttribute("allowfullscreen", "");
    media.dataset.ratio = item.type;
    media.classList.add("is-playing");
    button.hidden = true;
    media.querySelector(".media-note")?.remove();
    media.append(frame);
  });
  return [platformPoster(item.type), button];
}

function renderCard(item, index) {
  const card = el("article", "card");
  card.dataset.index = String(index);
  const media = el("div", "card-media");
  if (item.type === "image") {
    media.append(renderImage(item, index < 2));
  } else if (item.type === "video") {
    media.classList.add("is-video");
    media.append(...renderFileVideo(item, index < 2));
  } else {
    media.append(...renderEmbed(item));
  }
  card.append(media);
  const bar = captionBar(item.caption);
  if (bar) card.append(bar);
  return card;
}

function renderAddCard() {
  const card = el("article", "card add-card");
  const link = el("a", "add-link", {
    href: UPLOAD_URL,
    target: "_blank",
    rel: "noopener noreferrer",
  });
  link.setAttribute("aria-label", "Add art on GitHub (opens in a new tab)");
  const panel = el("span", "marfa-panel");
  const plus = el("span", "plus");
  plus.setAttribute("aria-hidden", "true");
  plus.textContent = "+";
  panel.append(marfaLayer(), plus);
  const note = el("p", "add-note");
  note.textContent = "New files in assets/art show up on their own.";
  link.append(panel);
  card.append(link, note);
  return card;
}

function appendBatch() {
  if (!items.length || cursor >= total) return false;
  const fragment = document.createDocumentFragment();
  let added = 0;
  while (added < BATCH && cursor < total) {
    fragment.append(renderCard(items[cursor], cursor));
    cursor += 1;
    added += 1;
  }
  feed.insertBefore(fragment, sentinel);
  return true;
}

function finish() {
  if (finished) return;
  finished = true;
  observer?.disconnect();
  if (editMode && sentinel.isConnected) feed.insertBefore(renderAddCard(), sentinel);
  if (sentinel.isConnected) sentinel.remove();
}

function fillAhead() {
  if (finished) return;
  if (cursor >= total) {
    finish();
    return;
  }
  appendBatch();
  if (cursor >= total) {
    finish();
    return;
  }
  requestAnimationFrame(() => {
    if (finished || !sentinel.isConnected) return;
    const rect = sentinel.getBoundingClientRect();
    if (rect.top <= window.innerHeight + 700) fillAhead();
  });
}

function showError(message) {
  statusEl.classList.remove("visually-hidden");
  statusEl.textContent = message;
  if (editMode && sentinel.isConnected) feed.insertBefore(renderAddCard(), sentinel);
  if (sentinel.isConnected) sentinel.remove();
  finished = true;
}

function openLightbox(src, alt, caption, button) {
  opener = button;
  lightboxImg.src = src;
  lightboxImg.alt = alt;
  lightboxCaption.textContent = caption || "";
  lightboxCaption.hidden = !caption;
  if (caption) {
    lightbox.setAttribute("aria-labelledby", "lightbox-caption");
    lightbox.removeAttribute("aria-label");
  } else {
    lightbox.removeAttribute("aria-labelledby");
    lightbox.setAttribute("aria-label", alt || "Full size artwork");
  }
  if (typeof lightbox.showModal === "function") lightbox.showModal();
  else lightbox.setAttribute("open", "");
}

function closeLightbox() {
  lightboxImg.removeAttribute("src");
  if (lightbox.open && typeof lightbox.close === "function") lightbox.close();
  else lightbox.removeAttribute("open");
  opener?.focus();
  opener = null;
}

lightbox.querySelector(".lightbox-close").addEventListener("click", closeLightbox);
lightbox.addEventListener("click", (event) => {
  if (event.target === lightbox) closeLightbox();
});
lightbox.addEventListener("close", () => {
  lightboxImg.removeAttribute("src");
  opener?.focus();
  opener = null;
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && lightbox.hasAttribute("open")) closeLightbox();
});

async function loadFeedFile() {
  const response = await fetch("content/feed.json");
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

async function init() {
  let payload = null;
  let feedFailed = false;
  try {
    payload = await loadFeedFile();
  } catch {
    feedFailed = true;
  }
  const files = await listRepoArt();
  if (feedFailed && files.length === 0) {
    showError("The art feed could not be loaded. Check content/feed.json and open the site from a local server.");
    return;
  }
  const rawItems = payload == null ? [] : Array.isArray(payload) ? payload : payload.items;
  const feedItems = (rawItems || []).map(normalize).filter(Boolean);
  items = mergeArt(feedItems, files);
  statusEl.textContent = items.length ? "Art feed ready." : "";
  if (!items.length) {
    finish();
    return;
  }
  total = items.length;
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) fillAhead();
    },
    { rootMargin: "700px 0px" }
  );
  observer.observe(sentinel);
  fillAhead();
}

init();
