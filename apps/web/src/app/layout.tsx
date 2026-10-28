import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { Providers } from "@/components/providers";
import {
  acceptedLocale,
  LANGUAGE_COOKIE,
  languagePreference,
  translate,
} from "@/lib/locale";
import "./globals.css";
async function requestLanguage() {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  const initialLanguage = languagePreference(
    cookieStore.get(LANGUAGE_COOKIE)?.value,
  );
  const initialLocale =
    initialLanguage === "system"
      ? acceptedLocale(headerList.get("accept-language"))
      : initialLanguage;
  return { initialLanguage, initialLocale };
}
export async function generateMetadata(): Promise<Metadata> {
  const { initialLocale } = await requestLanguage();
  return {
    title: {
      default: translate(initialLocale, "PersonalOS — A little more headspace"),
      template: "%s · PersonalOS",
    },
    description: translate(
      initialLocale,
      "Your private AI workspace for a more intentional day. Tasks, memory, calendar and thoughtful automation.",
    ),
  };
}
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { initialLanguage, initialLocale } = await requestLanguage();
  return (
    <html lang={initialLocale} suppressHydrationWarning>
      <body>
        <Providers
          initialLanguage={initialLanguage}
          initialLocale={initialLocale}
        >
          {children}
        </Providers>
      </body>
    </html>
  );
}
