import Image from "next/image";
import Link from "next/link";

const BRAND_ICON = "/brand/teachback-icon-64.png";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="TeachBack AI home">
      <span className="brand-mark">
        <Image
          src={BRAND_ICON}
          alt="TeachBack-AI"
          width={64}
          height={64}
          sizes="36px"
          priority
        />
      </span>
      <span>
        TeachBack<span className="brand-ai"> AI</span>
      </span>
    </Link>
  );
}
