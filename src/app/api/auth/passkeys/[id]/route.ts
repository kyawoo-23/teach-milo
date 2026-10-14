import { getAuthenticatedUser } from "@/server/auth";
import { AppError } from "@/lib/errors";
import { CredentialIdSchema, PasskeyNameSchema } from "@/lib/passkey-contracts";
import { assertOrigin, json, respond, route } from "@/server/http";
import { changePasskey, listPasskeys } from "@/server/passkeys";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
async function mutate(request: Request, context: Context, rename: boolean) {
  return route(async () => {
    assertOrigin(request);
    const user = await getAuthenticatedUser();
    if (!user)
      throw new AppError(
        "AUTH_REQUIRED",
        "Sign in or create an account to continue.",
        401,
      );
    const id = CredentialIdSchema.parse((await context.params).id);
    const input = rename ? await json(request, PasskeyNameSchema) : undefined;
    await changePasskey(user, id, input?.name);
    return respond(await listPasskeys(user));
  });
}
export const PATCH = (request: Request, context: Context) =>
  mutate(request, context, true);
export const DELETE = (request: Request, context: Context) =>
  mutate(request, context, false);
