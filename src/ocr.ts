import { Platform } from "react-native";
import { createWorker } from "tesseract.js";
import type { OcrInputLine, OcrPayload } from "./contactParser";

type NativeRecognitionResult = {
  text?: string;
  blocks?: Array<{
    text?: string;
    frame?: { left: number; top: number; right: number; bottom: number };
    lines?: Array<{
      text?: string;
      frame?: { left: number; top: number; right: number; bottom: number };
    }>;
  }>;
};

export async function extractOcrPayloadFromImage(imageUri: string): Promise<OcrPayload> {
  if (!imageUri) {
    throw new Error("No image was provided for OCR.");
  }

  if (Platform.OS === "web") {
    const worker = await createWorker("eng");

    try {
      const result = await worker.recognize(imageUri);
      const data = result.data as {
        text?: string;
        lines?: Array<{
          text?: string;
          bbox?: { x0: number; y0: number; x1: number; y1: number };
        }>;
      };

      return {
        text: data.text ?? "",
        lines: (data.lines ?? []).map((line, index) => ({
          text: line.text ?? "",
          top: line.bbox?.y0 ?? index,
          left: line.bbox?.x0 ?? 0,
          right: line.bbox?.x1,
          bottom: line.bbox?.y1,
          lineIndex: index
        })),
        engine: "web-tesseract"
      };
    } finally {
      await worker.terminate();
    }
  }

  const { recognizeText } = require("@infinitered/react-native-mlkit-text-recognition") as {
    recognizeText: (path: string) => Promise<NativeRecognitionResult>;
  };

  try {
    const result = await recognizeText(imageUri);
    const lines = normalizeNativeLines(result);
    const text = result?.text?.trim() || lines.map(line => line.text).join("\n");

    if (!text.trim()) {
      throw new Error("No text was detected in the selected image.");
    }

    return {
      text,
      lines,
      engine: "native-mlkit"
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Native OCR could not process this image.";
    throw new Error(message);
  }
}

export async function extractTextFromImage(imageUri: string) {
  const payload = await extractOcrPayloadFromImage(imageUri);
  return payload.text;
}

function normalizeNativeLines(result: NativeRecognitionResult) {
  const lines: OcrInputLine[] = [];

  result.blocks?.forEach((block, blockIndex) => {
    block.lines?.forEach((line, lineIndex) => {
      lines.push({
        text: line.text ?? "",
        top: line.frame?.top ?? lineIndex,
        left: line.frame?.left ?? 0,
        right: line.frame?.right,
        bottom: line.frame?.bottom,
        blockIndex,
        lineIndex
      });
    });

    if ((!block.lines || block.lines.length === 0) && block.text) {
      lines.push({
        text: block.text,
        top: block.frame?.top ?? blockIndex,
        left: block.frame?.left ?? 0,
        right: block.frame?.right,
        bottom: block.frame?.bottom,
        blockIndex
      });
    }
  });

  return lines;
}
