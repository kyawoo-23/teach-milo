import Link from "next/link";
import { BookOpen } from "lucide-react";
export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="TeachBack AI home">
      <span className="brand-mark">
        <BookOpen size={20} strokeWidth={2.2} />
      </span>
      <span>
        TeachBack<span className="brand-ai"> AI</span>
      </span>
    </Link>
  );
}
