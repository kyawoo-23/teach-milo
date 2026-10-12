"use client";

import { useI18n } from "@/components/locale-context";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { useEffect } from "react";
import { RouteStatusPage } from "@/components/route-status-page";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <RouteStatusPage
      icon={<AlertCircle size={28} strokeWidth={1.75} />}
      title={t("Something went wrong")}
      description={t(
        "TeachBack hit an unexpected snag. You can try again, or return home while we get things back on track.",
      )}
      actions={
        <>
          <button
            type="button"
            className="primary-button"
            onClick={() => reset()}
          >
            {t("Try again")}
          </button>
          <Link className="quiet-button" href="/">
            {t("Go home")}
          </Link>
        </>
      }
    />
  );
}
