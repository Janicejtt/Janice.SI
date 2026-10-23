# Janice.SI

Personal site for Janice SI: a centered page with her photo, a scrolling feed of AI art and videos, and social links at the bottom.

The art on the page comes only from `content/feed.json`. The site does not import posts from X or anywhere else.

## Preview locally

Fetch calls need a local server. From this folder:

```bash
python3 -m http.server 8080
```

Open [http://localhost:8080](http://localhost:8080).

## Add art

Edit `content/feed.json`. Each object in `items` is one card, top to bottom.

Image:

```json
{
  "type": "image",
  "src": "assets/art/my-piece.jpg",
  "alt": "Describe the image for someone who cannot see it",
  "caption": "Optional caption"
}
```

Put the file in the repo (for example `assets/art/`) and use a path relative to `index.html`. `caption` can be left out. `full` is optional and is what opens in the full-size view; when it is missing, the site uses `src`.

`alt` should describe the picture. Do not leave it empty.

Delete the placeholder entries when you add real work. The shipped cards are marked **Placeholder** and are not real piece titles.

## Add videos

Self-hosted file (mp4). It stays muted until a visitor turns sound on, and it does not play until they press Play:

```json
{
  "type": "video",
  "src": "assets/art/clip.mp4",
  "poster": "assets/art/clip-poster.jpg",
  "alt": "Describe the video",
  "caption": "Optional caption"
}
```

YouTube, TikTok, and Instagram play inline from a URL. Use a link to the video itself, not a channel or profile page. The player loads after Play. YouTube starts muted. TikTok is loaded with autoplay off and muted. Instagram uses its embed player.

```json
{ "type": "youtube", "url": "https://www.youtube.com/watch?v=VIDEO_ID", "alt": "Describe the video", "caption": "Optional caption" }
```

```json
{ "type": "tiktok", "url": "https://www.tiktok.com/@name/video/1234567890", "alt": "Describe the video", "caption": "Optional caption" }
```

```json
{ "type": "instagram", "url": "https://www.instagram.com/reel/SHORTCODE/", "alt": "Describe the video", "caption": "Optional caption" }
```

`src` works in place of `url` if you prefer one field. Short TikTok links (`vm.tiktok.com`) cannot be embedded; use the full `tiktok.com/@name/video/…` link.

The feed shows a few cards at a time and loads more as you scroll. After the list has been shown, it repeats once, then the social links appear.

## Change the name, photo, and links

- The big title and the line under it are in `index.html` (`Janice SI` and `Hi nice to meet you all 🫶🏻`).
- The portrait is `assets/janice-avatar.jpg` (her profile photo). Replace that file, or change the `src` on the avatar image. Keep useful `alt` text.
- Social buttons are the four links in the footer of `index.html`.

## Deploy on GitHub Pages

The site is static files at the repository root. No build step.

1. Push this branch to GitHub.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select the branch you want to publish and the folder **`/ (root)`**. Save.

GitHub will serve it at `https://<username>.github.io/<repository>/`. The first publish can take a minute.

Paths in this project are relative, so the same files work on that project URL and on a custom domain.

## Custom domain later

1. Add a file named `CNAME` in the repository root. The file should contain only the domain, for example `www.example.com`. No `https://`.
2. In the domain’s DNS:
   - For a `www` name, add a **CNAME** record pointing at `<username>.github.io`.
   - For an apex name such as `example.com`, add **A** records to GitHub Pages: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, and `185.199.111.153`. Confirm these addresses in GitHub’s Pages docs before you rely on them.
3. In **Settings → Pages**, set the custom domain and turn on **Enforce HTTPS** after the certificate is ready.

DNS can take a while to update. GitHub shows the status on the Pages settings screen.
