"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { I18nProvider } from "@/components/i18n-provider";
import type { LanguagePreference, Locale } from "@/lib/locale";
export function Providers({
  children,
  initialLanguage,
  initialLocale,
}: {
  children: React.ReactNode;
  initialLanguage: LanguagePreference;
  initialLocale: Locale;
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: 15_000,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );
  return (
    <I18nProvider
      initialLanguage={initialLanguage}
      initialLocale={initialLocale}
    >
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </I18nProvider>
  );
}
