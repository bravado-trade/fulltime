import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "FullTime — settled at the final whistle",
  description:
    "P2P World Cup prediction markets on Solana, settled trustlessly by TxODDS TxLINE Merkle proofs. By Bravado.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body className="min-h-screen bg-[#0a0e14] text-slate-200">
        <Providers>
          <header className="border-b border-slate-800 bg-[#0d1219]">
            <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
              <a href="/" className="flex items-baseline gap-2">
                <span className="text-xl font-bold tracking-tight text-white">
                  Full<span className="text-emerald-400">Time</span>
                </span>
                <span className="text-xs text-slate-500">by Bravado</span>
              </a>
              <div className="flex items-center gap-3 text-xs text-slate-400">
                <span className="rounded bg-slate-800 px-2 py-1">devnet</span>
                <span className="hidden sm:inline">
                  settled by <span className="text-amber-400">TxODDS TxLINE</span> Merkle proofs
                </span>
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
          <footer className="mx-auto max-w-5xl px-4 py-8 text-xs text-slate-600">
            No votes. No committees. No 2-hour dispute windows. Markets settle seconds after the
            final whistle against sports data cryptographically anchored on Solana by TxODDS.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
