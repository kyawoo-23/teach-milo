"use client";

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
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <RouteStatusPage
      icon={<AlertCircle size={28} strokeWidth={1.75} />}
      title="Something went wrong"
      description="TeachBack hit an unexpected snag. You can try again, or return home while we get things back on track."
      actions={
        <>
          <button type="button" className="primary-button" onClick={() => reset()}>
            Try again
          </button>
          <Link className="quiet-button" href="/">
            Go home
          </Link>
        </>
      }
    />
  );
}
