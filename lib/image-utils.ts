import convert from "heic-convert";

export async function convertHeicToJpeg(base64Heic: string): Promise<string> {
  const inputBuffer = Buffer.from(base64Heic, "base64");
  const outputBuffer = await convert({ buffer: inputBuffer, format: "JPEG", quality: 0.9 });
  return outputBuffer.toString("base64");
}
