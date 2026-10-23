# Janice.SI

Personal site for Janice SI: a centered page on black, with her name and a scrolling feed of AI art and videos.

Images and videos in `assets/art` show up on their own. `content/feed.json` is optional: use it for captions, order, alt text, and YouTube, TikTok, or Instagram links. The site does not import posts from X or anywhere else.

## Preview locally

Fetch calls need a local server. From this folder:

```bash
python3 -m http.server 8080
```

Open [http://localhost:8080](http://localhost:8080).

## Add art

On the live site, open [https://janicejtt.github.io/Janice.SI/?edit](https://janicejtt.github.io/Janice.SI/?edit). Locally that is [http://localhost:8080/?edit](http://localhost:8080/?edit).

The page remembers edit mode in this browser. A card with a large **+** appears when the feed is empty, and again as the last card once there is art. Visitors never see it. To hide it, open the same address with `?edit=off` (for example `https://janicejtt.github.io/Janice.SI/?edit=off`).

Click **+**. It opens GitHub’s upload page for `assets/art` in a new tab:

[https://github.com/Janicejtt/Janice.SI/upload/main/assets/art](https://github.com/Janicejtt/Janice.SI/upload/main/assets/art)

Upload images (jpg, png, gif, webp, avif, svg) or videos (`.mp4`, `.mov`, `.webm`). Commit the upload. You do not have to edit a JSON file for those files to appear. The site asks GitHub for the list of files in that folder and adds any that are not already in the feed, including those three video types. A poster image is optional. Without one, the card shows the video’s opening frame. GitHub Pages can take a minute to publish the file; until then the picture is loaded from GitHub directly.

`content/feed.json` is still there when you want more control. Entries in `items` keep their order. New uploads that are not listed there are added after them, by file name. Leave `items` as `[]` if the folder order is enough.

Image, with an optional caption:

```json
{
  "type": "image",
  "src": "assets/art/my-piece.jpg",
  "alt": "Describe the image for someone who cannot see it",
  "caption": "Optional caption"
}
```

`caption` can be left out. `full` is optional and is what opens in the full-size view; when it is missing, the site uses `src`. `alt` should describe the picture. Files that are only picked up from the folder use “Artwork by Janice SI” until you add an `alt`.

## Add videos

Self-hosted file (mp4, mov, or webm). It fills the card, keeps its own shape, and plays on its own, muted and looping. A speaker button at the bottom right of the card turns sound on for that video and mutes any other video that is playing. Tap it again to mute. A `poster` image is optional and is the still frame shown before playback. Leave it out and the card uses the opening frame instead. People who prefer less motion get a still frame until they press Play:

```json
{
  "type": "video",
  "src": "assets/art/clip.mp4",
  "poster": "assets/posters/clip-poster.jpg",
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

Each piece is shown once, in the order of `content/feed.json`. Files in `assets/art` that are not already listed there are added after those entries. A file is matched by its path, so the same picture is not shown twice. Poster images are not art cards: put them in `assets/posters/`. A file named `*-poster.*`, or a still with the same name as a video (`clip.jpg` next to `clip.mp4`), is skipped. The feed loads a few cards at a time as you scroll. With nothing in `assets/art` and an empty `items` list, visitors see the header only. The **+** card, and the short note under it, appear only in edit mode, after the art.

## Change the name

- The big title and the line under it are in `index.html` (`Janice SI` and `Welcome to my art SI`). The title is Poppins SemiBold. The line under it is Roboto Regular. There is no profile photo.

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
