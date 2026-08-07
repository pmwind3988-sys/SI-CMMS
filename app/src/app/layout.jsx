import "./globals.css";
import { AuthProvider } from "../context/AuthContext";

export const metadata = {
  title: "SI — Work Order Management",
  description: "Service Inside · Work Order Management module",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
