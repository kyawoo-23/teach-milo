"use client";

import { useI18n } from "@/components/locale-context";
import Image from "next/image";
import Link from "next/link";

const BRAND_ICON = "/brand/teach-milo-mark.svg";

export function Brand() {
  const { t } = useI18n();

  return (
    <Link className="brand" href="/" aria-label={t("Teach Milo home")}>
      <span className="brand-mark" aria-hidden="true">
        <Image
          src={BRAND_ICON}
          alt=""
          width={64}
          height={64}
          sizes="36px"
          unoptimized
          priority
        />
      </span>
      <span>Teach Milo</span>
    </Link>
  );
}
