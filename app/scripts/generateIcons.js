/**
 * SI — Service Inside · launcher icon / favicon generation
 *
 * Renders resources/icon.svg and resources/icon-foreground.svg into every
 * Android density, the iOS / PWA home-screen icons, and the web favicon, so the
 * app icon is the same mark AppShell draws at the top of the screen instead of
 * the Capacitor default.
 *
 * Legacy PNGs are generated as well as the adaptive layers, not instead of
 * them: adaptive icons are Android 8 and up, and this app ships minSdk 22.
 * Below 26 the launcher reads ic_launcher.png directly, so leaving those alone
 * would have left older handsets on the blue Capacitor mark.
 *
 * Run after changing either SVG:  npm run icons
 * Then rebuild the APK, since cap sync does not touch android/app/src/main/res.
 * The web and iOS outputs need only a redeploy — they are ordinary build input.
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const APP = path.join(__dirname, "..");
const RES = path.join(APP, "android/app/src/main/res");
const PUBLIC_ICONS = path.join(APP, "public/icons");
const SRC_SQUARE = path.join(APP, "resources/icon.svg");
const SRC_FOREGROUND = path.join(APP, "resources/icon-foreground.svg");

/** The tile colour in icon.svg, repeated here because the flattened variants
    have to fill the corners that its rx=9 rounding leaves transparent. */
const BRAND_NAVY = "#0F3D91";

// Launcher icon is 48dp, the adaptive foreground 108dp; both scale by density.
const DENSITIES = [
  ["mdpi", 1],
  ["hdpi", 1.5],
  ["xhdpi", 2],
  ["xxhdpi", 3],
  ["xxxhdpi", 4],
];

async function render(src, size, out) {
  const svg = fs.readFileSync(src);
  await sharp(svg, { density: 512 }).resize(size, size).png().toFile(out);
  return `${path.relative(APP, out).replace(/\\/g, "/")}  ${size}x${size}`;
}

/** A circular crop for ic_launcher_round, rather than a rounded square in a circle hole. */
async function renderRound(src, size, out) {
  const svg = fs.readFileSync(src);
  const flat = await sharp(svg, { density: 512 }).resize(size, size).png().toBuffer();
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`
  );
  await sharp(flat)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toFile(out);
  return `${path.relative(APP, out).replace(/\\/g, "/")}  ${size}x${size} (circular)`;
}

/**
 * A square with no transparency anywhere in it.
 *
 * iOS composites an apple-touch-icon over black, so the rounded corners of
 * icon.svg come out as four black notches inside the squircle the OS then masks
 * it with. Flattening onto the tile colour makes the corners navy, and the mask
 * puts the rounding back — the same reason a maskable manifest icon must bleed
 * to its own edges rather than draw its own.
 */
async function renderOpaque(src, size, out) {
  const svg = fs.readFileSync(src);
  await sharp(svg, { density: 512 })
    .resize(size, size)
    .flatten({ background: BRAND_NAVY })
    .png()
    .toFile(out);
  return `${path.relative(APP, out).replace(/\\/g, "/")}  ${size}x${size} (opaque)`;
}

/**
 * The maskable variant, built from the *foreground* layer rather than the
 * square one.
 *
 * `purpose: "maskable"` means the launcher may crop anything outside the centre
 * circle — roughly 80% of the width — and icon.svg draws its mark almost to the
 * tile edge, so cropping it eats the amber dot. icon-foreground.svg already
 * holds the mark inside the adaptive-icon safe zone for exactly this reason;
 * putting it on a flat navy field reuses that work.
 */
async function renderMaskable(size, out) {
  const svg = fs.readFileSync(SRC_FOREGROUND);
  const mark = await sharp(svg, { density: 512 }).resize(size, size).png().toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: BRAND_NAVY },
  })
    .composite([{ input: mark }])
    .png()
    .toFile(out);
  return `${path.relative(APP, out).replace(/\\/g, "/")}  ${size}x${size} (maskable)`;
}

async function main() {
  const written = [];

  for (const [density, scale] of DENSITIES) {
    const dir = path.join(RES, `mipmap-${density}`);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    written.push(await render(SRC_SQUARE, Math.round(48 * scale), path.join(dir, "ic_launcher.png")));
    written.push(await renderRound(SRC_SQUARE, Math.round(48 * scale), path.join(dir, "ic_launcher_round.png")));
    written.push(
      await render(SRC_FOREGROUND, Math.round(108 * scale), path.join(dir, "ic_launcher_foreground.png"))
    );
  }

  // Capacitor's splash: the mark on the brand navy, sized so it does not fill
  // the screen on a tablet. 480x480 is the density-independent source Capacitor
  // scales from.
  written.push(await render(SRC_SQUARE, 480, path.join(RES, "drawable/splash.png")));

  // The web favicon. Next's App Router picks src/app/icon.svg up automatically
  // and emits the <link rel="icon">, which works under output: "export".
  const favicon = path.join(APP, "src/app/icon.svg");
  fs.copyFileSync(SRC_SQUARE, favicon);
  written.push(`${path.relative(APP, favicon).replace(/\\/g, "/")}  (vector)`);

  // iOS home-screen icon. `src/app/apple-icon.png` is the App Router's file
  // convention for it — Next emits <link rel="apple-touch-icon"> from the file
  // being there, same as icon.svg above, and both survive the static export.
  //
  // 180x180 is the iPhone @3x size and the only one worth shipping: iOS
  // downsamples a larger icon cleanly, and every other rel="apple-touch-icon"
  // size exists to save bytes on hardware this app does not target.
  written.push(await renderOpaque(SRC_SQUARE, 180, path.join(APP, "src/app/apple-icon.png")));

  // Manifest icons, for Android/desktop installs and for iOS 16.4+, which reads
  // the manifest as well as the link tag.
  if (!fs.existsSync(PUBLIC_ICONS)) fs.mkdirSync(PUBLIC_ICONS, { recursive: true });
  written.push(await render(SRC_SQUARE, 192, path.join(PUBLIC_ICONS, "icon-192.png")));
  written.push(await render(SRC_SQUARE, 512, path.join(PUBLIC_ICONS, "icon-512.png")));
  written.push(await renderMaskable(512, path.join(PUBLIC_ICONS, "icon-maskable-512.png")));

  console.log(written.map((w) => `  ${w}`).join("\n"));
  console.log(`\n${written.length} files written. Rebuild the APK to pick them up:  npm run apk`);
  console.log(`The web and iOS/PWA icons are picked up by the next  npm run build.`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
