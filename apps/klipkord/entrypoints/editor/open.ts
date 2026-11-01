/** The editor tab for a recording: `editor.html#/<recordingId>`. */
export const editorPath = (recordingId: string) => `/editor.html#/${encodeURIComponent(recordingId)}` as const;

/** Opens the recording in the editor, or brings its open editor tab forward. */
export async function openEditor(recordingId: string): Promise<void> {
  const url = browser.runtime.getURL(editorPath(recordingId));
  try {
    // Query patterns ignore the #fragment, so every editor tab comes back; the recording is matched here.
    const tabs = await browser.tabs.query({ url: `${browser.runtime.getURL('/editor.html')}*` });
    const tab = tabs.find((t) => t.url === url);
    if (tab?.id !== undefined) {
      await browser.tabs.update(tab.id, { active: true });
      if (tab.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true });
      return;
    }
  } catch (error) {
    console.error('Klipkord: could not look for the editor tab', error);
  }
  await browser.tabs.create({ url });
}
