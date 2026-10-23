import { CONTENTS_URL, UPLOAD_URL, filesFromContents, mergeArt, wantsEdit } from "./catalog.js";
import { embedFor } from "./media.js";

const BATCH = 2;
const EXTRA_LOOPS = 1;
const CACHE_KEY = "janice.si.art";
const CACHE_MS = 60_000;
const EDIT_KEY = "janice.si.edit";
const TYPES = new Set(["image", "video", "youtube", "tiktok", "instagram"]);

const feed = document.querySelector("#feed");
const statusEl = document.querySelector("#feed-status");
const sentinel = document.querySelector("#sentinel");
const footer = document.querySelector("#site-footer");
const endNote = document.querySelector("#end-note");
const lightbox = document.querySelector("#lightbox");
const lightboxImg = document.querySelector("#lightbox-img");
const lightboxCaption = document.querySelector("#lightbox-caption");
const skipSocial = document.querySelector("#skip-social");

let items = [];
let cursor = 0;
let total = 0;
let opener = null;
let observer = null;
let jumpToSocial = false;
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

function platformPoster(kind) {
  const poster = el("div", `poster poster-${kind}`);
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

function useDownloadOnError(node, item) {
  node.addEventListener("error", () => {
    if (item.download && node.dataset.fallback !== "1") {
      node.dataset.fallback = "1";
      node.src = item.download;
      return;
    }
    if (node.tagName === "IMG") node.alt = `${item.alt} (image failed to load)`;
  });
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

function renderFileVideo(item) {
  const src = locationOf(item);
  const video = el("video", null, {
    src,
    poster: item.poster || undefined,
    preload: "none",
    playsinline: "",
    muted: "",
    width: "640",
    height: "800",
  });
  video.muted = true;
  video.playsInline = true;
  useDownloadOnError(video, item);
  const button = playButton(`Play video: ${item.alt}`);
  button.addEventListener("click", () => {
    stopOtherMedia(video);
    video.muted = true;
    video.controls = true;
    button.hidden = true;
    video.closest(".card-media")?.classList.add("is-playing");
    video.play().catch(() => {
      video.controls = true;
    });
  });
  video.addEventListener("ended", () => {
    button.hidden = false;
    video.controls = false;
  });
  return [video, button];
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

function renderCard(item, index, loop) {
  const card = el("article", "card");
  card.dataset.index = String(index);
  card.dataset.loop = String(loop);
  const media = el("div", "card-media");
  if (item.type === "image") {
    media.append(renderImage(item, index < 2));
  } else if (item.type === "video") {
    media.append(...renderFileVideo(item));
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
  const plus = el("span", "plus");
  plus.setAttribute("aria-hidden", "true");
  plus.textContent = "+";
  const note = el("p", "add-note");
  note.textContent =
    "Upload images or videos into assets/art. They show up here on their own. Use content/feed.json for a caption, the order, or a YouTube, TikTok, or Instagram link.";
  link.append(plus);
  card.append(link, note);
  return card;
}

function appendBatch() {
  if (!items.length || cursor >= total) return false;
  const fragment = document.createDocumentFragment();
  let added = 0;
  while (added < BATCH && cursor < total) {
    if (cursor > 0 && cursor % items.length === 0) {
      const note = el("p", "loop-note");
      note.textContent = "Showing the collection again";
      fragment.append(note);
    }
    const item = items[cursor % items.length];
    const loop = Math.floor(cursor / items.length);
    fragment.append(renderCard(item, cursor, loop));
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
  endNote.hidden = items.length === 0;
  footer.hidden = false;
  if (jumpToSocial) {
    jumpToSocial = false;
    document.querySelector("#social-links")?.focus();
  }
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
  footer.hidden = false;
  endNote.hidden = true;
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

skipSocial.addEventListener("click", (event) => {
  event.preventDefault();
  if (finished) {
    document.querySelector("#social-links")?.focus();
    return;
  }
  jumpToSocial = true;
  if (!items.length) return;
  while (cursor < total) appendBatch();
  finish();
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
  total = items.length * (1 + EXTRA_LOOPS);
  if (jumpToSocial) {
    while (cursor < total) appendBatch();
    finish();
    return;
  }
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
