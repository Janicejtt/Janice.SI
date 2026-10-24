const VERSION = "20261024b";

const { CONTENTS_URL, UPLOAD_URL, filesFromContents, mergeArt, wantsEdit } = await import(
  `./catalog.js?v=${VERSION}`
);
const { embedFor } = await import(`./media.js?v=${VERSION}`);

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
      if (node.tagName === "VIDEO" && node.muted) node.setAttribute("muted", "");
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

const visibleVideos = new Set();
const heldPause = new WeakSet();
const userStarted = new WeakSet();
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function tryPlay(video, fromUser) {
  if (!video || heldPause.has(video)) return;
  if (!fromUser && !visibleVideos.has(video)) return;
  if (reduceMotion.matches && !userStarted.has(video)) return;
  if (!video.paused) return;
  const pending = video.play();
  if (pending && typeof pending.then === "function") {
    pending.then(() => {
      delete video.dataset.autoplayBlocked;
    }).catch(() => {
      video.dataset.autoplayBlocked = "1";
    });
  }
}

function retryVisible() {
  for (const video of visibleVideos) tryPlay(video);
}

function onGesture(event) {
  const target = event.target;
  if (target && typeof target.closest === "function" && target.closest("video, .sound")) return;
  retryVisible();
}

let gestureArmed = false;
function armGestureRetry() {
  if (gestureArmed) return;
  gestureArmed = true;
  for (const type of ["pointerdown", "touchstart", "keydown", "scroll", "wheel"]) {
    document.addEventListener(type, onGesture, { capture: true, passive: true });
  }
}

const playbackObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      const video = entry.target;
      if (!(video instanceof HTMLVideoElement)) continue;
      if (entry.intersectionRatio >= 0.5) {
        visibleVideos.add(video);
        tryPlay(video);
      } else {
        visibleVideos.delete(video);
        heldPause.delete(video);
        if (!video.paused) video.pause();
      }
    }
  },
  { threshold: [0, 0.25, 0.5, 0.75, 1] }
);

function watchPlayback(video) {
  armGestureRetry();
  playbackObserver.observe(video);
  video.addEventListener("click", () => {
    if (video.paused) {
      heldPause.delete(video);
      userStarted.add(video);
      visibleVideos.add(video);
      const pending = video.play();
      if (pending && typeof pending.catch === "function") {
        pending.catch(() => {
          video.dataset.autoplayBlocked = "1";
        });
      }
    } else {
      heldPause.add(video);
      video.pause();
    }
  });
}

const SOUND_VISIBLE_MS = 2500;

function bindSoundChrome(media, button) {
  let timer = 0;
  let over = false;
  button.tabIndex = -1;
  const hide = () => {
    button.classList.remove("is-shown");
    button.tabIndex = -1;
  };
  const arm = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (over || button.matches(":hover") || button.matches(":focus-visible")) {
        arm();
        return;
      }
      hide();
    }, SOUND_VISIBLE_MS);
  };
  const show = () => {
    if (button.hidden) return;
    button.classList.add("is-shown");
    button.tabIndex = 0;
    if (over) {
      window.clearTimeout(timer);
      return;
    }
    arm();
  };
  media.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "touch") {
      show();
      return;
    }
    over = true;
    show();
  });
  media.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "touch") return;
    over = false;
    if (button.classList.contains("is-shown")) arm();
  });
  media.addEventListener("click", (event) => {
    if (event.target.closest && event.target.closest(".sound")) return;
    show();
  });
  button.addEventListener("click", show);
  button.addEventListener("focus", show);
}

let soundMark = 0;

function soundButton(video) {
  const button = el("button", "sound", { type: "button" });
  const mark = "sound-mute-" + ++soundMark;
  const speaker =
    '<path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" d="M5.2 8.8H7.8L11.6 5.6V18.4L7.8 15.2H5.2C4.4 15.2 3.8 14.6 3.8 13.8V10.2C3.8 9.4 4.4 8.8 5.2 8.8Z"/>';
  button.innerHTML =
    '<svg class="sound-off" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">' +
    '<mask id="' + mark + '" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/>' +
    '<path d="M4 20 20 4" stroke="#000" stroke-width="3.4" stroke-linecap="round"/></mask>' +
    '<g mask="url(#' + mark + ')">' + speaker + "</g>" +
    '<path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" d="M4 20 20 4"/></svg>' +
    '<svg class="sound-on" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">' +
    speaker +
    '<path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" d="M14.2 9.2a3.6 3.6 0 0 1 0 5.6"/>' +
    '<path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" d="M18.2 8.5a4.6 4.6 0 0 1 0 7"/></svg>';
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
      heldPause.delete(video);
      userStarted.add(video);
      const pending = video.play();
      if (pending && typeof pending.catch === "function") pending.catch(() => {});
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

function renderFileVideo(item) {
  const src = frameSrc(locationOf(item), item.poster);
  const video = document.createElement("video");
  video.muted = true;
  video.defaultMuted = true;
  video.setAttribute("muted", "");
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.autoplay = true;
  video.setAttribute("autoplay", "");
  video.preload = "auto";
  video.setAttribute("preload", "auto");
  video.loop = true;
  video.setAttribute("loop", "");
  video.controls = false;
  video.removeAttribute("controls");
  if (item.poster) video.setAttribute("poster", item.poster);
  if (item.width) video.setAttribute("width", item.width);
  if (item.height) video.setAttribute("height", item.height);
  video.setAttribute("aria-label", item.alt);
  video.src = src;
  useDownloadOnError(video, item, (url) => frameSrc(url, item.poster));
  watchPlayback(video);
  const sound = soundButton(video);
  queueMicrotask(() => {
    const media = video.closest(".card-media");
    if (media) bindSoundChrome(media, sound);
  });
  return [video, sound];
}

function renderEmbed(item) {
  const button = playButton(`Open ${item.type} video: ${item.alt}`);
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
  const response = await fetch(`content/feed.json?v=${VERSION}`);
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
