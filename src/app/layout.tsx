import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { PwaProvider } from "@/components/providers/PwaProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DataBoy - High-Performance Assignment Platform",
  description: "Secure, reliable, and premium portal for assignment tracking across Students, Writers, and Admins.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/brand-pack/Favicons/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand-pack/Favicons/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [
      { url: "/brand-pack/App-Icons/app-icon-180x180.png", sizes: "180x180", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "DataBoy",
  },
  formatDetection: {
    telephone: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <AuthProvider>
            <PwaProvider>
              {children}
            </PwaProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
