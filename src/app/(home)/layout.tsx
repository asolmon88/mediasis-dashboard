import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "../globals.css";
import { ThemeProvider } from "@/components/ThemeProvider"
import { Toaster } from "@/components/ui/sonner"
import { DashboardClerkProvider } from "@/components/auth/DashboardClerkProvider"
import { ChatwootSupport } from "@/components/support/ChatwootSupport"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mediasis",
  description: "Gestione sus operaciones en línea",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <DashboardClerkProvider>
              <main>{children}</main>
              <Toaster position="bottom-center" richColors />
              <ChatwootSupport />
            </DashboardClerkProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
