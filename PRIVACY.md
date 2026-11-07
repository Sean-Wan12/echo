# Echo privacy

Echo is a personal study assistant for Zen on macOS. It sends your question, the active tab's accessible text (including its title and URL), and an image of the visible tab to OpenAI through the local Echo helper when you submit a question. A manual Snapshot sends the region you select. Content you choose to discuss can contain personal information or communications.

Echo does not continuously record the screen. Website access is used for the active tab when you submit a question. Closing the sidebar clears the conversation held in extension memory; this does not delete data already transmitted to OpenAI. OpenAI processes requests under your account and its applicable data policies.

ChatGPT sign-in is handled by OpenAI. The native helper stores authorization tokens and account details in your macOS Keychain and uses them to authenticate requests to OpenAI. Echo does not store your OpenAI password. Sign out in Echo's settings to remove the helper's saved credentials.

Appearance and model preferences are stored in browser extension storage. Echo has no advertising or analytics service. Its operator does not receive a separate copy of your questions. Source code submitted to Mozilla for signing contains no saved chats or account credentials.

You can revoke optional website access in Zen's extension permissions, revoke macOS screen recording access in System Settings, sign out of ChatGPT in Echo, or uninstall Echo through Zen's Add-ons Manager. Uninstalling the extension does not uninstall the separate native helper or erase OpenAI's records.
