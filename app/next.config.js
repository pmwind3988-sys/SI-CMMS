/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Static export. The whole app is client-rendered ("use client" on every
  // page) and talks to Firebase directly from the browser, so there is no
  // server to run — `next build` emits a plain static bundle into `out/`.
  // That same `out/` is what Firebase Hosting serves and what Capacitor
  // packages into the APK, so web and Android ship identical UI.
  output: "export",

  // Emits `out/work-orders/view/index.html` rather than `view.html`.
  // Capacitor's local WebView server resolves directory paths to index.html,
  // so this is what makes deep links work inside the APK.
  trailingSlash: true,

  images: {
    // next/image's optimizer is a server feature and is unavailable in an
    // export; images pass through untouched.
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "firebasestorage.googleapis.com" },
    ],
  },
};

module.exports = nextConfig;
