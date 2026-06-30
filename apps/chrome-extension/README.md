# Beast Capture Chrome Extension

Development extension for capturing Chrome research into the Beast Tauri app.

## Load Unpacked

1. Start Beast desktop and open or save a project folder.
2. Open Chrome Extensions at `chrome://extensions`.
3. Enable Developer Mode.
4. Choose **Load unpacked** and select `apps/chrome-extension`.
5. Open the Beast Capture side panel from the extension icon.

Reload the unpacked extension from `chrome://extensions` after changing files in this folder.

## Capture Controls

- **Capture selection in Beast** from the page context menu copies Chrome's selected text into the side panel Selection field, fills the current page title and URL, and opens the side panel.
- **Use Current Tab** fills the title, URL, and current selected text from the active Chrome tab without saving anything.
- **Save to Beast** sends the current form values to the selected saved Beast desktop project.
- **Refresh Projects** reloads the saved/open Beast projects registered by the desktop app's localhost bridge.

## Bridge

The extension talks to the Beast desktop localhost bridge at `http://127.0.0.1:33179`.

Captures are saved into the selected project as:

- research data under `panels/contexts/project.json`
- screenshots under `assets/research/*.jpg`

The web app does not run the localhost bridge.

## Debugging

- Side panel errors: right-click inside the Beast Capture side panel and choose **Inspect**.
- Background/context-menu errors: open `chrome://extensions`, find **Beast Capture**, and click the service worker **Inspect** link.
- Bridge errors: make sure the Tauri desktop app is running and the project has been saved to a folder.
