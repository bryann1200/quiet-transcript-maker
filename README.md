# Smork Smart Notes

Build a clean, minimal web app called "Smork" for recording lectures/meetings and generating AI transcripts and notes.

Design direction: simple, calm, focused — like a notes app, not a dashboard. Dark mode by default. Generous whitespace, rounded cards, one clear primary action at a time. No clutter, no unnecessary icons.

Layout:

1. Header: "Smork" with a short subtitle

2. Settings section (collapsible/tucked away, not front and center): dropdown to choose AI engine (Gemini or Groq), password-style input fields for API keys, stored locally

3. Main record area: a large, obvious record button that toggles to a stop state while recording, a running timer, and a subtle "live preview" text area showing rough live captions while recording

4. After recording: a card showing the accurate transcript (collapsible/secondary) and a prominent card showing the generated "Smart Notes" (the main output, emphasized), each with a copy button

5. History section below: a simple list of past sessions (date + short preview), click to reopen, with delete and clear-all options

6. A small "New" button to reset the current view

Keep the visual hierarchy centered on the Smart Notes output — that's the main value, everything else supports it. Use a restrained color palette (dark background, one accent color for the record button and links, muted grays for secondary text).

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/9f8cfcf4-ece9-4115-a767-c965353299e4).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
