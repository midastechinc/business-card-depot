import { useEffect, useMemo, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";
import {
  buildSavedContact,
  createContactSummary,
  createVCard,
  formatDateLabel,
  getPrimaryLabel,
  saveDraftToNativeContacts,
  type SavedContactEntry
} from "./contactActions";
import { defaultAdminSettings, loadAdminSettings, saveAdminSettings, type AdminSettings } from "./adminSettings";
import {
  emptyDraft,
  parseContactFromOcr,
  type ContactDraft,
  type ContactField,
  type ParsedContactResult
} from "./contactParser";
import { loadSavedContacts, saveSavedContacts } from "./historyStorage";
import { syncSavedContactToGoogleSheets } from "./listSync";
import { extractOcrPayloadFromImage } from "./ocr";
import { theme } from "./theme";

type IntakeMode = "Scan from camera" | "Import image" | "Import screenshot";
type AssignmentMode = "replace" | "append";
type CompactPanel = "capture" | "review" | "fix" | "saved";

const intakeOptions: Array<{ title: IntakeMode; subtitle: string; badge: string }> = [
  { title: "Scan from camera", subtitle: "Capture a physical card with the phone camera.", badge: "Camera" },
  { title: "Import image", subtitle: "Use a saved photo or gallery image.", badge: "Image" },
  { title: "Import screenshot", subtitle: "Pull details from a screenshot or website profile.", badge: "Web" }
];

const compactPanels: Array<{ key: CompactPanel; label: string }> = [
  { key: "capture", label: "Capture" },
  { key: "review", label: "Review" },
  { key: "fix", label: "Fix" },
  { key: "saved", label: "Saved" }
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
  const { width } = useWindowDimensions();
  const isCompactScreen = width < 680;
  const [selectedIntake, setSelectedIntake] = useState<IntakeMode>("Scan from camera");
  const [draft, setDraft] = useState<ContactDraft>(emptyDraft);
  const [fieldConfidence, setFieldConfidence] = useState<Record<ContactField, "high" | "medium" | "low">>(defaultFieldConfidence);
  const [ocrLines, setOcrLines] = useState<string[]>([]);
  const [ocrSuggestions, setOcrSuggestions] = useState<ParsedContactResult["suggestions"]>({});
  const [activeAssignmentField, setActiveAssignmentField] = useState<ContactField>("fullName");
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>("replace");
  const [assignmentNotice, setAssignmentNotice] = useState("");
  const [saveToContacts, setSaveToContacts] = useState(true);
  const [createFollowUp, setCreateFollowUp] = useState(true);
  const [selectedImageUri, setSelectedImageUri] = useState("");
  const [processingStage, setProcessingStage] = useState<"idle" | "selected" | "review" | "error">("idle");
  const [rawOcrText, setRawOcrText] = useState("");
  const [ocrError, setOcrError] = useState("");
  const [isRunningOcr, setIsRunningOcr] = useState(false);
  const [savedContacts, setSavedContacts] = useState<SavedContactEntry[]>([]);
  const [lastSavedId, setLastSavedId] = useState("");
  const [showRawOcr, setShowRawOcr] = useState(false);
  const [showAllOcrLines, setShowAllOcrLines] = useState(false);
  const [showSavedContacts, setShowSavedContacts] = useState(false);
  const [compactPanel, setCompactPanel] = useState<CompactPanel>("capture");
  const [isDragActive, setIsDragActive] = useState(false);
  const [managedObjectUrl, setManagedObjectUrl] = useState("");
  const [adminSettings, setAdminSettings] = useState<AdminSettings>(defaultAdminSettings);
  const [settingsReady, setSettingsReady] = useState(false);
  const [syncState, setSyncState] = useState<{ status: "idle" | "syncing" | "success" | "error"; message: string }>({
    status: "idle",
    message: ""
  });
  const [showAdminPanel, setShowAdminPanel] = useState(false);

  useEffect(() => {
    setSavedContacts(loadSavedContacts());
  }, []);

  useEffect(() => {
    let mounted = true;

    void loadAdminSettings().then(settings => {
      if (!mounted) return;
      setAdminSettings(settings);
      setSettingsReady(true);
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!settingsReady) return;
    void saveAdminSettings(adminSettings);
  }, [adminSettings, settingsReady]);

  const pipelineState = useMemo(() => {
    if (processingStage === "idle") return { confidence: "--", fieldsFound: "0/9", needsReview: "Waiting", ocrStatus: "pending" as const };
    if (processingStage === "selected") return { confidence: "Processing", fieldsFound: "--", needsReview: "OCR running", ocrStatus: "active" as const };
    if (processingStage === "error") return { confidence: "Error", fieldsFound: "--", needsReview: "OCR blocked", ocrStatus: "error" as const };

    const populatedFieldCount = Object.values(draft).filter(Boolean).length;
    const lowFields = fieldOrder.filter(field => draft[field.key] && fieldConfidence[field.key] === "low").map(field => field.label);
    const highCount = Object.values(fieldConfidence).filter(value => value === "high").length;
    const mediumCount = Object.values(fieldConfidence).filter(value => value === "medium").length;

    return {
      confidence: highCount >= 4 ? "High" : highCount >= 2 || mediumCount >= 3 ? "Medium" : "Needs review",
      fieldsFound: `${populatedFieldCount}/9`,
      needsReview: lowFields[0] ?? "Looks good",
      ocrStatus: "done" as const
    };
  }, [draft, fieldConfidence, processingStage]);

  const visibleOcrLines = isCompactScreen && !showAllOcrLines ? ocrLines.slice(0, 4) : ocrLines;
  const visibleSavedContacts = isCompactScreen && !showSavedContacts ? savedContacts.slice(0, 2) : savedContacts;
  const topSuggestions = ocrSuggestions[activeAssignmentField]?.slice(0, 2) ?? [];

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
      await hydrateSelectedCard(result.assets[0].uri, "Scan from camera");
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
      await hydrateSelectedCard(result.assets[0].uri, expectScreenshot ? "Import screenshot" : "Import image");
    }
  }

  async function hydrateSelectedCard(uri: string, mode: IntakeMode) {
    if (managedObjectUrl && managedObjectUrl !== uri && Platform.OS === "web") {
      URL.revokeObjectURL(managedObjectUrl);
      setManagedObjectUrl("");
    }

    setSelectedImageUri(uri);
    setSelectedIntake(mode);
    setProcessingStage("selected");
    setDraft(emptyDraft);
    setFieldConfidence(defaultFieldConfidence);
    setOcrLines([]);
    setOcrSuggestions({});
    setRawOcrText("");
    setOcrError("");
    setAssignmentNotice("");
    setIsRunningOcr(true);
    setCompactPanel("review");

    try {
      const payload = await extractOcrPayloadFromImage(uri);
      const parsedResult = parseContactFromOcr(payload, mode === "Import screenshot" ? "screenshot" : "card");
      const intakeNote = mode === "Import screenshot"
        ? "Imported from a screenshot. Review website and title carefully."
        : mode === "Import image"
          ? "Imported from a saved card image."
          : "Captured from camera.";

      setRawOcrText(payload.text);
      setOcrLines(parsedResult.lines);
      setOcrSuggestions(parsedResult.suggestions);
      setFieldConfidence(parsedResult.fieldConfidence);
      setDraft({
        ...parsedResult.draft,
        notes: [intakeNote, parsedResult.draft.notes].filter(Boolean).join(" | ")
      });
      setProcessingStage("review");
    } catch (error) {
      const message = error instanceof Error ? error.message : "OCR failed to process this image.";
      setOcrError(message);
      setDraft({ ...emptyDraft, notes: "OCR could not complete. You can still type the contact details manually." });
      setProcessingStage("error");
      setCompactPanel("fix");
    } finally {
      setIsRunningOcr(false);
    }
  }

  function resetFlow() {
    if (managedObjectUrl && Platform.OS === "web") {
      URL.revokeObjectURL(managedObjectUrl);
      setManagedObjectUrl("");
    }

    setSelectedImageUri("");
    setSelectedIntake("Scan from camera");
    setProcessingStage("idle");
    setDraft(emptyDraft);
    setFieldConfidence(defaultFieldConfidence);
    setOcrLines([]);
    setOcrSuggestions({});
    setActiveAssignmentField("fullName");
    setRawOcrText("");
    setOcrError("");
    setIsRunningOcr(false);
    setShowRawOcr(false);
    setShowAllOcrLines(false);
    setAssignmentNotice("");
    setCompactPanel("capture");
  }

  function setFieldValue(field: ContactField, value: string, confidence?: "high" | "medium" | "low") {
    setDraft(current => ({ ...current, [field]: value }));
    if (confidence) {
      setFieldConfidence(current => ({ ...current, [field]: confidence }));
    }
  }

  function applySuggestion(value: string) {
    setFieldValue(activeAssignmentField, value, "medium");
    setAssignmentNotice(`Suggested ${assignableFields.find(field => field.key === activeAssignmentField)?.label ?? "field"}`);
  }

  function assignOcrLineToField(line: string) {
    Keyboard.dismiss();
    const nextValue = assignmentMode === "append" && draft[activeAssignmentField]
      ? `${draft[activeAssignmentField]} ${line}`.trim()
      : line;

    setFieldValue(activeAssignmentField, nextValue, "medium");
    setAssignmentNotice(`${assignmentMode === "append" ? "Added to" : "Set"} ${assignableFields.find(field => field.key === activeAssignmentField)?.label ?? "field"}`);
  }

  function clearActiveAssignmentField() {
    Keyboard.dismiss();
    setFieldValue(activeAssignmentField, "", "low");
    setAssignmentNotice(`Cleared ${assignableFields.find(field => field.key === activeAssignmentField)?.label ?? "field"}`);
  }

  async function openWebFilePicker() {
    if (Platform.OS !== "web" || typeof document === "undefined") {
      await pickFromLibrary(false);
      return;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async event => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (file) {
        await importWebFile(file);
      }
    };
    input.click();
  }

  async function importWebFile(file: File) {
    if (Platform.OS !== "web") return;
    const url = URL.createObjectURL(file);
    setManagedObjectUrl(url);
    await hydrateSelectedCard(url, selectedIntake === "Import screenshot" ? "Import screenshot" : "Import image");
  }

  function createWebDropProps(mode: IntakeMode) {
    if (Platform.OS !== "web") return {};
    return {
      onDragOver: (event: DragEvent) => {
        event.preventDefault();
        setIsDragActive(true);
        setSelectedIntake(mode);
      },
      onDragLeave: (event: DragEvent) => {
        event.preventDefault();
        setIsDragActive(false);
      },
      onDrop: async (event: DragEvent) => {
        event.preventDefault();
        setIsDragActive(false);
        const file = event.dataTransfer?.files?.[0];
        if (file) {
          setSelectedIntake(mode);
          await importWebFile(file);
        }
      }
    } as unknown as Record<string, unknown>;
  }

  async function handleSaveContact() {
    const hasEnoughData = Boolean(draft.fullName || draft.company || draft.email || draft.mobilePhone || draft.officePhone);
    if (!hasEnoughData) {
      Alert.alert("Need more detail", "Add at least a name, company, email, or phone number before saving this contact.");
      return;
    }

    const savedEntry = buildSavedContact(draft, selectedIntake, createFollowUp);
    const nextSavedContacts = [savedEntry, ...savedContacts].slice(0, 8);
    setSavedContacts(nextSavedContacts);
    saveSavedContacts(nextSavedContacts);
    setLastSavedId(savedEntry.id);
    setCompactPanel("saved");

    if (saveToContacts) {
      await exportSavedContact(savedEntry);
    } else {
      Alert.alert("Saved", `${getPrimaryLabel(savedEntry.draft)} is now in recent saved contacts.`);
    }

    if (adminSettings.enableGoogleSheetsSync && adminSettings.googleSheetsWebhookUrl.trim()) {
      setSyncState({ status: "syncing", message: "Syncing to Google Sheets..." });
      try {
        await syncSavedContactToGoogleSheets(savedEntry, adminSettings.googleSheetsWebhookUrl);
        setSyncState({ status: "success", message: "Saved contact also synced to Google Sheets." });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not sync this contact to Google Sheets.";
        setSyncState({ status: "error", message });
      }
    }
  }

  async function sendTestSync() {
    if (!adminSettings.googleSheetsWebhookUrl.trim()) {
      Alert.alert("Missing URL", "Add the Google Sheets webhook URL first.");
      return;
    }

    const sampleEntry = buildSavedContact(
      {
        ...draft,
        fullName: draft.fullName || "Business Card Depot Test Contact",
        company: draft.company || "Midas Tech",
        title: draft.title || "Sync Test"
      },
      "Admin test",
      false
    );

    setSyncState({ status: "syncing", message: "Sending test payload..." });
    try {
      await syncSavedContactToGoogleSheets(sampleEntry, adminSettings.googleSheetsWebhookUrl);
      setSyncState({ status: "success", message: "Test payload reached the Google Sheets webhook." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The test payload could not be sent.";
      setSyncState({ status: "error", message });
    }
  }

  async function exportSavedContact(entry: SavedContactEntry) {
    const vCard = createVCard(entry.draft);
    const fallbackLabel = getPrimaryLabel(entry.draft);

    if (Platform.OS !== "web") {
      try {
        const result = await saveDraftToNativeContacts(entry.draft);
        Alert.alert(
          result === "presented" ? "Ready to save" : "Saved to contacts",
          result === "presented"
            ? `${fallbackLabel} is loaded into your phone's contact form. Tap Save there to finish.`
            : `${fallbackLabel} was added to your phone contacts.`
        );
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not open the native contacts form.";
        Alert.alert("Save to contacts unavailable", `${message} A share sheet will open instead.`);
      }
    }

    if (Platform.OS === "web" && typeof window !== "undefined" && typeof document !== "undefined") {
      const blob = new Blob([vCard], { type: "text/vcard;charset=utf-8" });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${fallbackLabel.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "business-card-contact"}.vcf`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);
      Alert.alert("Saved and exported", `${fallbackLabel} was downloaded as a VCF file.`);
      return;
    }

    try {
      await Share.share({
        title: fallbackLabel,
        message: `${createContactSummary(entry.draft)}\n\n${vCard}`
      });
    } catch {
      Alert.alert("Saved", `${fallbackLabel} was saved locally. Sharing can be expanded in the next pass.`);
    }
  }

  async function copySummary(entry: SavedContactEntry) {
    const summary = createContactSummary(entry.draft);
    if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(summary);
      Alert.alert("Copied", "The contact summary is now on your clipboard.");
      return;
    }

    try {
      await Share.share({ title: getPrimaryLabel(entry.draft), message: summary });
    } catch {
      Alert.alert("Share unavailable", "The summary is ready, but this platform could not open the share sheet.");
    }
  }

  function shouldShowPanel(panel: CompactPanel) {
    return !isCompactScreen || compactPanel === panel;
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={[styles.shell, isCompactScreen && styles.shellCompact]}>
        <View style={styles.headerCard}>
          <View style={styles.headerTopRow}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>Business Card Depot</Text>
              <Text style={[styles.title, isCompactScreen && styles.titleCompact]}>Scan, clean, save.</Text>
              <Text style={styles.headerBody}>Built for card-sized review on phone, with faster OCR cleanup.</Text>
            </View>
            <Pressable style={styles.adminLaunchButton} onPress={() => setShowAdminPanel(true)}>
              <Text style={styles.adminLaunchButtonText}>Admin</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.statusBar}>
          <View style={styles.statusMetric}>
            <Text style={styles.statusLabel}>OCR</Text>
            <Text style={styles.statusValue}>{pipelineState.ocrStatus === "active" ? "Running" : pipelineState.confidence}</Text>
          </View>
          <View style={styles.statusMetric}>
            <Text style={styles.statusLabel}>Fields</Text>
            <Text style={styles.statusValue}>{pipelineState.fieldsFound}</Text>
          </View>
          <View style={styles.statusMetric}>
            <Text style={styles.statusLabel}>Review</Text>
            <Text style={styles.statusValue}>{pipelineState.needsReview}</Text>
          </View>
        </View>

        {isCompactScreen ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.panelTabs}>
            {compactPanels.map(panel => (
              <Pressable
                key={panel.key}
                onPress={() => setCompactPanel(panel.key)}
                style={[styles.panelTab, compactPanel === panel.key && styles.panelTabActive]}
              >
                <Text style={[styles.panelTabText, compactPanel === panel.key && styles.panelTabTextActive]}>{panel.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {shouldShowPanel("capture") ? (
          <View style={styles.cardPanel}>
            <PanelHeader title="1. Capture" meta={selectedIntake} />
            {Platform.OS === "web" ? (
              <View style={[styles.dropzone, isDragActive && styles.dropzoneActive]} {...createWebDropProps("Import image")}>
                <Text style={styles.dropzoneTitle}>Drag and drop a card image</Text>
                <Text style={styles.dropzoneBody}>Drop an image here or browse from your computer.</Text>
                <Pressable style={styles.dropzoneButton} onPress={() => void openWebFilePicker()}>
                  <Text style={styles.dropzoneButtonText}>Browse image</Text>
                </Pressable>
              </View>
            ) : null}

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
                      <Badge label={option.badge} active={isActive} />
                    </View>
                    <Text style={styles.optionBody}>{option.subtitle}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.previewCard}>
              {selectedImageUri ? (
                <>
                  <Image source={{ uri: selectedImageUri }} style={styles.previewImage} resizeMode="cover" />
                  <Text style={styles.previewCaption}>{selectedIntake}</Text>
                </>
              ) : (
                <>
                  <Text style={styles.previewEmptyTitle}>No card loaded</Text>
                  <Text style={styles.previewEmptyBody}>Use the camera, image import, screenshot import, or drag/drop.</Text>
                </>
              )}
            </View>
          </View>
        ) : null}

        {shouldShowPanel("review") ? (
          <View style={styles.cardPanel}>
            <PanelHeader title="2. Review" meta={processingStage === "review" ? "Ready" : processingStage === "selected" ? "Processing" : "Waiting"} />
            {isRunningOcr ? (
              <View style={styles.loadingCard}>
                <ActivityIndicator size="small" color={theme.colors.brand} />
                <Text style={styles.loadingText}>Running OCR and matching fields...</Text>
              </View>
            ) : null}

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
                  placeholder="Context or follow-up notes"
                  placeholderTextColor={theme.colors.placeholder}
                />
              </View>
            </View>

            <View style={styles.toggleRow}>
              <View style={styles.toggleCopy}>
                <Text style={styles.toggleTitle}>Save to phone contacts</Text>
                <Text style={styles.toggleBody}>Export as a VCF/shareable contact after review.</Text>
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
                <Text style={styles.toggleBody}>Keep a note that follow-up is needed after saving.</Text>
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
                style={[styles.actionButton, styles.primaryButton, (!selectedImageUri || isRunningOcr) && styles.buttonDisabled]}
                disabled={!selectedImageUri || isRunningOcr}
                onPress={() => {
                  void handleSaveContact();
                }}
              >
                <Text style={styles.primaryButtonText}>Save contact</Text>
              </Pressable>
              <Pressable style={[styles.actionButton, styles.secondaryButton]} onPress={resetFlow}>
                <Text style={styles.secondaryButtonText}>New scan</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {shouldShowPanel("fix") ? (
          <View style={styles.cardPanel}>
            <PanelHeader title="3. Fix" meta={`${ocrLines.length} OCR lines`} />

            {topSuggestions.length > 0 ? (
              <View style={styles.suggestionCard}>
                <Text style={styles.suggestionTitle}>Best guesses for {assignableFields.find(field => field.key === activeAssignmentField)?.label}</Text>
                <View style={styles.suggestionRow}>
                  {topSuggestions.map(suggestion => (
                    <Pressable key={suggestion} style={styles.suggestionChip} onPress={() => applySuggestion(suggestion)}>
                      <Text style={styles.suggestionChipText}>{suggestion}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            <Text style={styles.assignHelp}>Pick a field, then tap a line to replace or append it.</Text>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalChipRow} keyboardShouldPersistTaps="handled">
              {assignableFields.map(field => {
                const isActive = field.key === activeAssignmentField;
                return (
                  <Pressable
                    key={field.key}
                    onPress={() => setActiveAssignmentField(field.key)}
                    style={[styles.assignmentFieldChip, isActive && styles.assignmentFieldChipActive]}
                  >
                    <Text style={[styles.assignmentFieldText, isActive && styles.assignmentFieldTextActive]}>{field.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={styles.assignmentTargetBox}>
              <Text style={styles.assignmentTargetLabel}>Current target</Text>
              <Text style={styles.assignmentTargetValue}>{assignableFields.find(field => field.key === activeAssignmentField)?.label}</Text>
              <Text style={styles.assignmentTargetHint}>
                {assignmentMode === "append" ? "Tap a line to append it." : "Tap a line to replace this field."}
              </Text>
            </View>

            {assignmentNotice ? (
              <View style={styles.assignmentNoticeBox}>
                <Text style={styles.assignmentNoticeText}>{assignmentNotice}</Text>
              </View>
            ) : null}

            <View style={styles.assignmentModeRow}>
              <Pressable
                style={[styles.assignmentModeChip, assignmentMode === "replace" && styles.assignmentModeChipActive]}
                onPress={() => setAssignmentMode("replace")}
              >
                <Text style={[styles.assignmentModeText, assignmentMode === "replace" && styles.assignmentModeTextActive]}>Replace</Text>
              </Pressable>
              <Pressable
                style={[styles.assignmentModeChip, assignmentMode === "append" && styles.assignmentModeChipActive]}
                onPress={() => setAssignmentMode("append")}
              >
                <Text style={[styles.assignmentModeText, assignmentMode === "append" && styles.assignmentModeTextActive]}>Append</Text>
              </Pressable>
              <Pressable style={styles.assignmentClearChip} onPress={clearActiveAssignmentField}>
                <Text style={styles.assignmentClearText}>Clear</Text>
              </Pressable>
            </View>

            <View style={styles.lineStack}>
              {visibleOcrLines.map((line, index) => (
                <Pressable key={`${line}-${index}`} onPress={() => assignOcrLineToField(line)} style={styles.lineCard}>
                  <View style={styles.lineHeader}>
                    <Text style={styles.lineIndex}>Line {index + 1}</Text>
                    <Text style={styles.lineActionText}>{assignmentMode === "append" ? "Tap to append" : "Tap to replace"}</Text>
                  </View>
                  <Text style={styles.lineText}>{line}</Text>
                </Pressable>
              ))}
            </View>

            {isCompactScreen && ocrLines.length > 4 ? (
              <Pressable style={styles.togglePanelButton} onPress={() => setShowAllOcrLines(current => !current)}>
                <Text style={styles.togglePanelButtonText}>
                  {showAllOcrLines ? "Show fewer OCR lines" : `Show all ${ocrLines.length} OCR lines`}
                </Text>
              </Pressable>
            ) : null}

            {(ocrError || rawOcrText) ? (
              <>
                {ocrError ? (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorTitle}>OCR issue</Text>
                    <Text style={styles.errorBody}>{ocrError}</Text>
                  </View>
                ) : null}
                <Pressable style={styles.togglePanelButton} onPress={() => setShowRawOcr(current => !current)}>
                  <Text style={styles.togglePanelButtonText}>{showRawOcr ? "Hide raw OCR text" : "Show raw OCR text"}</Text>
                </Pressable>
                {showRawOcr ? (
                  <View style={styles.rawTextBox}>
                    <Text style={styles.rawText}>{rawOcrText}</Text>
                  </View>
                ) : null}
              </>
            ) : null}
          </View>
        ) : null}

        {shouldShowPanel("saved") ? (
          <View style={styles.cardPanel}>
            <PanelHeader title="4. Saved" meta={savedContacts.length ? `${savedContacts.length} saved` : "Empty"} />
            {savedContacts.length === 0 ? (
              <View style={styles.previewCard}>
                <Text style={styles.previewEmptyTitle}>No saved contacts yet</Text>
                <Text style={styles.previewEmptyBody}>Save a cleaned contact and it will appear here.</Text>
              </View>
            ) : (
              <View style={styles.savedStack}>
                {visibleSavedContacts.map(entry => {
                  const isLatest = entry.id === lastSavedId;
                  return (
                    <View key={entry.id} style={[styles.savedCard, isLatest && styles.savedCardLatest]}>
                      <View style={styles.savedHeader}>
                        <View style={styles.savedCopy}>
                          <Text style={styles.savedName}>{getPrimaryLabel(entry.draft)}</Text>
                          <Text style={styles.savedMeta}>
                            {entry.draft.title || "Contact"}{entry.draft.company ? ` at ${entry.draft.company}` : ""}
                          </Text>
                          <Text style={styles.savedMeta}>Saved {formatDateLabel(entry.savedAt)} from {entry.source}</Text>
                        </View>
                        {isLatest ? (
                          <View style={styles.latestChip}>
                            <Text style={styles.latestChipText}>Newest</Text>
                          </View>
                        ) : null}
                      </View>

                      <View style={styles.savedActionRow}>
                        <Pressable style={[styles.savedActionButton, styles.savedActionPrimary]} onPress={() => void exportSavedContact(entry)}>
                          <Text style={styles.savedActionPrimaryText}>Export VCF</Text>
                        </Pressable>
                        <Pressable style={[styles.savedActionButton, styles.savedActionSecondary]} onPress={() => void copySummary(entry)}>
                          <Text style={styles.savedActionSecondaryText}>Copy summary</Text>
                        </Pressable>
                        <Pressable
                          style={[styles.savedActionButton, styles.savedActionSecondary]}
                          onPress={() => {
                            setDraft(entry.draft);
                            setSelectedIntake(entry.source as IntakeMode);
                            setProcessingStage("review");
                            setFieldConfidence({
                              fullName: "medium",
                              company: "medium",
                              title: "medium",
                              mobilePhone: "medium",
                              officePhone: "medium",
                              email: "medium",
                              website: "medium",
                              address: "medium",
                              notes: "medium"
                            });
                            setCompactPanel("review");
                          }}
                        >
                          <Text style={styles.savedActionSecondaryText}>Load</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
                {isCompactScreen && savedContacts.length > 2 ? (
                  <Pressable style={styles.togglePanelButton} onPress={() => setShowSavedContacts(current => !current)}>
                    <Text style={styles.togglePanelButtonText}>
                      {showSavedContacts ? "Show fewer saved contacts" : `Show all ${savedContacts.length} saved contacts`}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            )}
          </View>
        ) : null}

        {showAdminPanel ? (
          <View style={[styles.cardPanel, styles.adminPanel]}>
            <PanelHeader title="5. Admin" meta="Google Sheets" />

            <View style={styles.toggleRow}>
              <View style={styles.toggleCopy}>
                <Text style={styles.toggleTitle}>Sync saved cards to Google Sheets</Text>
                <Text style={styles.toggleBody}>If enabled, every saved contact will also POST to your Google Apps Script webhook.</Text>
              </View>
              <Switch
                value={adminSettings.enableGoogleSheetsSync}
                onValueChange={value => setAdminSettings(current => ({ ...current, enableGoogleSheetsSync: value }))}
                trackColor={{ false: "#d5cab9", true: "#83b3df" }}
                thumbColor={adminSettings.enableGoogleSheetsSync ? theme.colors.brand : "#f7f3ed"}
              />
            </View>

            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>Google Sheets webhook URL</Text>
              <TextInput
                value={adminSettings.googleSheetsWebhookUrl}
                onChangeText={value => setAdminSettings(current => ({ ...current, googleSheetsWebhookUrl: value }))}
                style={styles.input}
                placeholder="https://script.google.com/macros/s/your-web-app-id/exec"
                placeholderTextColor={theme.colors.placeholder}
                autoCapitalize="none"
                keyboardType="url"
              />
            </View>

            <View style={styles.previewCard}>
              <Text style={styles.previewEmptyTitle}>What this expects</Text>
              <Text style={styles.previewEmptyBody}>Use a deployed Google Apps Script Web App URL. The app sends a JSON POST with `sourceApp`, `savedAt`, `source`, and `contact` fields for the row builder.</Text>
            </View>

            {syncState.status !== "idle" ? (
              <View style={[
                styles.syncStateBox,
                syncState.status === "success" ? styles.syncStateSuccess : syncState.status === "error" ? styles.syncStateError : styles.syncStateProgress
              ]}>
                <Text style={styles.syncStateTitle}>
                  {syncState.status === "success" ? "Last sync ok" : syncState.status === "error" ? "Sync error" : "Sync in progress"}
                </Text>
                <Text style={styles.syncStateBody}>{syncState.message}</Text>
              </View>
            ) : null}

              <View style={styles.actionRow}>
              <Pressable
                style={[styles.actionButton, styles.primaryButton, !adminSettings.googleSheetsWebhookUrl.trim() && styles.buttonDisabled]}
                disabled={!adminSettings.googleSheetsWebhookUrl.trim()}
                onPress={() => {
                  void sendTestSync();
                }}
              >
                <Text style={styles.primaryButtonText}>Send test payload</Text>
              </Pressable>
              <Pressable
                style={[styles.actionButton, styles.secondaryButton]}
                onPress={() => {
                  setAdminSettings(defaultAdminSettings);
                  setSyncState({ status: "idle", message: "" });
                }}
              >
                <Text style={styles.secondaryButtonText}>Reset admin</Text>
              </Pressable>
            </View>

            <Pressable style={[styles.actionButton, styles.secondaryButton]} onPress={() => setShowAdminPanel(false)}>
              <Text style={styles.secondaryButtonText}>Close admin</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

function PanelHeader({ title, meta }: { title: string; meta: string }) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionMeta}>{meta}</Text>
    </View>
  );
}

function Badge({ label, active }: { label: string; active: boolean }) {
  return (
    <View style={[styles.badge, active && styles.badgeActive]}>
      <Text style={[styles.badgeText, active && styles.badgeTextActive]}>{label}</Text>
    </View>
  );
}

function ConfidenceChip({ confidence }: { confidence: "high" | "medium" | "low" }) {
  const map = confidence === "high"
    ? { container: styles.confidenceHigh, text: styles.confidenceHighText, label: "High" }
    : confidence === "medium"
      ? { container: styles.confidenceMedium, text: styles.confidenceMediumText, label: "Review" }
      : { container: styles.confidenceLow, text: styles.confidenceLowText, label: "Check" };

  return (
    <View style={[styles.confidenceChip, map.container]}>
      <Text style={[styles.confidenceText, map.text]}>{map.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background
  },
  content: {
    padding: 16
  },
  shell: {
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    gap: 12
  },
  shellCompact: {
    maxWidth: 420
  },
  headerCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 6
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12
  },
  headerCopy: {
    flex: 1,
    gap: 6
  },
  adminLaunchButton: {
    borderRadius: 999,
    backgroundColor: "#eee4d5",
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  adminLaunchButtonText: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: "700"
  },
  eyebrow: {
    color: theme.colors.brand,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2,
    textTransform: "uppercase"
  },
  title: {
    color: theme.colors.text,
    fontSize: 34,
    lineHeight: 38,
    fontWeight: "800"
  },
  titleCompact: {
    fontSize: 26,
    lineHeight: 30
  },
  headerBody: {
    color: theme.colors.muted,
    fontSize: 14,
    lineHeight: 21
  },
  statusBar: {
    flexDirection: "row",
    gap: 10
  },
  statusMetric: {
    flex: 1,
    minHeight: 74,
    backgroundColor: theme.colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: "space-between"
  },
  statusLabel: {
    color: theme.colors.muted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase"
  },
  statusValue: {
    color: theme.colors.text,
    fontSize: 17,
    lineHeight: 20,
    fontWeight: "700"
  },
  panelTabs: {
    gap: 8,
    paddingRight: 4
  },
  panelTab: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border
  },
  panelTabActive: {
    backgroundColor: theme.colors.brand,
    borderColor: theme.colors.brand
  },
  panelTabText: {
    color: theme.colors.muted,
    fontSize: 13,
    fontWeight: "700"
  },
  panelTabTextActive: {
    color: theme.colors.surface
  },
  cardPanel: {
    backgroundColor: theme.colors.surface,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12
  },
  adminPanel: {
    borderColor: theme.colors.brand
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: "800"
  },
  sectionMeta: {
    color: theme.colors.brand,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.6,
    textTransform: "uppercase"
  },
  dropzone: {
    borderRadius: 22,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.colors.brand,
    backgroundColor: "#eef5fb",
    paddingHorizontal: 16,
    paddingVertical: 18,
    alignItems: "flex-start",
    gap: 8
  },
  dropzoneActive: {
    backgroundColor: "#dcecff"
  },
  dropzoneTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: "800"
  },
  dropzoneBody: {
    color: theme.colors.muted,
    fontSize: 14,
    lineHeight: 20
  },
  dropzoneButton: {
    backgroundColor: theme.colors.brand,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  dropzoneButtonText: {
    color: theme.colors.surface,
    fontSize: 13,
    fontWeight: "700"
  },
  optionStack: {
    gap: 10
  },
  optionCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 6
  },
  optionCardActive: {
    borderColor: theme.colors.brand,
    backgroundColor: "#eef5fb"
  },
  optionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8
  },
  optionTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: "800"
  },
  optionTitleActive: {
    color: theme.colors.brand
  },
  optionBody: {
    color: theme.colors.muted,
    fontSize: 14,
    lineHeight: 20
  },
  badge: {
    borderRadius: 999,
    backgroundColor: "#eee4d5",
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  badgeActive: {
    backgroundColor: theme.colors.brand
  },
  badgeText: {
    color: theme.colors.muted,
    fontSize: 11,
    fontWeight: "700"
  },
  badgeTextActive: {
    color: theme.colors.surface
  },
  previewCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "#fcfaf6",
    padding: 14,
    gap: 8
  },
  previewImage: {
    width: "100%",
    height: 160,
    borderRadius: 16,
    backgroundColor: "#ddd4c8"
  },
  previewCaption: {
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase"
  },
  previewEmptyTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: "800"
  },
  previewEmptyBody: {
    color: theme.colors.muted,
    fontSize: 14,
    lineHeight: 20
  },
  loadingCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "#fcfaf6",
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  loadingText: {
    color: theme.colors.muted,
    fontSize: 14,
    fontWeight: "600"
  },
  formGrid: {
    gap: 10
  },
  fieldBlock: {
    gap: 6
  },
  fieldHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8
  },
  fieldLabel: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: "700"
  },
  input: {
    minHeight: 50,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "#fcfaf6",
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: theme.colors.text,
    fontSize: 15
  },
  notesInput: {
    minHeight: 84,
    textAlignVertical: "top"
  },
  confidenceChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  confidenceText: {
    fontSize: 11,
    fontWeight: "700"
  },
  confidenceHigh: {
    backgroundColor: "#dcf2e9"
  },
  confidenceHighText: {
    color: theme.colors.success
  },
  confidenceMedium: {
    backgroundColor: "#fff0cf"
  },
  confidenceMediumText: {
    color: "#9a6a00"
  },
  confidenceLow: {
    backgroundColor: "#fde0db"
  },
  confidenceLowText: {
    color: theme.colors.error
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "#fcfaf6",
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  toggleCopy: {
    flex: 1,
    gap: 3
  },
  toggleTitle: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "700"
  },
  toggleBody: {
    color: theme.colors.muted,
    fontSize: 13,
    lineHeight: 18
  },
  actionRow: {
    flexDirection: "row",
    gap: 10
  },
  actionButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14
  },
  primaryButton: {
    backgroundColor: theme.colors.brand
  },
  primaryButtonText: {
    color: theme.colors.surface,
    fontSize: 15,
    fontWeight: "800"
  },
  secondaryButton: {
    backgroundColor: "#eee4d5"
  },
  secondaryButtonText: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "700"
  },
  buttonDisabled: {
    opacity: 0.45
  },
  suggestionCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "#fcfaf6",
    padding: 14,
    gap: 8
  },
  suggestionTitle: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: "700"
  },
  suggestionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  suggestionChip: {
    borderRadius: 999,
    backgroundColor: "#e9f0f6",
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  suggestionChipText: {
    color: theme.colors.brand,
    fontSize: 13,
    fontWeight: "700"
  },
  assignHelp: {
    color: theme.colors.muted,
    fontSize: 13,
    lineHeight: 18
  },
  horizontalChipRow: {
    gap: 8,
    paddingRight: 4
  },
  assignmentFieldChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "#fcfaf6",
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  assignmentFieldChipActive: {
    backgroundColor: theme.colors.brand,
    borderColor: theme.colors.brand
  },
  assignmentFieldText: {
    color: theme.colors.muted,
    fontSize: 13,
    fontWeight: "700"
  },
  assignmentFieldTextActive: {
    color: theme.colors.surface
  },
  assignmentTargetBox: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "#fcfaf6",
    padding: 14,
    gap: 4
  },
  assignmentTargetLabel: {
    color: theme.colors.muted,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.2
  },
  assignmentTargetValue: {
    color: theme.colors.text,
    fontSize: 19,
    fontWeight: "800"
  },
  assignmentTargetHint: {
    color: theme.colors.muted,
    fontSize: 13
  },
  assignmentNoticeBox: {
    borderRadius: 16,
    backgroundColor: "#e8f4ea",
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  assignmentNoticeText: {
    color: theme.colors.success,
    fontSize: 13,
    fontWeight: "700"
  },
  assignmentModeRow: {
    flexDirection: "row",
    gap: 8
  },
  assignmentModeChip: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "#fcfaf6",
    paddingVertical: 10,
    alignItems: "center"
  },
  assignmentModeChipActive: {
    backgroundColor: theme.colors.brand,
    borderColor: theme.colors.brand
  },
  assignmentModeText: {
    color: theme.colors.muted,
    fontSize: 13,
    fontWeight: "700"
  },
  assignmentModeTextActive: {
    color: theme.colors.surface
  },
  assignmentClearChip: {
    borderRadius: 14,
    backgroundColor: "#fde0db",
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center"
  },
  assignmentClearText: {
    color: theme.colors.error,
    fontSize: 13,
    fontWeight: "700"
  },
  lineStack: {
    gap: 8
  },
  lineCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "#fcfaf6",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6
  },
  lineHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8
  },
  lineIndex: {
    color: theme.colors.muted,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.2
  },
  lineActionText: {
    color: theme.colors.brand,
    fontSize: 11,
    fontWeight: "700"
  },
  lineText: {
    color: theme.colors.text,
    fontSize: 15,
    lineHeight: 21
  },
  togglePanelButton: {
    alignSelf: "flex-start",
    paddingVertical: 6
  },
  togglePanelButtonText: {
    color: theme.colors.brand,
    fontSize: 13,
    fontWeight: "700"
  },
  errorBox: {
    borderRadius: 18,
    backgroundColor: "#fde0db",
    padding: 14,
    gap: 5
  },
  errorTitle: {
    color: theme.colors.error,
    fontSize: 15,
    fontWeight: "800"
  },
  errorBody: {
    color: theme.colors.error,
    fontSize: 13,
    lineHeight: 19
  },
  syncStateBox: {
    borderRadius: 18,
    padding: 14,
    gap: 5
  },
  syncStateProgress: {
    backgroundColor: "#eef5fb"
  },
  syncStateSuccess: {
    backgroundColor: "#e8f4ea"
  },
  syncStateError: {
    backgroundColor: "#fde0db"
  },
  syncStateTitle: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "800"
  },
  syncStateBody: {
    color: theme.colors.muted,
    fontSize: 13,
    lineHeight: 19
  },
  rawTextBox: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "#fcfaf6",
    padding: 14
  },
  rawText: {
    color: theme.colors.muted,
    fontSize: 13,
    lineHeight: 19
  },
  savedStack: {
    gap: 10
  },
  savedCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "#fcfaf6",
    padding: 14,
    gap: 10
  },
  savedCardLatest: {
    borderColor: theme.colors.brand
  },
  savedHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10
  },
  savedCopy: {
    flex: 1,
    gap: 3
  },
  savedName: {
    color: theme.colors.text,
    fontSize: 17,
    fontWeight: "800"
  },
  savedMeta: {
    color: theme.colors.muted,
    fontSize: 13,
    lineHeight: 18
  },
  latestChip: {
    borderRadius: 999,
    backgroundColor: "#dcecff",
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  latestChipText: {
    color: theme.colors.brand,
    fontSize: 11,
    fontWeight: "700"
  },
  savedActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  savedActionButton: {
    minHeight: 40,
    borderRadius: 14,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center"
  },
  savedActionPrimary: {
    backgroundColor: theme.colors.brand
  },
  savedActionPrimaryText: {
    color: theme.colors.surface,
    fontSize: 13,
    fontWeight: "700"
  },
  savedActionSecondary: {
    backgroundColor: "#eee4d5"
  },
  savedActionSecondaryText: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: "700"
  }
});
