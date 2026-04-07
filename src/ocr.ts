import { Image as RNImage, Platform } from "react-native";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
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

type ImageDimensions = {
  width: number;
  height: number;
};

type OcrVariant = {
  uri: string;
  label: string;
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
};

export async function extractOcrPayloadFromImage(imageUri: string): Promise<OcrPayload> {
  if (!imageUri) {
    throw new Error("No image was provided for OCR.");
  }

  const dimensions = await getImageDimensions(imageUri);
  const variants = await buildImageVariants(imageUri, dimensions);

  if (Platform.OS === "web") {
    const worker = await createWorker("eng");

    try {
      const payloads = [];
      for (const variant of variants) {
        payloads.push(await runWebOcr(worker, variant));
      }
      return mergePayloads(payloads, "web-tesseract");
    } finally {
      await worker.terminate();
      await cleanupWebVariants(variants);
    }
  }

  const { recognizeText } = require("@infinitered/react-native-mlkit-text-recognition") as {
    recognizeText: (path: string) => Promise<NativeRecognitionResult>;
  };

  const payloads = [];
  for (const variant of variants) {
    payloads.push(await runNativeOcr(recognizeText, variant));
  }

  const merged = mergePayloads(payloads, "native-mlkit");
  if (!merged.text.trim()) {
    throw new Error("No text was detected in the selected image.");
  }

  return merged;
}

export async function extractTextFromImage(imageUri: string) {
  const payload = await extractOcrPayloadFromImage(imageUri);
  return payload.text;
}

async function buildImageVariants(imageUri: string, dimensions: ImageDimensions) {
  const variants: OcrVariant[] = [
    {
      uri: imageUri,
      label: "original",
      scaleX: 1,
      scaleY: 1,
      offsetX: 0,
      offsetY: 0
    }
  ];

  const normalizedWidth = Math.min(Math.max(dimensions.width, 1600), 2200);
  if (dimensions.width && Math.abs(normalizedWidth - dimensions.width) > 120) {
    const normalized = await manipulateAsync(
      imageUri,
      [{ resize: { width: normalizedWidth } }],
      { compress: 1, format: SaveFormat.JPEG }
    );

    const scaleX = dimensions.width / normalized.width;
    const scaleY = dimensions.height / normalized.height;

    variants.push({
      uri: normalized.uri,
      label: "normalized",
      scaleX,
      scaleY,
      offsetX: 0,
      offsetY: 0
    });

    const topCropHeight = Math.round(normalized.height * 0.58);
    const bottomCropOrigin = Math.max(0, normalized.height - topCropHeight);
    const topCrop = await manipulateAsync(
      normalized.uri,
      [{ crop: { originX: 0, originY: 0, width: normalized.width, height: topCropHeight } }],
      { compress: 1, format: SaveFormat.JPEG }
    );
    const bottomCrop = await manipulateAsync(
      normalized.uri,
      [{ crop: { originX: 0, originY: bottomCropOrigin, width: normalized.width, height: topCropHeight } }],
      { compress: 1, format: SaveFormat.JPEG }
    );

    variants.push(
      {
        uri: topCrop.uri,
        label: "top-focus",
        scaleX,
        scaleY,
        offsetX: 0,
        offsetY: 0
      },
      {
        uri: bottomCrop.uri,
        label: "bottom-focus",
        scaleX,
        scaleY,
        offsetX: 0,
        offsetY: bottomCropOrigin * scaleY
      }
    );
  }

  if (Platform.OS === "web") {
    const contrastVariant = await createWebContrastVariant(imageUri, dimensions);
    if (contrastVariant) {
      variants.push(contrastVariant);
    }
  }

  return dedupeVariants(variants);
}

async function runWebOcr(worker: Awaited<ReturnType<typeof createWorker>>, variant: OcrVariant): Promise<OcrPayload> {
  const result = await worker.recognize(variant.uri);
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
      top: scaleCoordinate(line.bbox?.y0 ?? index, variant.scaleY, variant.offsetY),
      left: scaleCoordinate(line.bbox?.x0 ?? 0, variant.scaleX, variant.offsetX),
      right: scaleCoordinate(line.bbox?.x1 ?? 0, variant.scaleX, variant.offsetX),
      bottom: scaleCoordinate(line.bbox?.y1 ?? index + 1, variant.scaleY, variant.offsetY),
      lineIndex: index
    })),
    engine: "web-tesseract"
  };
}

async function runNativeOcr(
  recognizeText: (path: string) => Promise<NativeRecognitionResult>,
  variant: OcrVariant
): Promise<OcrPayload> {
  const result = await recognizeText(variant.uri);
  const lines = normalizeNativeLines(result, variant);
  const text = result?.text?.trim() || lines.map(line => line.text).join("\n");

  return {
    text,
    lines,
    engine: "native-mlkit"
  };
}

function normalizeNativeLines(result: NativeRecognitionResult, variant: OcrVariant) {
  const lines: OcrInputLine[] = [];

  result.blocks?.forEach((block, blockIndex) => {
    block.lines?.forEach((line, lineIndex) => {
      lines.push({
        text: line.text ?? "",
        top: scaleCoordinate(line.frame?.top ?? lineIndex, variant.scaleY, variant.offsetY),
        left: scaleCoordinate(line.frame?.left ?? 0, variant.scaleX, variant.offsetX),
        right: scaleCoordinate(line.frame?.right ?? 0, variant.scaleX, variant.offsetX),
        bottom: scaleCoordinate(line.frame?.bottom ?? lineIndex + 1, variant.scaleY, variant.offsetY),
        blockIndex,
        lineIndex
      });
    });

    if ((!block.lines || block.lines.length === 0) && block.text) {
      lines.push({
        text: block.text,
        top: scaleCoordinate(block.frame?.top ?? blockIndex, variant.scaleY, variant.offsetY),
        left: scaleCoordinate(block.frame?.left ?? 0, variant.scaleX, variant.offsetX),
        right: scaleCoordinate(block.frame?.right ?? 0, variant.scaleX, variant.offsetX),
        bottom: scaleCoordinate(block.frame?.bottom ?? blockIndex + 1, variant.scaleY, variant.offsetY),
        blockIndex
      });
    }
  });

  return lines;
}

function mergePayloads(payloads: OcrPayload[], engine: OcrPayload["engine"]): OcrPayload {
  const lineMap = new Map<string, OcrInputLine>();

  payloads.forEach(payload => {
    payload.lines.forEach(line => {
      const text = line.text?.trim();
      if (!text) return;

      const key = `${text.toLowerCase()}::${Math.round(line.top ?? 0)}::${Math.round(line.left ?? 0)}`;
      const existing = lineMap.get(key);
      if (!existing || text.length > (existing.text?.length ?? 0)) {
        lineMap.set(key, { ...line, text });
      }
    });
  });

  const lines = Array.from(lineMap.values()).sort((left, right) => (left.top ?? 0) - (right.top ?? 0) || (left.left ?? 0) - (right.left ?? 0));
  const text = lines.map(line => line.text).join("\n");

  return {
    text,
    lines,
    engine
  };
}

async function getImageDimensions(imageUri: string): Promise<ImageDimensions> {
  if (Platform.OS === "web" && typeof Image !== "undefined") {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
      image.onerror = () => reject(new Error("Could not read the selected image."));
      image.src = imageUri;
    });
  }

  return await new Promise((resolve, reject) => {
    RNImage.getSize(
      imageUri,
      (width, height) => resolve({ width, height }),
      () => reject(new Error("Could not read the selected image."))
    );
  });
}

async function createWebContrastVariant(imageUri: string, dimensions: ImageDimensions): Promise<OcrVariant | null> {
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("Could not prepare the image for OCR."));
    element.src = imageUri;
  });

  context.filter = "grayscale(1) contrast(1.35) brightness(1.08)";
  context.drawImage(image, 0, 0, dimensions.width, dimensions.height);

  return {
    uri: canvas.toDataURL("image/jpeg", 1),
    label: "contrast",
    scaleX: 1,
    scaleY: 1,
    offsetX: 0,
    offsetY: 0
  };
}

async function cleanupWebVariants(variants: OcrVariant[]) {
  variants.forEach(variant => {
    if (variant.uri.startsWith("blob:") && typeof URL !== "undefined") {
      URL.revokeObjectURL(variant.uri);
    }
  });
}

function dedupeVariants(variants: OcrVariant[]) {
  const seen = new Set<string>();
  return variants.filter(variant => {
    if (seen.has(variant.uri)) return false;
    seen.add(variant.uri);
    return true;
  });
}

function scaleCoordinate(value: number, scale: number, offset: number) {
  return (value || 0) * scale + offset;
}
