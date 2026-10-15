"use client";

import "webauthn-polyfills";
import type { AuthIdentity, UserPublic } from "./contracts";
import type { PasskeyList } from "./passkey-contracts";
import { api, ApiError } from "./api-client";

export function passkeysSupported() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    !!window.PublicKeyCredential &&
    !!navigator.credentials &&
    !/^(?:\d+\.){3}\d+$/.test(window.location.hostname) &&
    !window.location.hostname.includes(":")
  );
}

export async function conditionalPasskeysSupported() {
  if (!passkeysSupported()) return false;
  try {
    const capabilities = await PublicKeyCredential.getClientCapabilities();
    return capabilities.conditionalGet === true;
  } catch {
    return false;
  }
}

export function isPasskeyCancellation(error: unknown) {
  return (
    error instanceof Error &&
    ["NotAllowedError", "AbortError"].includes(error.name)
  );
}

// Signals are optional synchronization hints. A provider failure cannot undo a
// successful server mutation or sign-in.
export async function syncPasskeys(data: PasskeyList) {
  if (!passkeysSupported()) return;
  try {
    await PublicKeyCredential.signalAllAcceptedCredentials?.({
      rpId: data.rpId,
      userId: data.userId,
      allAcceptedCredentialIds: data.passkeys.map((key) => key.id),
    });
  } catch {
    /* Optional provider synchronization. */
  }
  try {
    await PublicKeyCredential.signalCurrentUserDetails?.({
      rpId: data.rpId,
      userId: data.userId,
      name: data.name,
      displayName: data.displayName,
    });
  } catch {
    /* Optional provider synchronization. */
  }
}

export async function createPasskey(name: string, signal: AbortSignal) {
  const { options, ceremonyId } = await api<{
    options: PublicKeyCredentialCreationOptionsJSON;
    ceremonyId: string;
  }>("/api/auth/passkeys/registration/options", {}, "POST", { signal });
  signal.throwIfAborted();
  const credential = (await navigator.credentials.create({
    publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options),
    signal,
  })) as PublicKeyCredential | null;
  if (!credential)
    throw new DOMException("Passkey cancelled", "NotAllowedError");
  signal.throwIfAborted();
  const result = await api<PasskeyList>(
    "/api/auth/passkeys/registration/verify",
    {
      ceremonyId,
      name,
      credential: credential.toJSON(),
    },
    "POST",
    { signal },
  );
  return result;
}

export async function signInWithPasskey(
  signal: AbortSignal,
  conditional = false,
) {
  const { options, ceremonyId } = await api<{
    options: PublicKeyCredentialRequestOptionsJSON;
    ceremonyId: string;
  }>("/api/auth/passkeys/authentication/options", {}, "POST", { signal });
  signal.throwIfAborted();
  const credential = (await navigator.credentials.get({
    publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options),
    signal,
    ...(conditional ? { mediation: "conditional" as const } : {}),
  })) as PublicKeyCredential | null;
  if (!credential)
    throw new DOMException("Passkey cancelled", "NotAllowedError");
  signal.throwIfAborted();
  const encoded = credential.toJSON();
  try {
    return await api<AuthIdentity>(
      "/api/auth/passkeys/authentication/verify",
      {
        ceremonyId,
        credential: encoded,
      },
      "POST",
      { signal },
    );
  } catch (error) {
    if (error instanceof ApiError && error.code === "PASSKEY_NOT_FOUND") {
      try {
        const current = await api<{ user: UserPublic | null }>(
          "/api/auth/me",
          undefined,
          "GET",
          { signal },
        );
        if (!current.user)
          await PublicKeyCredential.signalUnknownCredential?.({
            rpId: options.rpId!,
            credentialId: encoded.id,
          });
      } catch {
        /* Optional provider synchronization. */
      }
    }
    throw error;
  }
}
