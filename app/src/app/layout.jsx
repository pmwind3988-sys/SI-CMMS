import "./globals.css";
import { AuthProvider } from "../context/AuthContext";
import { ReferenceDataProvider } from "../lib/referenceData";

export const metadata = {
  title: "SI — Work Order Management",
  description: "Service Inside · Work Order Management module",

  /**
   * Installing on a phone.
   *
   * Android ships as an APK; iOS has no equivalent here, because a native iOS
   * build needs a Mac and a paid Apple Developer account and this repo builds
   * on neither. What it has instead is the same static export installed from
   * Safari — Share → Add to Home Screen — which needs no store, no signing and
   * no review, and lands a real icon on the springboard that opens full screen
   * with no browser chrome.
   *
   * `manifest` is what supplies the name, the icons and `display: standalone`.
   * `appleWebApp` is not redundant with it: iOS reads the manifest only from
   * 16.4 onwards, and the meta tags below are what an older iPhone honours.
   * Both are cheap and they agree, so ship both.
   *
   * `statusBarStyle` is deliberately "default" rather than "black-translucent".
   * Translucent draws the status bar clock in white over the top of the page,
   * and AppShell's header is white — the time and battery would vanish on every
   * screen except the sign-in page. The layout already pads for
   * safe-area-inset-top either way, so opaque costs nothing.
   *
   * `apple-icon.png` (180x180, opaque — iOS composites over black) is picked up
   * from src/app/ by file convention, like icon.svg. Regenerate both with
   * `npm run icons`.
   */
  manifest: "/manifest.webmanifest",
  applicationName: "SI CMMS",
  appleWebApp: {
    capable: true,
    title: "SI CMMS",
    statusBarStyle: "default",
  },

  /**
   * `appleWebApp.capable` no longer emits Apple's own tag.
   *
   * Next 16 renders the standardised `mobile-web-app-capable` for it and drops
   * `apple-mobile-web-app-capable`, which Chrome deprecated — but which is the
   * only one iOS below 16.4 reads. On those versions the manifest is ignored
   * entirely, so without this the icon still installs and then opens inside
   * Safari's chrome instead of full screen. One tag, and it is the difference
   * between an app and a bookmark on an older handset.
   *
   * Check this if the head tags are ever audited and it looks like a duplicate:
   * it is not one, and `next build` does not emit it.
   */
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

/**
 * Next injects a default viewport tag, but not one that works for this app.
 *
 * `viewportFit: "cover"` is what makes env(safe-area-inset-*) return real
 * numbers — without it the insets are always 0 and the top bar sits under the
 * status bar / camera cutout on a notched phone and under Android 15's forced
 * edge-to-edge display in the APK.
 *
 * `maximumScale` is deliberately 5 rather than 1: pinch-zoom is an
 * accessibility affordance, and technicians read WO numbers off this in a
 * plant. The 16px form-control rule in globals.css is what stops the *automatic*
 * focus zoom, so there's no reason to disable manual zoom too.
 */
export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  themeColor: "#0F3D91",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {/* Reference data sits inside AuthProvider: its queries are RLS-scoped
            to authenticated, so they can only run once a session exists. */}
        <AuthProvider>
          <ReferenceDataProvider>{children}</ReferenceDataProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
