import { notFound } from "next/navigation";
import { Id } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { getAuthenticatedUser } from "@/server/auth";
import { getGuest, guestClaimState } from "@/server/guests";
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
  const ownerId = user?.id ?? (await getGuest())?.id;
  const claiming =
    user && (await guestClaimState(user.id))?.status === "pending";
  if (ownerId && !claiming) {
    try {
      await readOwned("sessions", id, ownerId);
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
