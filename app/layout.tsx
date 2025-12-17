import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CineMatch AI | Movie Recommendations",
  description: "Discover your next favorite movie with AI-powered recommendations. Describe the kind of movie you're in the mood for, and we'll find the perfect match.",
  keywords: ["movies", "recommendations", "AI", "films", "cinema", "entertainment"],
  authors: [{ name: "CineMatch" }],
  openGraph: {
    title: "CineMatch AI | Movie Recommendations",
    description: "Discover your next favorite movie with AI-powered recommendations",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${spaceGrotesk.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
