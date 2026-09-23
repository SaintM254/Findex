# Preview assets

- `images/findex-hero.png` and `images/alpine-lake.jpg`: AI-generated illustrations / sample photography created for Findex.
- `images/coastal-escape.jpg`: Unsplash sample photograph, retrieved from https://unsplash.com/s/photos/aerial-view-of-ocean (photo-1510279770292-4b34de9f5c23). Unsplash license: https://unsplash.com/license.
- Sample PDF documents and audio: locally generated, fictional content. Source: `scripts/generate-samples.py`.
- `samples/alpine-morning.mp4`: silent sample video made from the generated alpine photograph.

These are browser-preview sample files, not a representation of the user's device contents.

## Findex 1.1 branding

- `findex.svg`, `images/findex-mark.svg`, `images/findex-icon.png`, and the Android launcher/splash assets are rendered from the SVG supplied by the project owner on 2026-09-23. Paths, blue gradients, embedded paper shadow, and wordmark placement are preserved. The external DTD and malformed Markdown URL wrappers were removed.
- Poppins Bold lettering is converted to vector outlines so the icon does not depend on device fonts. Font source: Google Fonts `ofl/poppins/Poppins-Bold.ttf`; the SIL Open Font License is retained at `assets/fonts/OFL.txt`.
- Rebuild these generated assets with `npm run branding`. The supplied editable SVG is retained at `assets/branding/findex-original.svg`.
