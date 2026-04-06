import { useMemo, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import {
  Alert,
  Image,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from "react-native";
import { emptyDraft, parseContactFromText, type ContactDraft, type ContactField } from "./contactParser";
import { extractTextFromImage } from "./ocr";
import { theme } from "./theme";

type IntakeMode = "Scan from camera" | "Import image" | "Import screenshot";

type IntakeOption = {
  title: IntakeMode;
  subtitle: string;
  badge: string;
};

const intakeOptions: IntakeOption[] = [
  {
    title: "Scan from camera",
    subtitle: "Capture a physical business card with the phone camera.",
    badge: "Primary"
  },
  {
    title: "Import image",
    subtitle: "Use a saved photo or gallery image of a card.",
    badge: "Image"
  },
  {
    title: "Import screenshot",
    subtitle: "Pull contact details from a website or social profile screenshot.",
    badge: "Web"
  }
];

const fieldOrder: Array<{ key: keyof ContactDraft; label: string; keyboard?: "default" | "email-address" | "phone-pad" | "url" }> = [
  { key: "fullName", label: "Full name" },
  { key: "company", label: "Company" },
  { key: "title", label: "Job title" },
  { key: "mobilePhone", label: "Mobile phone", keyboard: "phone-pad" },
  { key: "officePhone", label: "Office phone", keyboard: "phone-pad" },
  { key: "email", label: "Email", keyboard: "email-address" },
  { key: "website", label: "Website", keyboard: "url" },
  { key: "address", label: "Address" }
];

const assignableFields: Array<{ key: ContactField; label: string }> = [
  { key: "fullName", label: "Full name" },
  { key: "company", label: "Company" },
  { key: "title", label: "Job title" },
  { key: "mobilePhone", label: "Mobile phone" },
  { key: "officePhone", label: "Office phone" },
  { key: "email", label: "Email" },
  { key: "website", label: "Website" },
  { key: "address", label: "Address" },
  { key: "notes", label: "Notes" }
];

const defaultFieldConfidence: Record<ContactField, "high" | "medium" | "low"> = {
  fullName: "low",
  company: "low",
  title: "low",
  mobilePhone: "low",
  officePhone: "low",
  email: "low",
  website: "low",
  address: "low",
  notes: "low"
};

export function AppShell() {
  const [selectedIntake, setSelectedIntake] = useState<IntakeMode>("Scan from camera");
  const [draft, setDraft] = useState<ContactDraft>(emptyDraft);
  const [fieldConfidence, setFieldConfidence] = useState<Record<ContactField, "high" | "medium" | "low">>(defaultFieldConfidence);
  const [ocrLines, setOcrLines] = useState<string[]>([]);
  const [activeAssignmentField, setActiveAssignmentField] = useState<ContactField>("fullName");
  const [saveToContacts, setSaveToContacts] = useState(true);
  const [createFollowUp, setCreateFollowUp] = useState(true);
  const [selectedImageUri, setSelectedImageUri] = useState("");
  const [processingStage, setProcessingStage] = useState<"idle" | "selected" | "review" | "error">("idle");
  const [rawOcrText, setRawOcrText] = useState("");
  const [ocrError, setOcrError] = useState("");
  const [isRunningOcr, setIsRunningOcr] = useState(false);

  const pipelineState = useMemo(() => {
    if (processingStage === "idle") {
      return {
        imageReady: "pending" as const,
        ocrParsed: "pending" as const,
        fieldMapping: "pending" as const,
        saveReady: "pending" as const,
        confidence: "--",
        fieldsFound: "0/9",
        needsReview: "Waiting for card"
      };
    }

    if (processingStage === "selected") {
      return {
        imageReady: "done" as const,
        ocrParsed: "active" as const,
        fieldMapping: "pending" as const,
        saveReady: "pending" as const,
        confidence: "Processing",
        fieldsFound: "--",
        needsReview: "OCR queue"
      };
    }

    if (processingStage === "error") {
      return {
        imageReady: "done" as const,
        ocrParsed: "pending" as const,
        fieldMapping: "pending" as const,
        saveReady: "pending" as const,
        confidence: "Error",
        fieldsFound: "--",
        needsReview: "OCR blocked"
      };
    }

    const populatedFieldCount = Object.values(draft).filter(Boolean).length;
    const confidenceCounts = Object.values(fieldConfidence).reduce(
      (totals, current) => {
        totals[current] += 1;
        return totals;
      },
      { high: 0, medium: 0, low: 0 }
    );
    const weakFieldLabels = fieldOrder
      .filter(field => draft[field.key] && fieldConfidence[field.key] === "low")
      .map(field => field.label);
    const confidenceLabel =
      confidenceCounts.high >= 4
        ? "High"
        : confidenceCounts.medium >= 3 || confidenceCounts.high >= 2
          ? "Medium"
          : "Needs review";

    return {
      imageReady: "done" as const,
      ocrParsed: "done" as const,
      fieldMapping: "active" as const,
      saveReady: "pending" as const,
      confidence: confidenceLabel,
      fieldsFound: `${populatedFieldCount}/9`,
      needsReview: weakFieldLabels[0] ?? (draft.address ? "Notes" : "Address")
    };
  }, [draft, fieldConfidence, processingStage]);

  async function handleIntakeSelection(mode: IntakeMode) {
    setSelectedIntake(mode);

    if (mode === "Scan from camera") {
      await pickFromCamera();
      return;
    }

    await pickFromLibrary(mode === "Import screenshot");
  }

  async function pickFromCamera() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();

    if (!permission.granted) {
      Alert.alert("Camera access needed", "Allow camera access so Business Card Depot can scan physical business cards.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 1
    });

    if (!result.canceled && result.assets[0]?.uri) {
      hydrateSelectedCard(result.assets[0].uri, "Scan from camera");
    }
  }

  async function pickFromLibrary(expectScreenshot: boolean) {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert("Photo access needed", "Allow photo library access so Business Card Depot can import card images and screenshots.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: !expectScreenshot,
      quality: 1
    });

    if (!result.canceled && result.assets[0]?.uri) {
      hydrateSelectedCard(result.assets[0].uri, expectScreenshot ? "Import screenshot" : "Import image");
    }
  }

  async function hydrateSelectedCard(uri: string, mode: IntakeMode) {
    setSelectedImageUri(uri);
    setSelectedIntake(mode);
    setProcessingStage("selected");
    setDraft(emptyDraft);
    setRawOcrText("");
    setOcrError("");
    setIsRunningOcr(true);

    try {
      const text = await extractTextFromImage(uri);
      const parsedResult = parseContactFromText(text);
      const intakeNote =
        mode === "Import screenshot"
          ? "Imported from a screenshot. Review website and title carefully."
          : mode === "Import image"
            ? "Imported from a saved card image."
            : "Captured from camera.";

      setRawOcrText(text);
      setOcrLines(parsedResult.lines);
      setFieldConfidence(parsedResult.fieldConfidence);
      setDraft({
        ...parsedResult.draft,
        notes: [intakeNote, parsedResult.draft.notes].filter(Boolean).join(" | ")
      });
      setProcessingStage("review");
    } catch (error) {
      const message = error instanceof Error ? error.message : "OCR failed to process this image.";
      setOcrError(message);
      setDraft({
        ...emptyDraft,
        notes: "OCR could not complete. You can still type the contact details manually."
      });
      setFieldConfidence(defaultFieldConfidence);
      setOcrLines([]);
      setProcessingStage("error");
    } finally {
      setIsRunningOcr(false);
    }
  }

  function resetFlow() {
    setSelectedImageUri("");
    setProcessingStage("idle");
    setSelectedIntake("Scan from camera");
    setDraft(emptyDraft);
    setFieldConfidence(defaultFieldConfidence);
    setOcrLines([]);
    setActiveAssignmentField("fullName");
    setRawOcrText("");
    setOcrError("");
    setIsRunningOcr(false);
  }

  function setFieldValue(field: ContactField, value: string, confidence?: "high" | "medium" | "low") {
    setDraft(current => ({ ...current, [field]: value }));
    if (confidence) {
      setFieldConfidence(current => ({ ...current, [field]: confidence }));
    }
  }

  function appendOcrLineToField(line: string) {
    const nextValue = draft[activeAssignmentField]
      ? `${draft[activeAssignmentField]} ${line}`.trim()
      : line;

    setFieldValue(activeAssignmentField, nextValue, "medium");
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Business Card Depot</Text>
        <Text style={styles.title}>Capture cards, clean the details, and save the contact in one pass.</Text>
        <Text style={styles.body}>
          This build now supports real intake from the camera or image library and hands the selected card
          into the contact review flow.
        </Text>
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Choose intake source</Text>
          <Text style={styles.sectionMeta}>Step 1</Text>
        </View>

        <View style={styles.optionStack}>
          {intakeOptions.map(option => {
            const isActive = option.title === selectedIntake;

            return (
              <Pressable
                key={option.title}
                onPress={() => {
                  void handleIntakeSelection(option.title);
                }}
                disabled={isRunningOcr}
                style={[styles.optionCard, isActive && styles.optionCardActive]}
              >
                <View style={styles.optionHeader}>
                  <Text style={[styles.optionTitle, isActive && styles.optionTitleActive]}>{option.title}</Text>
                  <View style={[styles.badge, isActive && styles.badgeActive]}>
                    <Text style={[styles.badgeText, isActive && styles.badgeTextActive]}>{option.badge}</Text>
                  </View>
                </View>
                <Text style={styles.optionBody}>{option.subtitle}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Selected card</Text>
          <Text style={styles.sectionMeta}>Preview</Text>
        </View>

        {selectedImageUri ? (
          <View style={styles.previewBlock}>
            <Image source={{ uri: selectedImageUri }} style={styles.previewImage} resizeMode="cover" />
            <View style={styles.previewMeta}>
              <Text style={styles.previewTitle}>{selectedIntake}</Text>
              {isRunningOcr ? (
                <View style={styles.processingRow}>
                  <ActivityIndicator size="small" color={theme.colors.brand} />
                  <Text style={styles.previewBody}>Running OCR and mapping likely contact fields...</Text>
                </View>
              ) : (
                <Text style={styles.previewBody}>
                  {processingStage === "error"
                    ? "The image loaded, but OCR did not complete. You can still edit the fields manually."
                    : "Card image loaded locally and the OCR results have been pushed into the review form."}
                </Text>
              )}
            </View>
          </View>
        ) : (
          <View style={styles.emptyPreview}>
            <Text style={styles.emptyPreviewTitle}>No card selected yet</Text>
            <Text style={styles.emptyPreviewBody}>
              Start with camera capture, an imported image, or a contact screenshot to feed the review flow.
            </Text>
          </View>
        )}
      </View>

      <View style={styles.dualColumn}>
        <View style={styles.sectionCardWide}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Extraction pipeline</Text>
            <Text style={styles.sectionMeta}>Step 2</Text>
          </View>

          <View style={styles.pipelineRow}>
            <PipelinePill label="Image ready" status={pipelineState.imageReady} />
            <PipelinePill label="OCR parsed" status={pipelineState.ocrParsed} />
            <PipelinePill label="Field mapping" status={pipelineState.fieldMapping} />
            <PipelinePill label="Save to contacts" status={pipelineState.saveReady} />
          </View>

          <View style={styles.metricStrip}>
            <MetricCard label="Confidence" value={pipelineState.confidence} />
            <MetricCard label="Fields found" value={pipelineState.fieldsFound} />
            <MetricCard label="Needs review" value={pipelineState.needsReview} />
          </View>
        </View>

        <View style={styles.sectionCardCompact}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Queue status</Text>
            <Text style={styles.sectionMeta}>Live</Text>
          </View>
          <Text style={styles.queueHeadline}>{selectedImageUri ? "Card ready" : "Waiting"}</Text>
          <Text style={styles.queueText}>Current source: {selectedIntake}</Text>
          <Text style={styles.queueText}>
            Next milestone: make the confidence flags and OCR line assignment fast enough for one-handed cleanup.
          </Text>
        </View>
      </View>

      {(ocrError || rawOcrText) ? (
        <View style={styles.sectionCard}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>OCR output</Text>
            <Text style={styles.sectionMeta}>Debug</Text>
          </View>

          {ocrError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>OCR could not complete</Text>
              <Text style={styles.errorBody}>{ocrError}</Text>
            </View>
          ) : null}

          {rawOcrText ? (
            <View style={styles.rawTextBox}>
              <Text style={styles.rawText}>{rawOcrText}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.sectionCard}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Review extracted contact</Text>
          <Text style={styles.sectionMeta}>Step 3</Text>
        </View>

        <View style={styles.formGrid}>
          {fieldOrder.map(field => (
            <View key={field.key} style={styles.fieldBlock}>
              <View style={styles.fieldHeader}>
                <Text style={styles.fieldLabel}>{field.label}</Text>
                <ConfidenceChip confidence={fieldConfidence[field.key]} />
              </View>
              <TextInput
                value={draft[field.key]}
                keyboardType={field.keyboard ?? "default"}
                onChangeText={value => setFieldValue(field.key, value, value ? "medium" : "low")}
                style={styles.input}
                placeholder={field.label}
                placeholderTextColor={theme.colors.placeholder}
              />
            </View>
          ))}
        </View>

        <View style={styles.fieldBlock}>
          <View style={styles.fieldHeader}>
            <Text style={styles.fieldLabel}>Notes</Text>
            <ConfidenceChip confidence={fieldConfidence.notes} />
          </View>
          <TextInput
            value={draft.notes}
            multiline
            onChangeText={value => setFieldValue("notes", value, value ? "medium" : "low")}
            style={[styles.input, styles.notesInput]}
            placeholder="Add context, lead notes, or meeting details"
            placeholderTextColor={theme.colors.placeholder}
          />
        </View>
      </View>

      {ocrLines.length > 0 ? (
        <View style={styles.sectionCard}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Quick assign from OCR lines</Text>
            <Text style={styles.sectionMeta}>Step 3A</Text>
          </View>

          <Text style={styles.assignHelp}>
            Pick a target field, then tap any OCR line to push it straight into that field. Use this when the OCR got
            close but not quite right.
          </Text>

          <View style={styles.assignmentFieldRow}>
            {assignableFields.map(field => {
              const isActive = field.key === activeAssignmentField;
              return (
                <Pressable
                  key={field.key}
                  onPress={() => setActiveAssignmentField(field.key)}
                  style={[styles.assignmentFieldChip, isActive && styles.assignmentFieldChipActive]}
                >
                  <Text style={[styles.assignmentFieldText, isActive && styles.assignmentFieldTextActive]}>
                    {field.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.assignmentTargetBox}>
            <Text style={styles.assignmentTargetLabel}>Assigning to</Text>
            <Text style={styles.assignmentTargetValue}>
              {assignableFields.find(field => field.key === activeAssignmentField)?.label}
            </Text>
          </View>

          <View style={styles.lineStack}>
            {ocrLines.map((line, index) => (
              <Pressable
                key={`${line}-${index}`}
                onPress={() => appendOcrLineToField(line)}
                style={styles.lineCard}
              >
                <Text style={styles.lineIndex}>Line {index + 1}</Text>
                <Text style={styles.lineText}>{line}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.sectionCard}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Save options</Text>
          <Text style={styles.sectionMeta}>Step 4</Text>
        </View>

        <View style={styles.toggleRow}>
          <View style={styles.toggleCopy}>
            <Text style={styles.toggleTitle}>Save to phone contacts</Text>
            <Text style={styles.toggleBody}>Create the final contact entry after the user approves the extracted details.</Text>
          </View>
          <Switch
            value={saveToContacts}
            onValueChange={setSaveToContacts}
            trackColor={{ false: "#d5cab9", true: "#83b3df" }}
            thumbColor={saveToContacts ? theme.colors.brand : "#f7f3ed"}
          />
        </View>

        <View style={styles.toggleRow}>
          <View style={styles.toggleCopy}>
            <Text style={styles.toggleTitle}>Create follow-up reminder</Text>
            <Text style={styles.toggleBody}>Leave space for CRM export or a simple follow-up list in the next version.</Text>
          </View>
          <Switch
            value={createFollowUp}
            onValueChange={setCreateFollowUp}
            trackColor={{ false: "#d5cab9", true: "#83b3df" }}
            thumbColor={createFollowUp ? theme.colors.brand : "#f7f3ed"}
          />
        </View>

        <View style={styles.actionRow}>
          <Pressable
            style={[styles.actionButton, styles.primaryButton, !selectedImageUri && styles.buttonDisabled]}
            disabled={!selectedImageUri || isRunningOcr}
          >
            <Text style={styles.primaryButtonText}>Save contact</Text>
          </Pressable>
          <Pressable style={[styles.actionButton, styles.secondaryButton]} onPress={resetFlow}>
            <Text style={styles.secondaryButtonText}>Scan another card</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

function PipelinePill({ label, status }: { label: string; status: "done" | "active" | "pending" }) {
  const pillStyle = status === "done"
    ? styles.pipelineDone
    : status === "active"
      ? styles.pipelineActive
      : styles.pipelinePending;
  const textStyle = status === "done"
    ? styles.pipelineTextDone
    : status === "active"
      ? styles.pipelineTextActive
      : styles.pipelineTextPending;

  return (
    <View style={[styles.pipelinePill, pillStyle]}>
      <Text style={[styles.pipelineText, textStyle]}>{label}</Text>
    </View>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function ConfidenceChip({ confidence }: { confidence: "high" | "medium" | "low" }) {
  const styleMap = confidence === "high"
    ? { container: styles.confidenceHigh, text: styles.confidenceHighText, label: "High confidence" }
    : confidence === "medium"
      ? { container: styles.confidenceMedium, text: styles.confidenceMediumText, label: "Review" }
      : { container: styles.confidenceLow, text: styles.confidenceLowText, label: "Needs review" };

  return (
    <View style={[styles.confidenceChip, styleMap.container]}>
      <Text style={[styles.confidenceText, styleMap.text]}>{styleMap.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background
  },
  content: {
    padding: theme.spacing.lg,
    gap: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl
  },
  hero: {
    marginTop: theme.spacing.lg,
    padding: theme.spacing.xl,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surfaceStrong,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.md
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: theme.colors.accent
  },
  title: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "800",
    color: theme.colors.text
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: theme.colors.muted
  },
  sectionCard: {
    padding: theme.spacing.lg,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.md
  },
  sectionCardWide: {
    flex: 1.2,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.md
  },
  sectionCardCompact: {
    flex: 0.8,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.sm
  },
  sectionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: theme.spacing.sm
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.text
  },
  sectionMeta: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    color: theme.colors.brand
  },
  optionStack: {
    gap: theme.spacing.md
  },
  optionCard: {
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceStrong,
    gap: theme.spacing.sm
  },
  optionCardActive: {
    borderColor: theme.colors.brand,
    backgroundColor: theme.colors.brandSoft
  },
  optionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: theme.spacing.sm
  },
  optionTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: theme.colors.text
  },
  optionTitleActive: {
    color: theme.colors.brandStrong
  },
  optionBody: {
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.muted
  },
  badge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: theme.colors.badge
  },
  badgeActive: {
    backgroundColor: theme.colors.brand
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: theme.colors.muted
  },
  badgeTextActive: {
    color: "#ffffff"
  },
  previewBlock: {
    gap: theme.spacing.md
  },
  previewImage: {
    width: "100%",
    height: 220,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.badge
  },
  previewMeta: {
    gap: theme.spacing.xs
  },
  processingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm
  },
  previewTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.colors.text
  },
  previewBody: {
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.muted
  },
  emptyPreview: {
    padding: theme.spacing.lg,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceStrong,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.xs
  },
  emptyPreviewTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.colors.text
  },
  emptyPreviewBody: {
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.muted
  },
  errorBox: {
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.errorSoft,
    borderWidth: 1,
    borderColor: theme.colors.errorBorder,
    gap: theme.spacing.xs
  },
  errorTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: theme.colors.error
  },
  errorBody: {
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.error
  },
  rawTextBox: {
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceStrong,
    borderWidth: 1,
    borderColor: theme.colors.border
  },
  rawText: {
    fontSize: 13,
    lineHeight: 20,
    color: theme.colors.muted
  },
  dualColumn: {
    gap: theme.spacing.md
  },
  pipelineRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm
  },
  pipelinePill: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 10,
    borderRadius: 999
  },
  pipelineDone: {
    backgroundColor: theme.colors.successSoft
  },
  pipelineActive: {
    backgroundColor: theme.colors.brandSoft
  },
  pipelinePending: {
    backgroundColor: theme.colors.badge
  },
  pipelineText: {
    fontSize: 12,
    fontWeight: "700"
  },
  pipelineTextDone: {
    color: theme.colors.success
  },
  pipelineTextActive: {
    color: theme.colors.brandStrong
  },
  pipelineTextPending: {
    color: theme.colors.muted
  },
  metricStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm
  },
  metricCard: {
    minWidth: 104,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceStrong,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.xs
  },
  metricLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    color: theme.colors.muted
  },
  metricValue: {
    fontSize: 20,
    fontWeight: "800",
    color: theme.colors.text
  },
  queueHeadline: {
    fontSize: 24,
    fontWeight: "800",
    color: theme.colors.brandStrong
  },
  queueText: {
    fontSize: 14,
    lineHeight: 21,
    color: theme.colors.muted
  },
  formGrid: {
    gap: theme.spacing.md
  },
  fieldBlock: {
    gap: theme.spacing.xs
  },
  fieldHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: theme.spacing.sm
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: theme.colors.muted,
    textTransform: "uppercase",
    letterSpacing: 1
  },
  confidenceChip: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    borderRadius: 999
  },
  confidenceText: {
    fontSize: 11,
    fontWeight: "700"
  },
  confidenceHigh: {
    backgroundColor: theme.colors.successSoft
  },
  confidenceHighText: {
    color: theme.colors.success
  },
  confidenceMedium: {
    backgroundColor: theme.colors.warningSoft
  },
  confidenceMediumText: {
    color: theme.colors.warning
  },
  confidenceLow: {
    backgroundColor: theme.colors.errorSoft
  },
  confidenceLowText: {
    color: theme.colors.error
  },
  input: {
    minHeight: 52,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 12,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceStrong,
    fontSize: 16,
    color: theme.colors.text
  },
  notesInput: {
    minHeight: 120,
    textAlignVertical: "top"
  },
  assignHelp: {
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.muted
  },
  assignmentFieldRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm
  },
  assignmentFieldChip: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: theme.colors.badge,
    borderWidth: 1,
    borderColor: theme.colors.border
  },
  assignmentFieldChipActive: {
    backgroundColor: theme.colors.brandSoft,
    borderColor: theme.colors.brand
  },
  assignmentFieldText: {
    fontSize: 13,
    fontWeight: "700",
    color: theme.colors.muted
  },
  assignmentFieldTextActive: {
    color: theme.colors.brandStrong
  },
  assignmentTargetBox: {
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceStrong,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.xs
  },
  assignmentTargetLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    color: theme.colors.muted
  },
  assignmentTargetValue: {
    fontSize: 18,
    fontWeight: "800",
    color: theme.colors.text
  },
  lineStack: {
    gap: theme.spacing.sm
  },
  lineCard: {
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceStrong,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.xs
  },
  lineIndex: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    color: theme.colors.brand
  },
  lineText: {
    fontSize: 15,
    lineHeight: 22,
    color: theme.colors.text
  },
  toggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingVertical: 4
  },
  toggleCopy: {
    flex: 1,
    gap: theme.spacing.xs
  },
  toggleTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.colors.text
  },
  toggleBody: {
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.muted
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    paddingTop: theme.spacing.sm
  },
  actionButton: {
    minHeight: 52,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center"
  },
  primaryButton: {
    backgroundColor: theme.colors.brand
  },
  secondaryButton: {
    backgroundColor: theme.colors.surfaceStrong,
    borderWidth: 1,
    borderColor: theme.colors.border
  },
  buttonDisabled: {
    opacity: 0.45
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#ffffff"
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: "800",
    color: theme.colors.text
  }
});
