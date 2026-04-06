import { Platform } from "react-native";
import { createWorker } from "tesseract.js";

export async function extractTextFromImage(imageUri: string) {
  if (!imageUri) {
    throw new Error("No image was provided for OCR.");
  }

  if (Platform.OS === "web") {
    const worker = await createWorker("eng");

    try {
      const result = await worker.recognize(imageUri);
      return result.data.text ?? "";
    } finally {
      await worker.terminate();
    }
  }

  const { recognizeText } = require("@infinitered/react-native-mlkit-text-recognition") as {
    recognizeText: (path: string) => Promise<{ text: string; blocks?: Array<{ text: string }> }>;
  };

  try {
    const result = await recognizeText(imageUri);
    const normalizedText = result?.text?.trim();

    if (normalizedText) {
      return normalizedText;
    }

    const blockText = result?.blocks?.map(block => block.text).filter(Boolean).join("\n").trim() ?? "";
    if (blockText) {
      return blockText;
    }

    throw new Error("No text was detected in the selected image.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Native OCR could not process this image.";
    throw new Error(message);
  }
}
