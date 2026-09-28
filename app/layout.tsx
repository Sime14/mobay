import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mobay | Movies, series and anime",
  description: "Find your next movie, series or anime. Search by title, person or plot, or browse top rated and popular titles.",
  keywords: ["movies", "series", "anime", "recommendations", "films", "mobay"],
  authors: [{ name: "Mobay" }],
  openGraph: {
    title: "Mobay | Movies, series and anime",
    description: "Find your next movie, series or anime",
    type: "website",
  },
};

// Applies the saved (or OS) theme before the first paint, so the page doesn't flash
// the wrong colours. Dark is the default when nothing says otherwise.
const themeScript = `try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';document.documentElement.classList.toggle('dark',t==='dark')}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The theme script changes the class before React hydrates
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* Open the connections to the poster servers while the page's own data loads */}
        <link rel="preconnect" href="https://image.tmdb.org" />
        <link rel="preconnect" href="https://s4.anilist.co" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${inter.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
