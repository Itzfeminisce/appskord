# Rekord privacy policy

Rekord is a Chrome extension that writes down your meetings. This page says what stays on your computer, what leaves it, and when.

## What stays on your computer
Your recordings, transcripts, summaries, speaker names and settings are stored in your browser, on your computer. Rekord has no account, no server of its own and no sync. If you remove the extension, that data goes with it.

## What leaves your computer, and when
Rekord sends data out only to do something you asked for, and only to the service that does it.

- **While you record:** short pieces of meeting audio go to the transcription service you chose (Groq, OpenAI, OpenRouter or Deepgram). If you use Ollama on your own computer, nothing leaves it.
- **When a meeting is summarised, or you ask a question:** the transcript text, or the parts relevant to your question, go to the summary service you chose (Groq, OpenAI, Anthropic, OpenRouter, or your own Ollama).
- **Who said what:** if speaker labelling is on, audio goes to Deepgram.
- **Your keys:** if you connect Penv Cloud (https://penv.cloud), Rekord asks it for your service keys so you don't paste them in. Keys are kept in your browser and are only sent to the service they belong to.
- **Google Calendar and Google Docs:** only if you connect them. Rekord reads your upcoming events to name meetings, and creates a Google Doc only when you choose to share a meeting.
- **Notion:** only if you connect it. Rekord sends a meeting to your Notion, or action items to a Notion database, only when you choose to.
- **Memory:** after a meeting, its transcript text goes to your summary service so Rekord can find promises, decisions, questions and people. The memory itself is stored on your computer.
- **Search by meaning:** if you agree, Rekord downloads a 22 MB search model once from huggingface.co. Search runs on your computer; your meetings are never sent there.
- **Briefs and reminders:** built from data already on your computer. A brief may send your notes about the people in the meeting to your summary service to write "Last time" in three lines.
- **Google Tasks and Linear:** only when you send action items there. Google asks you for the extra Tasks permission the first time.
- **Gmail:** Rekord opens a Gmail draft in a new tab. It never sends email itself.
- **Off the record:** while it is on, nothing is transcribed, sent or remembered.
- **What left this computer:** Rekord lists every outside call, per meeting, by service and time.

Each service handles what it receives under its own privacy policy. Rekord does not sell or share your data with anyone else.

## What Rekord does not do
- No tracking, analytics, advertising or crash reporting.
- No reading of the pages you visit. Rekord captures audio only from the tab you start recording on.
- No recording unless you start it.

## Your control
Delete any meeting in Rekord and it is gone from your computer, with its memory. You can redact part of a meeting, forget a person, or forget all memory. If you turn on the Rekord folder, Rekord also writes Markdown files to a folder you pick. Disconnect Google, Notion or Penv Cloud at any time in Settings. Audio is kept only if you turn that on.

## Questions
Use the contact details on Rekord's Chrome Web Store page.

Last updated: 2026-11-02
