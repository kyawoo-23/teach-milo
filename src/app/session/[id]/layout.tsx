import { SessionExperience } from "@/components/session-experience";

export default async function SessionLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  return (
    <>
      <SessionExperience id={(await params).id} />
      {children}
    </>
  );
}
