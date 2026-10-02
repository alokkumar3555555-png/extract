import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IDExtractor — Government ID Extraction",
  description: "Extract and review information from Aadhaar, PAN, and Indian Driving Licence images. Images are processed temporarily and are not stored.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="en"><body>{children}</body></html>;
}
