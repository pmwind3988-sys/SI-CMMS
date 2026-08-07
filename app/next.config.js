/** @type {import('next').NextConfig} */
const supabaseHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname;
  } catch {
    return "*.supabase.co";
  }
})();

const nextConfig = {
  reactStrictMode: true,

  // Static export. The whole app is client-rendered ("use client" on every
  // page) and talks to Supabase directly from the browser — PostgREST plus Row
  // Level Security, so there is no server of our own to run. `next build` emits
  // a plain static bundle into `out/`.
  //
  // That same `out/` is what Vercel serves and what Capacitor packages into the
  // APK, so web and Android ship identical UI. Keeping the export is what lets
  // the APK keep working; dropping it would unlock server routes but would also
  // mean building the Android bundle separately.
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
      // Supabase Storage signed URLs. The attachments bucket is private, so
      // these carry a token and expire — see migration 0005.
      { protocol: "https", hostname: supabaseHost },
    ],
  },
};

module.exports = nextConfig;
