import "./globals.css";
import { AuthProvider } from "../context/AuthContext";
import { ReferenceDataProvider } from "../lib/referenceData";

export const metadata = {
  title: "SI — Work Order Management",
  description: "Service Inside · Work Order Management module",
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
