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
  title: "SBS 뉴스 크로스워드",
  description:
    "게임처럼 즐기다 보면 어느새 상식 마스터! 지금 도전하세요~!",
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
