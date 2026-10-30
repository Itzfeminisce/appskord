// Machine-check build only: the toolbar icon opens the check page. T1 replaces this with the side panel.
export default defineBackground(() => {
  chrome.action.onClicked.addListener(() => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('/check.html') });
  });
});
