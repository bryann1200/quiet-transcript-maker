# Build Smork

## What I’ll build
- Replace the blank screen with a calm, dark, mobile-first recording workspace named Smork.
- Keep settings tucked behind a compact disclosure, with Gemini/Groq selection and locally stored API keys.
- Add microphone recording, a running timer, browser live captions when available, and a clear stop state.
- After recording, generate an accurate transcript and Smart Notes with the selected AI engine, emphasizing Smart Notes.
- Add copy controls, collapsible transcript, a New action, and local session history with reopen, delete, and clear-all.
- Show useful empty, recording, processing, permission, unsupported-browser, and API error states.

## Visual direction
- Deep charcoal surfaces, muted gray text, a restrained coral accent, generous whitespace, and softly rounded panels.
- One obvious action at a time; Smart Notes becomes the visual focus after processing.
- Responsive layout optimized for the current mobile viewport while remaining polished on desktop.

## Technical details
- Use browser microphone capture and SpeechRecognition for rough live captions where supported.
- Send complete recorded audio directly from the browser to the selected user-configured provider: Gemini for transcription/notes, or Groq for transcription/notes.
- Keep API keys and session history in local browser storage only; no account or cloud database.
- Add route-specific metadata and preserve the existing TanStack app structure.
- Verify recording-related states with browser checks; microphone capture itself depends on browser permission and hardware.
