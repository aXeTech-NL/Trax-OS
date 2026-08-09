export function tamperJwtSignature(token: string): string {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[2]) {
    throw new Error("A compact JWT with a signature is required.");
  }
  const signature = Buffer.from(parts[2], "base64url");
  if (signature.length === 0) {
    throw new Error("JWT signature bytes are required.");
  }
  const tampered = Buffer.from(signature);
  const lastIndex = tampered.length - 1;
  tampered[lastIndex] = tampered[lastIndex]! ^ 0x01;
  parts[2] = tampered.toString("base64url");
  return parts.join(".");
}
