import Link from "next/link";
import { Compass } from "lucide-react";
import { RouteStatusPage } from "@/components/route-status-page";

export default function NotFound() {
  return (
    <RouteStatusPage
      icon={<Compass size={28} strokeWidth={1.75} />}
      title="This page isn’t here"
      description="The link may be outdated, or the session may have been removed. Head home to start a fresh lesson with Milo."
      actions={
        <Link className="primary-button" href="/">
          Back to home
        </Link>
      }
    />
  );
}
