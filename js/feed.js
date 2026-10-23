import { embedFor } from "./media.js";

const BATCH = 2;
const EXTRA_LOOPS = 1;
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
  };
  if ((type === "image" || type === "video") && !item.src && !item.url) return null;
  if (!item.alt) item.alt = item.caption || "Artwork by Janice SI";
  return item;
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

function placeholderPoster(kind) {
  const poster = el("div", `poster poster-${kind}`);
  const chip = el("span", "chip");
  chip.textContent = "Placeholder";
  const name = el("p", "kind");
  name.textContent = kind.charAt(0).toUpperCase() + kind.slice(1);
  poster.append(chip, name);
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
  img.addEventListener("error", () => {
    img.alt = `${item.alt} (image failed to load)`;
  });
  button.append(hidden, img);
  button.addEventListener("click", () => {
    openLightbox(item.full || src, item.alt, item.caption, button);
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
  return [placeholderPoster(item.type), button];
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

function appendBatch() {
  if (cursor >= total) return false;
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
  if (sentinel.isConnected) sentinel.remove();
  endNote.hidden = false;
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
  jumpToSocial = true;
  if (!items.length) return;
  while (cursor < total) appendBatch();
  finish();
});

async function init() {
  let payload;
  try {
    const response = await fetch("content/feed.json");
    if (!response.ok) throw new Error(String(response.status));
    payload = await response.json();
  } catch {
    showError("The art feed could not be loaded. Check content/feed.json and open the site from a local server.");
    return;
  }
  const rawItems = Array.isArray(payload) ? payload : payload.items;
  items = (rawItems || []).map(normalize).filter(Boolean);
  if (!items.length) {
    showError("No art yet. Add items to content/feed.json.");
    return;
  }
  total = items.length * (1 + EXTRA_LOOPS);
  statusEl.textContent = "Art feed ready.";
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
