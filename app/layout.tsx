import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
  return {
    metadataBase,
    title: "今日组合｜前瞻哑铃策略",
    description: "每天查看稳定锚仓、未来产业期权与现金目标配置。",
    icons: { icon: "/favicon.svg" },
    openGraph: {
      title: "今日组合｜前瞻哑铃策略",
      description: "稳定锚、未来期权与现金，一眼看清今天应该持有多少。",
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "今日组合" }],
      type: "website",
      locale: "zh_CN",
    },
    twitter: { card: "summary_large_image", title: "今日组合", images: ["/og.png"] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
