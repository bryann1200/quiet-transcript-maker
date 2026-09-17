# SpongeBob-style redesign and recording retry

## What I’ll change
- Rename the app to “Bryan’s super duper smart note taker” throughout the visible page and page metadata.
- Remove live captions and the live-preview area while keeping microphone recording, timer, settings, history, transcript, and Smart Notes.
- Restyle the workspace with an original undersea-cartoon look inspired by SpongeBob: bright ocean colors, bubbly shapes, playful type, and nautical details without copying character artwork.
- Keep Smart Notes restrained and highly readable, using a clean paper-like treatment within the playful page.
- Preserve the latest recorded audio in memory when Gemini or Groq processing fails and show a Retry button that reuses that exact audio.
- Clear retained audio only after processing succeeds, when a new recording starts, or when New is selected.

## Technical details
- Store the pending audio Blob and its recording duration in refs so a failed request can be retried without recording again.
- Use the same engine and API key selected at retry time, with the existing Gemini upload/transcription/notes flow unchanged.
- Remove browser speech-recognition setup and related state/types.
- Add retrying and recording safeguards so duplicate submissions cannot occur.
- Verify the failed-processing state, Retry action, desktop/mobile presentation, and app health.
