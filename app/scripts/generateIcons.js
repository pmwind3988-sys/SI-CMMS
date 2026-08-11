/**
 * SI — Service Inside · launcher icon / favicon generation
 *
 * Renders resources/icon.svg and resources/icon-foreground.svg into every
 * Android density plus the web favicon, so the app icon is the same mark
 * AppShell draws at the top of the screen instead of the Capacitor default.
 *
 * Legacy PNGs are generated as well as the adaptive layers, not instead of
 * them: adaptive icons are Android 8 and up, and this app ships minSdk 22.
 * Below 26 the launcher reads ic_launcher.png directly, so leaving those alone
 * would have left older handsets on the blue Capacitor mark.
 *
 * Run after changing either SVG:  npm run icons
 * Then rebuild the APK, since cap sync does not touch android/app/src/main/res.
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const APP = path.join(__dirname, "..");
const RES = path.join(APP, "android/app/src/main/res");
const SRC_SQUARE = path.join(APP, "resources/icon.svg");
const SRC_FOREGROUND = path.join(APP, "resources/icon-foreground.svg");

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

  console.log(written.map((w) => `  ${w}`).join("\n"));
  console.log(`\n${written.length} files written. Rebuild the APK to pick them up:  npm run apk`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
