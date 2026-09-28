import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function encryptionKey() {
  const value = process.env.ASAAS_CREDENTIAL_ENCRYPTION_KEY ?? "";
  if (!/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error("Configure ASAAS_CREDENTIAL_ENCRYPTION_KEY com 32 bytes em hexadecimal.");
  }
  return Buffer.from(value, "hex");
}

export function encryptAsaasCredential(credential: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(credential, "utf8"), cipher.final()]);
  return {
    credential_ciphertext: ciphertext.toString("base64"),
    credential_iv: iv.toString("base64"),
    credential_tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptAsaasCredential(values: {
  credential_ciphertext: string;
  credential_iv: string;
  credential_tag: string;
}) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(values.credential_iv, "base64"));
  decipher.setAuthTag(Buffer.from(values.credential_tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(values.credential_ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
