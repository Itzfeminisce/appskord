import '@fontsource-variable/geist';
import '../../styles/tokens.css';
import { MIC_CHANNEL, type MicMessage } from '../../lib/voice/listen';

// voice-mic-tab: the side panel can't show Chrome's microphone prompt, so this tab asks once and closes itself.
async function ask(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Nothing is recorded here: the stream only proves access and stops at once.
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

void ask().then((granted) => {
  const channel = new BroadcastChannel(MIC_CHANNEL);
  channel.postMessage({ granted } satisfies MicMessage);
  channel.close();
  window.close();
});
