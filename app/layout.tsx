import type { Metadata } from "next";
import { Nanum_Gothic } from "next/font/google";
import { ClientPuzzleWarmup } from "@/components/ClientPuzzleWarmup";
import { getSiteOrigin } from "@/lib/siteUrl";
import "./globals.css";

const nanumGothic = Nanum_Gothic({
  weight: ["400", "700", "800"],
  subsets: ["latin"],
  variable: "--font-nanum-gothic",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(getSiteOrigin()),
  title: "뉴스 크로스워드",
  description: "오늘의 뉴스로 만드는 크로스워드 퍼즐",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={`${nanumGothic.variable} ${nanumGothic.className} font-sans antialiased`}>
        <ClientPuzzleWarmup />
        {children}
      </body>
    </html>
  );
}
