import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";

/**
 * Ed25519 helpers. On the wire and in env/secrets, keys are plain base64 strings:
 * private = PKCS#8 DER, public = the raw 32 bytes (what the launch report publishes).
 */
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const RAW_PUBLIC_KEY_BYTES = 32;

export interface KeyPairB64 {
  privateKey: string;
  publicKey: string;
}

export function generateKeyPair(): KeyPairB64 {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  return {
    privateKey: privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64"),
    publicKey: spki.subarray(spki.length - RAW_PUBLIC_KEY_BYTES).toString("base64"),
  };
}

export function importPrivateKey(b64: string): KeyObject {
  return createPrivateKey({
    key: Buffer.from(b64, "base64"),
    format: "der",
    type: "pkcs8",
  });
}

export function importPublicKey(b64: string): KeyObject {
  const raw = Buffer.from(b64, "base64");
  if (raw.length !== RAW_PUBLIC_KEY_BYTES)
    throw new TypeError("public key must be 32 raw bytes");
  return createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
}

export const signUtf8 = (message: string, privateKeyB64: string): string =>
  sign(null, Buffer.from(message, "utf8"), importPrivateKey(privateKeyB64)).toString(
    "base64url",
  );

/** Never throws: malformed keys or signatures are just "not valid". */
export function verifyUtf8(
  message: string,
  signatureB64url: string,
  publicKeyB64: string,
): boolean {
  try {
    return verify(
      null,
      Buffer.from(message, "utf8"),
      importPublicKey(publicKeyB64),
      Buffer.from(signatureB64url, "base64url"),
    );
  } catch {
    return false;
  }
}
