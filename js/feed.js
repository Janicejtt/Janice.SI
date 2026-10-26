const VERSION = "20261026j";

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
  if (target && typeof target.closest === "function" && target.closest("video, .viewer, .sound")) return;
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
      if (video === activeViewerVideo || viewer.contains(video)) {
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
    if (suppressViewerClick) {
      suppressViewerClick = false;
      return;
    }
    if (activeViewerVideo === video) {
      revealChrome();
      return;
    }
    openViewer(video);
  });
}

const feedVideoList = [];
let soundMark = 0;

function soundButton(video) {
  const button = el("button", "sound", { type: "button" });
  const mark = "sound-mute-" + ++soundMark;
  const speakerD =
    "M5.2 8.8H7.8L11.6 5.6V18.4L7.8 15.2H5.2C4.4 15.2 3.8 14.6 3.8 13.8V10.2C3.8 9.4 4.4 8.8 5.2 8.8Z";
  const slashD = "M3.5 16.1 12.3 4.7";
  const viewOff = "-4.09 -0.41 24 24";
  const viewOn = "-0.21 0 24 24";
  button.innerHTML =
    '<svg class="sound-icon" viewBox="' + viewOff + '" width="22" height="22" aria-hidden="true" focusable="false">' +
    '<mask id="' + mark + '" maskUnits="userSpaceOnUse" x="-6" y="-6" width="36" height="36"><rect x="-6" y="-6" width="36" height="36" fill="#fff"/>' +
    '<path d="' + slashD + '" stroke="#000" stroke-width="3.4" stroke-linecap="round"/></mask>' +
    '<g class="speaker" mask="url(#' + mark + ')">' +
    '<path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" d="' + speakerD + '"/>' +
    "</g>" +
    '<path class="slash" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" d="' + slashD + '"/>' +
    '<g class="waves">' +
    '<path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" d="M14.2 9.2a3.6 3.6 0 0 1 0 5.6"/>' +
    '<path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" d="M18.2 8.5a4.6 4.6 0 0 1 0 7"/>' +
    "</g></svg>";
  const icon = button.querySelector(".sound-icon");
  const speaker = button.querySelector(".speaker");
  const paint = () => {
    const on = !video.muted;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.setAttribute("aria-label", on ? "Mute" : "Unmute");
    icon.setAttribute("viewBox", on ? viewOn : viewOff);
    speaker.setAttribute("mask", on ? "none" : "url(#" + mark + ")");
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
  paint();
  return button;
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
  feedVideoList.push(video);
  return { video, sound: soundButton(video) };
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
    const file = renderFileVideo(item);
    media.append(file.video, file.sound);
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

function clearFit(node) {
  if (!node) return;
  node.style.width = "";
  node.style.height = "";
  node.classList.remove("viewer-cover", "viewer-wide");
}

const phoneViewerQuery = window.matchMedia("(max-width: 700px) and (orientation: portrait)");

function fitPhoneVideo(node) {
  clearFit(node);
  const naturalW = node.videoWidth || Number(node.getAttribute("width")) || 0;
  const naturalH = node.videoHeight || Number(node.getAttribute("height")) || 0;
  node.classList.add(naturalH > naturalW && naturalW > 0 ? "viewer-cover" : "viewer-wide");
}

function fitReplaced(node) {
  const frame = node && node.parentElement;
  if (!frame) return;
  if (node.tagName === "VIDEO" && node.closest("#viewer") && phoneViewerQuery.matches) {
    fitPhoneVideo(node);
    return;
  }
  node.classList.remove("viewer-cover", "viewer-wide");
  const frameStyle = getComputedStyle(frame);
  const maxW = frame.clientWidth - parseFloat(frameStyle.paddingLeft) - parseFloat(frameStyle.paddingRight);
  const maxH = frame.clientHeight - parseFloat(frameStyle.paddingTop) - parseFloat(frameStyle.paddingBottom);
  const naturalW = node.videoWidth || node.naturalWidth || Number(node.getAttribute("width")) || 0;
  const naturalH = node.videoHeight || node.naturalHeight || Number(node.getAttribute("height")) || 0;
  if (!naturalW || !naturalH || maxW < 1 || maxH < 1) return;
  const scale = Math.min(maxW / naturalW, maxH / naturalH);
  const width = `${Math.max(1, Math.round(naturalW * scale))}px`;
  const height = `${Math.max(1, Math.round(naturalH * scale))}px`;
  if (node.style.width !== width) node.style.width = width;
  if (node.style.height !== height) node.style.height = height;
}

function fitLightboxImage() {
  if (!lightbox.open && !lightbox.hasAttribute("open")) return;
  fitReplaced(lightboxImg);
}

function openLightbox(src, alt, caption, button) {
  opener = button;
  clearFit(lightboxImg);
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
  const fit = () => requestAnimationFrame(fitLightboxImage);
  if (lightboxImg.complete && lightboxImg.naturalWidth) fit();
  lightboxImg.addEventListener("load", fit, { once: true });
}

function closeLightbox() {
  clearFit(lightboxImg);
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
  if (activeViewerVideo && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
    event.preventDefault();
    goToVideo(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
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
const viewerReel = viewer.querySelector(".viewer-reel");
const viewerBack = viewer.querySelector(".viewer-back");
const viewerProgress = viewer.querySelector(".viewer-progress");
const viewerBuffer = viewer.querySelector(".viewer-progress-buffer");
const viewerFill = viewer.querySelector(".viewer-progress-fill");
const viewerPlay = viewer.querySelector(".viewer-play");
const viewerTime = viewer.querySelector(".viewer-time");
const viewerSound = viewer.querySelector(".viewer-sound");
const paintSpeaker = mountSpeaker(viewerSound);

const videoSlots = new WeakMap();
let viewerReturn = null;
let chromeTimer = 0;
let seeking = false;
let scrollLockY = 0;
let closeScrollY = 0;
let viewerSoundOn = true;
let swipeBusy = false;
let swipe = null;
let suppressViewerClick = false;
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
  fitReplaced(video);
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
  closeScrollY = scrollLockY;
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
  window.scrollTo(0, closeScrollY);
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

function holdPlace(video) {
  const existing = videoSlots.get(video);
  if (existing && existing.isConnected) return existing;
  const slot = document.createElement("div");
  slot.className = "video-slot";
  if (video.videoWidth && video.videoHeight) {
    slot.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
  } else {
    slot.style.height = `${Math.max(1, Math.round(video.getBoundingClientRect().height || 240))}px`;
  }
  if (video.parentNode) video.before(slot);
  videoSlots.set(video, slot);
  return slot;
}

function restoreToFeed(video) {
  if (!video) return;
  clearFit(video);
  for (const type of viewerMediaEvents) video.removeEventListener(type, syncViewer);
  video.muted = true;
  video.defaultMuted = true;
  video.setAttribute("muted", "");
  video.controls = false;
  video.removeAttribute("controls");
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  if (!video.paused) video.pause();
  const slot = videoSlots.get(video);
  if (slot && slot.parentNode) slot.replaceWith(video);
  videoSlots.delete(video);
}

function bindViewerMedia(video) {
  for (const type of viewerMediaEvents) video.removeEventListener(type, syncViewer);
  for (const type of viewerMediaEvents) video.addEventListener(type, syncViewer);
}

function playInViewer(video) {
  if (viewerSoundOn) {
    unmuteVideo(video, true);
    return;
  }
  document.querySelectorAll("video").forEach((other) => {
    if (other === video) return;
    other.muted = true;
    if (!other.paused) other.pause();
  });
  video.muted = true;
  video.defaultMuted = true;
  video.setAttribute("muted", "");
  video.controls = false;
  video.removeAttribute("controls");
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  heldPause.delete(video);
  userStarted.add(video);
  const pending = video.play();
  if (pending && typeof pending.catch === "function") pending.catch(() => {});
}

function clearReel() {
  viewerReel.replaceChildren();
  viewerReel.style.transition = "none";
  viewerReel.style.transform = "translateY(0px)";
}

function mountCurrentPane(video) {
  clearReel();
  const pane = document.createElement("div");
  pane.className = "viewer-pane is-current";
  pane.append(video);
  viewerReel.append(pane);
}

function rememberFeedPosition(video) {
  const slot = videoSlots.get(video);
  const anchor = slot && slot.isConnected ? slot : video;
  const card = anchor.closest(".card");
  if (!card) return;
  viewerReturn = card;
  const rect = card.getBoundingClientRect();
  const visible = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
  const enough = rect.height > 0 && visible / Math.min(rect.height, window.innerHeight) >= 0.55;
  if (enough) return;
  const top = scrollLockY + rect.top;
  const centered = top - Math.max(12, (window.innerHeight - Math.min(rect.height, window.innerHeight)) / 2);
  closeScrollY = Math.max(0, Math.round(centered));
}

function openViewer(video) {
  if (!video || swipeBusy || activeViewerVideo === video) return;
  if (activeViewerVideo) closeViewer();
  viewerSoundOn = true;
  activeViewerVideo = video;
  viewerReturn = video.closest(".card") || video.parentElement;
  holdPlace(video);
  mountCurrentPane(video);
  viewer.classList.remove("is-paused");
  viewer.classList.add("is-chrome");
  viewer.hidden = false;
  lockScroll();
  bindViewerMedia(video);
  playInViewer(video);
  syncViewer();
  requestAnimationFrame(() => fitReplaced(video));
  revealChrome();
  viewerBack.focus();
}

function closeViewer() {
  const video = activeViewerVideo;
  if (!video) return;
  window.clearTimeout(chromeTimer);
  seeking = false;
  swipe = null;
  swipeBusy = false;
  const neighbor = viewerReel.querySelector(".viewer-pane.is-neighbor video");
  if (neighbor && neighbor !== video) restoreToFeed(neighbor);
  rememberFeedPosition(video);
  activeViewerVideo = null;
  restoreToFeed(video);
  clearReel();
  viewer.classList.remove("is-open", "is-chrome", "is-paused", "is-waiting");
  viewer.hidden = true;
  unlockScroll();
  const card = video.closest(".card");
  if (card) {
    const rect = card.getBoundingClientRect();
    const visible = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    if (!(rect.height > 0 && visible / rect.height >= 0.45)) {
      card.scrollIntoView({ block: "center", inline: "nearest" });
    }
  }
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
  viewerSoundOn = video.muted;
  if (video.muted) unmuteVideo(video, false);
  else video.muted = true;
  paintSpeaker(video);
  revealChrome();
}

function neighborOf(video, dir) {
  let index = feedVideoList.indexOf(video);
  let guard = 0;
  while (dir > 0 && index === feedVideoList.length - 1 && cursor < total && guard < 30) {
    appendBatch();
    index = feedVideoList.indexOf(video);
    guard += 1;
  }
  if (cursor >= total) finish();
  const next = index + dir;
  if (index < 0 || next < 0 || next >= feedVideoList.length) return null;
  return feedVideoList[next];
}

function neighborPane(video, dir) {
  const existing = viewerReel.querySelector(".viewer-pane.is-neighbor");
  if (existing) {
    const other = existing.querySelector("video");
    existing.remove();
    if (other && other !== video) restoreToFeed(other);
  }
  if (!video) return;
  holdPlace(video);
  const pane = document.createElement("div");
  pane.className = "viewer-pane is-neighbor";
  pane.style.top = dir > 0 ? "100%" : "-100%";
  pane.append(video);
  viewerReel.append(pane);
  video.muted = true;
  video.defaultMuted = true;
  video.setAttribute("muted", "");
  if (video.paused) {
    const pending = video.play();
    if (pending && typeof pending.catch === "function") pending.catch(() => {});
  }
  requestAnimationFrame(() => fitReplaced(video));
}

function settle(incoming) {
  const outgoing = activeViewerVideo;
  if (outgoing && outgoing !== incoming) restoreToFeed(outgoing);
  const stray = viewerReel.querySelector(".viewer-pane.is-neighbor video");
  if (stray && stray !== incoming) restoreToFeed(stray);
  activeViewerVideo = incoming;
  mountCurrentPane(incoming);
  bindViewerMedia(incoming);
  playInViewer(incoming);
  syncViewer();
  requestAnimationFrame(() => fitReplaced(incoming));
  rememberFeedPosition(incoming);
  revealChrome();
  swipeBusy = false;
}

function animateReel(to, done) {
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    viewerReel.removeEventListener("transitionend", onEnd);
    viewerReel.style.transition = "none";
    done();
  };
  const onEnd = (event) => {
    if (event.propertyName !== "transform") return;
    finish();
  };
  if (reduceMotion.matches) {
    viewerReel.style.transition = "none";
    viewerReel.style.transform = `translateY(${to}px)`;
    finish();
    return;
  }
  viewerReel.style.transition = "transform 0.34s ease";
  viewerReel.style.transform = `translateY(${to}px)`;
  viewerReel.addEventListener("transitionend", onEnd);
  window.setTimeout(finish, 520);
}

function bounce(dir) {
  if (reduceMotion.matches) return;
  swipeBusy = true;
  viewerReel.style.transition = "transform 0.16s ease";
  viewerReel.style.transform = `translateY(${dir > 0 ? -64 : 64}px)`;
  window.setTimeout(() => animateReel(0, () => {
    swipeBusy = false;
  }), 170);
}

function goToVideo(dir) {
  if (!activeViewerVideo || swipeBusy || seeking || swipe) return;
  const incoming = neighborOf(activeViewerVideo, dir);
  if (!incoming) {
    bounce(dir);
    return;
  }
  neighborPane(incoming, dir);
  const height = viewerStage.clientHeight || window.innerHeight || 1;
  swipeBusy = true;
  animateReel(dir > 0 ? -height : height, () => settle(incoming));
}

function swipePoint(event) {
  const touch = event.touches && event.touches.length
    ? event.touches[0]
    : event.changedTouches && event.changedTouches.length
      ? event.changedTouches[0]
      : null;
  if (touch) return { id: touch.identifier, x: touch.clientX, y: touch.clientY };
  return { id: event.pointerId, x: event.clientX, y: event.clientY };
}

function onSwipeDown(event) {
  if (!activeViewerVideo || swipeBusy || seeking) return;
  if (event.button != null && event.button !== 0) return;
  const point = swipePoint(event);
  swipe = { id: point.id, x: point.x, y: point.y, dx: 0, dy: 0, axis: "", dir: 0, neighbor: null };
  if (event.pointerId != null && viewerStage.setPointerCapture) {
    try {
      viewerStage.setPointerCapture(event.pointerId);
    } catch {
      /* pointer already released */
    }
  }
}

function onSwipeMove(event) {
  if (!swipe) return;
  const point = swipePoint(event);
  if (point.id !== swipe.id) return;
  swipe.dx = point.x - swipe.x;
  swipe.dy = point.y - swipe.y;
  if (!swipe.axis) {
    if (Math.hypot(swipe.dx, swipe.dy) < 10) return;
    swipe.axis = Math.abs(swipe.dy) > Math.abs(swipe.dx) ? "y" : "x";
  }
  if (swipe.axis !== "y") return;
  const dir = swipe.dy < 0 ? 1 : -1;
  if (dir !== swipe.dir) {
    swipe.dir = dir;
    swipe.neighbor = neighborOf(activeViewerVideo, dir);
    neighborPane(swipe.neighbor, dir);
  }
  const height = viewerStage.clientHeight || window.innerHeight || 1;
  let dy = swipe.dy;
  if (!swipe.neighbor) dy *= 0.32;
  else dy = Math.max(-height, Math.min(height, dy));
  viewerReel.style.transition = "none";
  viewerReel.style.transform = `translateY(${dy}px)`;
}

function onSwipeUp(event) {
  if (!swipe) return;
  const point = swipePoint(event);
  if (point.id !== swipe.id && event.type !== "pointercancel") return;
  const state = swipe;
  swipe = null;
  if (state.axis === "y") {
    suppressViewerClick = true;
    window.setTimeout(() => {
      suppressViewerClick = false;
    }, 400);
  }
  if (state.axis !== "y") {
    if (state.neighbor) restoreToFeed(state.neighbor);
    viewerReel.style.transition = "none";
    viewerReel.style.transform = "translateY(0px)";
    revealChrome();
    return;
  }
  const height = viewerStage.clientHeight || window.innerHeight || 1;
  const commit = Math.abs(state.dy) > Math.min(88, height * 0.16);
  if (commit && state.neighbor) {
    swipeBusy = true;
    animateReel(state.dy < 0 ? -height : height, () => settle(state.neighbor));
    return;
  }
  swipeBusy = true;
  animateReel(0, () => {
    if (state.neighbor) restoreToFeed(state.neighbor);
    const stray = viewerReel.querySelector(".viewer-pane.is-neighbor");
    if (stray) stray.remove();
    swipeBusy = false;
    revealChrome();
  });
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

function closeFromBack(event) {
  event.preventDefault();
  event.stopPropagation();
  closeViewer();
}
viewerBack.addEventListener("pointerdown", (event) => {
  event.stopPropagation();
});
viewerBack.addEventListener("pointerup", closeFromBack);
viewerBack.addEventListener("click", closeFromBack);
viewerBack.addEventListener("touchend", closeFromBack, { passive: false });
viewerStage.addEventListener("pointerdown", onSwipeDown);
viewerStage.addEventListener("pointermove", onSwipeMove);
viewerStage.addEventListener("pointerup", onSwipeUp);
viewerStage.addEventListener("pointercancel", onSwipeUp);
viewerStage.addEventListener("touchstart", (event) => {
  if (window.PointerEvent) return;
  onSwipeDown(event);
}, { passive: true });
viewerStage.addEventListener("touchmove", (event) => {
  if (window.PointerEvent) return;
  if (swipe && swipe.axis === "y" && event.cancelable) event.preventDefault();
  onSwipeMove(event);
}, { passive: false });
viewerStage.addEventListener("touchend", (event) => {
  if (window.PointerEvent) return;
  onSwipeUp(event);
}, { passive: true });
viewerStage.addEventListener("touchcancel", (event) => {
  if (window.PointerEvent) return;
  onSwipeUp(event);
}, { passive: true });
let wheelAt = 0;
viewer.addEventListener("wheel", (event) => {
  if (!activeViewerVideo) return;
  if (event.target.closest && event.target.closest(".viewer-progress")) return;
  event.preventDefault();
  if (swipeBusy || swipe) return;
  const now = Date.now();
  if (now - wheelAt < 500) return;
  if (Math.abs(event.deltaY) < 8) return;
  wheelAt = now;
  goToVideo(event.deltaY > 0 ? 1 : -1);
}, { passive: false });
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
function refitOpenMedia() {
  if (activeViewerVideo) viewer.querySelectorAll("video").forEach((video) => fitReplaced(video));
  fitLightboxImage();
}

window.addEventListener("resize", refitOpenMedia);
phoneViewerQuery.addEventListener("change", refitOpenMedia);
init();
