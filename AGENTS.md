# Beast Agent Instructions

- Do not use rounded corners in the Beast UI. This is screenwriting software, and interface surfaces should reflect paper with hard corners.
- Avoid adding `border-radius` in CSS or component styles unless the user explicitly overrides this instruction.
- In Tauri/webview UI, do not use raw `file://` URLs as image/video/audio/PDF preview sources or rely on plain anchor navigation for local files. Use the Tauri asset protocol for previews and route file/link opening through the app's native opener command, such as `open_external_target`, so local files actually open outside the webview.
