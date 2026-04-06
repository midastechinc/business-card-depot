import { Platform } from "react-native";
import { createWorker } from "tesseract.js";

export async function extractTextFromImage(imageUri: string) {
  if (!imageUri) {
    throw new Error("No image was provided for OCR.");
  }

  if (Platform.OS !== "web") {
    throw new Error("OCR is wired for web preview first. Native OCR integration is the next mobile step.");
  }

  const worker = await createWorker("eng");

  try {
    const result = await worker.recognize(imageUri);
    return result.data.text ?? "";
  } finally {
    await worker.terminate();
  }
}
