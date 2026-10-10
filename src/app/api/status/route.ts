import { respond } from "@/server/http";
export async function GET() {
  const missing = [
    !process.env.GEMINI_API_KEY && "GEMINI_API_KEY",
    !process.env.GOOGLE_CLOUD_PROJECT && "GOOGLE_CLOUD_PROJECT",
  ].filter(Boolean);
  return respond({ configured: missing.length === 0, missing });
}
