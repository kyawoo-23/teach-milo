import { z } from "zod";

// Unpadded base64url only; credential IDs may contain up to 1023 bytes.
export const CredentialIdSchema = z
  .string()
  .min(1)
  .max(1364)
  .regex(/^[A-Za-z0-9_-]+$/);
const encoded = z
  .string()
  .min(1)
  .max(100_000)
  .regex(/^[A-Za-z0-9_-]+$/);
const common = {
  id: CredentialIdSchema,
  rawId: CredentialIdSchema,
  type: z.literal("public-key"),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
  clientExtensionResults: z.object({
    credProps: z.object({ rk: z.boolean().optional() }).optional(),
  }),
};
export const PasskeyRegistrationSchema = z.object({
  ceremonyId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  credential: z.object({
    ...common,
    response: z.object({
      clientDataJSON: encoded,
      attestationObject: encoded,
      transports: z
        .array(
          z.enum([
            "ble",
            "cable",
            "hybrid",
            "internal",
            "nfc",
            "smart-card",
            "usb",
          ]),
        )
        .max(10)
        .optional(),
      publicKeyAlgorithm: z.number().int().optional(),
      publicKey: encoded.optional(),
      authenticatorData: encoded.optional(),
    }),
  }),
});
export const PasskeyAuthenticationSchema = z.object({
  ceremonyId: z.uuid(),
  credential: z.object({
    ...common,
    response: z.object({
      clientDataJSON: encoded,
      authenticatorData: encoded,
      signature: encoded,
      userHandle: encoded,
    }),
  }),
});
export const PasskeyNameSchema = z
  .object({ name: z.string().trim().min(1).max(80) })
  .strict();

export type PasskeySummary = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string;
};
export type PasskeyList = {
  passkeys: PasskeySummary[];
  rpId: string;
  userId: string;
  name: string;
  displayName: string;
};
