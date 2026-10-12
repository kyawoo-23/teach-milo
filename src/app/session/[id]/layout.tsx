import { notFound } from "next/navigation";
import { Id } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { getAuthenticatedUser } from "@/server/auth";
import { readOwned } from "@/server/db";
import { SessionExperience } from "@/components/session-experience";

export default async function SessionLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;
  if (!Id.safeParse(id).success) notFound();
  const user = await getAuthenticatedUser();
  if (user) {
    try {
      await readOwned("sessions", id, user.id);
    } catch (e) {
      if (e instanceof AppError && ["NOT_FOUND", "EXPIRED"].includes(e.code))
        notFound();
      throw e;
    }
  }
  return (
    <>
      <SessionExperience key={id} id={id} />
      {children}
    </>
  );
}
