const VERSION = "20261024f";

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

const visibleVideos = new Set();
let activeViewerVideo = null;
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
  if (target && typeof target.closest === "function" && target.closest("video, .viewer")) return;
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
      if (video === activeViewerVideo) {
        visibleVideos.add(video);
        continue;
      }
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
  video.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (activeViewerVideo === video) {
      revealChrome();
      return;
    }
    openViewer(video);
  });
}

function mountSpeaker(button) {
  const mark = "viewer-mute";
  const speakerD =
    "M5.2 8.8H7.8L11.6 5.6V18.4L7.8 15.2H5.2C4.4 15.2 3.8 14.6 3.8 13.8V10.2C3.8 9.4 4.4 8.8 5.2 8.8Z";
  const slashD = "M3.5 16.1 12.3 4.7";
  const viewOff = "-4.09 -0.41 24 24";
  const viewOn = "-0.21 0 24 24";
  button.innerHTML =
    '<svg class="sound-icon" viewBox="' + viewOn + '" width="22" height="22" aria-hidden="true" focusable="false">' +
    '<mask id="' + mark + '" maskUnits="userSpaceOnUse" x="-6" y="-6" width="36" height="36"><rect x="-6" y="-6" width="36" height="36" fill="#fff"/>' +
    '<path d="' + slashD + '" stroke="#000" stroke-width="3.4" stroke-linecap="round"/></mask>' +
    '<g class="speaker">' +
    '<path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" d="' + speakerD + '"/>' +
    "</g>" +
    '<path class="slash" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" d="' + slashD + '"/>' +
    '<g class="waves">' +
    '<path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" d="M14.2 9.2a3.6 3.6 0 0 1 0 5.6"/>' +
    '<path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" d="M18.2 8.5a4.6 4.6 0 0 1 0 7"/>' +
    "</g></svg>";
  const icon = button.querySelector(".sound-icon");
  const speaker = button.querySelector(".speaker");
  return (video) => {
    const on = !video.muted;
    button.classList.toggle("is-on", !!on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.setAttribute("aria-label", on ? "Mute" : "Unmute");
    icon.setAttribute("viewBox", on ? viewOn : viewOff);
    speaker.setAttribute("mask", on ? "none" : "url(#" + mark + ")");
  };
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
  video.setAttribute("controlsList", "nodownload nofullscreen noremoteplayback");
  video.disablePictureInPicture = true;
  watchPlayback(video);
  return video;
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
    media.append(renderFileVideo(item));
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
  if (event.key !== "Escape") return;
  if (activeViewerVideo) {
    event.preventDefault();
    closeViewer();
    return;
  }
  if (lightbox.hasAttribute("open")) closeLightbox();
});

const CHROME_MS = 2500;
const viewer = document.querySelector("#viewer");
const viewerStage = viewer.querySelector(".viewer-stage");
const viewerClose = viewer.querySelector(".viewer-close");
const viewerChrome = viewer.querySelector(".viewer-chrome");
const viewerProgress = viewer.querySelector(".viewer-progress");
const viewerBuffer = viewer.querySelector(".viewer-progress-buffer");
const viewerFill = viewer.querySelector(".viewer-progress-fill");
const viewerPlay = viewer.querySelector(".viewer-play");
const viewerTime = viewer.querySelector(".viewer-time");
const viewerSound = viewer.querySelector(".viewer-sound");
const paintSpeaker = mountSpeaker(viewerSound);

let viewerSlot = null;
let viewerReturn = null;
let chromeTimer = 0;
let seeking = false;
let scrollLockY = 0;
const viewerMediaEvents = ["timeupdate", "progress", "durationchange", "play", "pause", "waiting", "playing", "seeked", "volumechange", "loadedmetadata"];

function formatRemaining(video) {
  const duration = video.duration;
  if (!Number.isFinite(duration)) return "-0:00";
  const left = Math.max(0, Math.ceil(duration - video.currentTime));
  const hours = Math.floor(left / 3600);
  const minutes = Math.floor((left % 3600) / 60);
  const seconds = String(left % 60).padStart(2, "0");
  if (hours > 0) return `-${hours}:${String(minutes).padStart(2, "0")}:${seconds}`;
  return `-${minutes}:${seconds}`;
}

function bufferEnd(video) {
  let end = 0;
  const ranges = video.buffered;
  for (let i = 0; i < ranges.length; i += 1) end = Math.max(end, ranges.end(i));
  return end;
}

function syncViewer() {
  const video = activeViewerVideo;
  if (!video) return;
  const duration = video.duration;
  const known = Number.isFinite(duration) && duration > 0;
  const played = known ? Math.min(1, video.currentTime / duration) : 0;
  const buffered = known ? Math.min(1, bufferEnd(video) / duration) : 0;
  viewerFill.style.width = `${played * 100}%`;
  viewerBuffer.style.width = `${buffered * 100}%`;
  viewerProgress.setAttribute("aria-valuenow", String(Math.round(played * 100)));
  viewerTime.textContent = formatRemaining(video);
  const paused = video.paused;
  viewer.classList.toggle("is-paused", paused);
  viewer.classList.toggle("is-waiting", video.readyState < 3 && !paused);
  viewerPlay.setAttribute("aria-label", paused ? "Play" : "Pause");
  paintSpeaker(video);
}

function hideChrome() {
  if (!activeViewerVideo || activeViewerVideo.paused || seeking) return;
  viewer.classList.remove("is-chrome");
}

function armChrome() {
  window.clearTimeout(chromeTimer);
  if (!activeViewerVideo || activeViewerVideo.paused || seeking) return;
  chromeTimer = window.setTimeout(hideChrome, CHROME_MS);
}

function revealChrome() {
  viewer.classList.add("is-chrome");
  armChrome();
}

function lockScroll() {
  scrollLockY = window.scrollY || document.documentElement.scrollTop || 0;
  document.body.classList.add("viewer-open");
  document.body.style.position = "fixed";
  document.body.style.top = `-${scrollLockY}px`;
  document.body.style.left = "0";
  document.body.style.right = "0";
  document.body.style.width = "100%";
}

function unlockScroll() {
  document.body.classList.remove("viewer-open");
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.left = "";
  document.body.style.right = "";
  document.body.style.width = "";
  window.scrollTo(0, scrollLockY);
}

function mostlyVisible(node) {
  const rect = node.getBoundingClientRect();
  const height = window.innerHeight || document.documentElement.clientHeight || 0;
  const visible = Math.max(0, Math.min(rect.bottom, height) - Math.max(rect.top, 0));
  return rect.height > 0 && visible / rect.height >= 0.5;
}

function unmuteVideo(video, andPlay) {
  document.querySelectorAll("video").forEach((other) => {
    if (other === video) return;
    other.muted = true;
    if (andPlay && !other.paused) other.pause();
  });
  video.defaultMuted = false;
  video.removeAttribute("muted");
  video.muted = false;
  video.volume = 1;
  video.controls = false;
  video.removeAttribute("controls");
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  if (!andPlay) return;
  heldPause.delete(video);
  userStarted.add(video);
  const pending = video.play();
  if (pending && typeof pending.catch === "function") pending.catch(() => {});
}

function openViewer(video) {
  if (!video || activeViewerVideo === video) return;
  if (activeViewerVideo) closeViewer();
  activeViewerVideo = video;
  viewerReturn = video.closest(".card") || video.parentElement;
  const slot = document.createElement("div");
  slot.className = "video-slot";
  if (video.videoWidth && video.videoHeight) {
    slot.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
  } else {
    slot.style.height = `${Math.max(1, Math.round(video.getBoundingClientRect().height))}px`;
  }
  video.before(slot);
  viewerSlot = slot;
  viewerStage.append(video);
  viewer.classList.remove("is-paused");
  viewer.classList.add("is-chrome");
  viewer.hidden = false;
  lockScroll();
  unmuteVideo(video, true);
  for (const type of viewerMediaEvents) video.addEventListener(type, syncViewer);
  syncViewer();
  revealChrome();
  viewerClose.focus();
}

function closeViewer() {
  const video = activeViewerVideo;
  if (!video) return;
  window.clearTimeout(chromeTimer);
  seeking = false;
  for (const type of viewerMediaEvents) video.removeEventListener(type, syncViewer);
  video.muted = true;
  video.defaultMuted = true;
  video.setAttribute("muted", "");
  video.controls = false;
  video.removeAttribute("controls");
  if (viewerSlot && viewerSlot.parentNode) viewerSlot.replaceWith(video);
  viewerSlot = null;
  activeViewerVideo = null;
  viewer.classList.remove("is-open", "is-chrome", "is-paused", "is-waiting");
  viewer.hidden = true;
  unlockScroll();
  heldPause.delete(video);
  if (mostlyVisible(video)) {
    visibleVideos.add(video);
    tryPlay(video);
  } else if (!video.paused) {
    video.pause();
    visibleVideos.delete(video);
  }
  retryVisible();
  paintSpeaker(video);
  if (viewerReturn && typeof viewerReturn.focus === "function") {
    viewerReturn.setAttribute("tabindex", "-1");
    viewerReturn.focus();
  }
  viewerReturn = null;
}

function toggleViewerSound() {
  const video = activeViewerVideo;
  if (!video) return;
  if (video.muted) unmuteVideo(video, false);
  else video.muted = true;
  paintSpeaker(video);
  revealChrome();
}

function toggleViewerPlay() {
  const video = activeViewerVideo;
  if (!video) return;
  if (video.paused) {
    heldPause.delete(video);
    userStarted.add(video);
    const pending = video.play();
    if (pending && typeof pending.catch === "function") pending.catch(() => {});
  } else {
    video.pause();
  }
  syncViewer();
  revealChrome();
}

function seekTo(video, time) {
  if (!video || !Number.isFinite(time)) return;
  const ranges = video.seekable;
  for (let i = 0; i < ranges.length; i += 1) {
    if (time >= ranges.start(i) - 0.05 && time <= ranges.end(i) + 0.25) {
      video.currentTime = time;
      syncViewer();
      return;
    }
  }
}

function seekRatio(event) {
  const video = activeViewerVideo;
  if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
  const point = event.touches ? event.touches[0] || event.changedTouches?.[0] : event;
  if (!point) return;
  const rect = viewerProgress.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (point.clientX - rect.left) / Math.max(1, rect.width)));
  seekTo(video, ratio * video.duration);
}

function beginSeek(event) {
  if (event.cancelable) event.preventDefault();
  event.stopPropagation();
  seeking = true;
  if (event.pointerId != null && viewerProgress.setPointerCapture) {
    try {
      viewerProgress.setPointerCapture(event.pointerId);
    } catch {
      /* pointer already released */
    }
  }
  seekRatio(event);
  revealChrome();
}

function moveSeek(event) {
  if (!seeking) return;
  if (event.cancelable) event.preventDefault();
  seekRatio(event);
}

function endSeek() {
  if (!seeking) return;
  seeking = false;
  armChrome();
}

function closeFromBar(event) {
  event.preventDefault();
  event.stopPropagation();
  closeViewer();
}
viewerClose.addEventListener("pointerdown", (event) => {
  event.stopPropagation();
});
viewerClose.addEventListener("pointerup", closeFromBar);
viewerClose.addEventListener("click", closeFromBar);
viewerClose.addEventListener("touchend", closeFromBar, { passive: false });
viewerPlay.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  toggleViewerPlay();
});
viewerSound.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  toggleViewerSound();
});
viewerProgress.addEventListener("pointerdown", beginSeek);
viewerProgress.addEventListener("pointermove", moveSeek);
viewerProgress.addEventListener("pointerup", endSeek);
viewerProgress.addEventListener("pointercancel", endSeek);
viewerProgress.addEventListener("touchstart", (event) => {
  if (event.cancelable) event.preventDefault();
  if (window.PointerEvent) return;
  beginSeek(event);
}, { passive: false });
viewerProgress.addEventListener("touchmove", (event) => {
  if (!seeking) return;
  if (event.cancelable) event.preventDefault();
  if (window.PointerEvent) return;
  moveSeek(event);
}, { passive: false });
viewerProgress.addEventListener("touchend", () => {
  if (window.PointerEvent) return;
  endSeek();
});
viewerProgress.addEventListener("keydown", (event) => {
  const video = activeViewerVideo;
  if (!video || !Number.isFinite(video.duration)) return;
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
  event.preventDefault();
  const step = event.key === "ArrowRight" ? 5 : -5;
  seekTo(video, Math.min(video.duration, Math.max(0, video.currentTime + step)));
  revealChrome();
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

paintSpeaker({ muted: false });
init();
