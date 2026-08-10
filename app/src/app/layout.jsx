import "./globals.css";
import { AuthProvider } from "../context/AuthContext";
import { ReferenceDataProvider } from "../lib/referenceData";

export const metadata = {
  title: "SI — Work Order Management",
  description: "Service Inside · Work Order Management module",
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
