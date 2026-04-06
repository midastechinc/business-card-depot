# Business Card Depot

Business Card Depot is a mobile app for capturing business cards, extracting contact details, and saving them into the phone contact list.

## Core idea

The app should support three intake paths:

1. Scan a physical business card with the phone camera
2. Import a saved image of a business card
3. Import a screenshot from a website or contact page

After intake, the app should:

1. Extract name, company, title, phone number, email, website, and address
2. Let the user review and correct the extracted fields
3. Save the final contact into the device contact list

## Planned feature set

- Camera capture for physical cards
- Image import from gallery or files
- OCR extraction pipeline
- Manual review screen before save
- One-tap save to contacts
- History of recently scanned cards
- Tags or notes for follow-up

## Suggested technical direction

- Expo + React Native
- Android-first release flow
- OCR layer to be chosen during implementation
- Device contacts integration after extraction review

## Local development

```powershell
npm install
npm run start
```

## Build an APK

Use the preview build profile for a phone-installable Android APK:

```powershell
npm run build:apk
```

That command uses EAS Build and will prompt for Expo login/project setup the first time.

Recommended first APK workflow:

1. Log in to Expo when prompted.
2. Let EAS create or link the project.
3. Use the `preview` profile so the output is an `.apk`.
4. Download the finished APK from the EAS build page.
5. Upload that APK to the `business-card-depot` GitHub Releases page.
6. Add the GitHub release APK link to the application dashboard.

## Required next steps

1. Build the contact-save flow for native Android.
2. Create the first preview APK build.
3. Upload APK builds to GitHub Releases.
4. Add the dashboard entry with the final APK link.
