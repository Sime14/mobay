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
  title: "Mobay | Movie Recommendations",
  description: "Discover your next favorite movie with Mobay. Describe the kind of movie you're in the mood for, and we'll find the perfect match.",
  keywords: ["movies", "recommendations", "films", "cinema", "entertainment", "mobay"],
  authors: [{ name: "Mobay" }],
  openGraph: {
    title: "Mobay | Movie Recommendations",
    description: "Discover your next favorite movie with Mobay",
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
