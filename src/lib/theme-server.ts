import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { THEME_COOKIE, resolveTheme } from "./theme";
export const getTheme = cache(async () =>
  resolveTheme((await cookies()).get(THEME_COOKIE)?.value),
);
