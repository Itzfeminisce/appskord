export default defineBackground(() => {
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error: unknown) => {
    console.error('Briefkord: could not set the side panel to open from the toolbar', error);
  });
});
