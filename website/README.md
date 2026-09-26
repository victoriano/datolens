# Datolens website

Live: https://datolens.victoriano.me

Independent static site, built with Bun. No root dependencies or lockfiles are
changed. Eight Spanish/English pages: landing, download, privacy and support.

```sh
cd website
bun run build
bun run check
bun run dev
```

## Design and positioning

The copy applies the Lenny positioning/messaging and brand storytelling skill:
start with the reader's job, translate features into outcomes, demonstrate the
promise, and keep one primary action. The common job is to open an unfamiliar
large or wide file, understand its variables, investigate a pattern and share a
chart. Main audiences: analysts, data journalists, researchers, product and
operations teams. These are positioning hypotheses, not validated customer
research or testimonials.

“Muchos datos. Todo más claro.” / “Big files. Clear thinking.” leads with the
outcome. The next line supplies the concrete context: a large file on your Mac.
There are no invented benchmarks, user counts, testimonials or competitor
comparisons. Performance qualifications distinguish initial CSV/Excel import
from exploration, and sample analysis from full-data analysis. Optional AI and
the data sent to providers are disclosed without making AI the main promise.

The visual direction is editorial: warm off-white, black, blue accent, serif
emphasis, fine rules and generous space. Local fonts include their OFL licenses.
The product gallery uses six genuine native app screenshots: table, exploration
and chart views in Spanish and English. The files are unchanged copies from
`distribution/app-store/screenshots/`, whose README documents their provenance.
The app displays synthetic housing data. Each screenshot opens at full size.
The animated particle canvas only runs while visible. Keyboard navigation,
explicit gallery pause and reduced-motion handling are included.

## Deployment

Vercel project `datolens`, scope `victorianos-projects-47fceafb`.
Deploy only this directory:

```sh
vercel deploy --prod --yes --scope victorianos-projects-47fceafb
```

Cloudflare DNS has a DNS-only CNAME for `datolens` to the current Vercel target.
A Datolens-specific TXT verification value was appended to `_vercel`; existing
TXT values were preserved. Project-domain verification succeeded. HTTPS was
issued asynchronously after verification and is working. No apex DNS, other
sites or Cloudflare SSL settings were changed.

`.vercelignore` excludes build output but deliberately includes the versioned
download under `public/downloads/`, although Git ignores large packages.

## Download updates

The source of download metadata is `release.json`; build templates read it.
The public ZIP is 0.1.0 build 2, signed with Developer ID, notarized by Apple and
stapled. Gatekeeper accepted the exact app on both Macs. The original local
certificate DMG is superseded and is no longer linked from the site. No App Store
badge or speculative listing link is used.

For a new release, first verify the native bundle. Export and notarize through
Xcode, make a ZIP preserving the stapled app, then run:

```sh
python3 distribution/macos/publish-notarized-beta.py /absolute/path/to/Datolens.zip
```

Run that command from the repository root. It verifies the exact extracted app's
bundle identifier, Developer ID signature, Hardened Runtime, stapled ticket and
Gatekeeper assessment before setting `notarized: true`. It refuses to overwrite a
versioned archive with different bytes, records provenance and updates the
manifest/checksum. Rebuild, deploy and re-download from the production domain to
compare SHA-256. Never publish provisioning profiles, keys, caches or user data.

Current validation and Apple submission status: `../docs/status/distribution.md`.
