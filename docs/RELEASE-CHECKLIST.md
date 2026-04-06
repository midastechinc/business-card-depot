# Mobile Release Checklist

## Before first release

- App folder has its own name and updated metadata
- `README.md` explains setup and usage
- `.env.example` is current
- Dedicated GitHub repo exists
- Dashboard card exists with GitHub link

## Android APK release flow

1. Build the Android artifact
2. Rename the APK clearly, for example `my-app-v0.1.0.apk`
3. Upload the APK to GitHub Releases
4. Update the dashboard card to point to the latest APK link
5. Run the dashboard sync and audit scripts

## Definition of done

- Repo exists
- APK exists in GitHub Releases
- Dashboard card exists
- Manual exists
- Audit passes without structural issues
