# ChatGPT Multi-Delete

A Chrome extension that enables bulk deletion of ChatGPT conversations with an intuitive multi-select interface.

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Manifest](https://img.shields.io/badge/manifest-v3-orange.svg)

## ✨ Features

- **Multi-select mode** - Choose multiple conversations at once
- **Bulk deletion** - Delete multiple chats with a single click
- **Native integration** - Seamlessly works with ChatGPT's interface
- **Dark mode support** - Automatically adapts to your theme
- **Safe & private** - All operations happen locally in your browser

![chatgpt-bulk-delete](https://github.com/user-attachments/assets/be59cb08-8793-4378-8046-deebcbeae522)

## 🚀 Installation

1. **Clone this repository**:

   ```bash
   git clone https://github.com/yourusername/chatgpt-bulk-delete.git
   cd chatgpt-bulk-delete
   ```

2. **Open Chrome Extensions**:

   - Go to `chrome://extensions/`
   - Enable "Developer mode" (top-right toggle)

3. **Load the extension**:
   - Click "Load unpacked"
   - Select the `chatgpt-bulk-delete` folder

The extension is now active on ChatGPT pages.

## 📖 Usage

1. Go to [chat.openai.com](https://chat.openai.com) or [chatgpt.com](https://chatgpt.com)
2. Click the **"Select"** button in the toolbar at the top of your chat sidebar
3. Check the conversations you want to delete
4. Click **"Delete"** and confirm

```
┌─────────────────────────────────────┐
│ [Select]    2 selected    [Delete]   │
├─────────────────────────────────────┤
│ ☐ Conversation 1                    │
│ ☑ Conversation 2                    │
│ ☑ Conversation 3                    │
└─────────────────────────────────────┘
```

## 🔧 How It Works

This extension uses **Manifest V3** and operates entirely through DOM manipulation. It simulates user interactions to delete conversations, ensuring compatibility with ChatGPT's native deletion flow.

**Components:**

- `contentScript.js` - Injects the UI and handles deletion workflow
- `styles.css` - Styling that matches ChatGPT's design
- `background.js` - Service worker for extension lifecycle

The extension finds conversations, clicks their menu buttons, selects delete, and confirms - just like you would manually, but automated for multiple chats.

## 🔒 Privacy & Safety

**Privacy:**

- No data collection or tracking
- No external servers - everything happens locally
- Open source - review the code yourself

**Safety:**

- Confirmation required for every deletion
- Sequential deletion (one at a time) prevents accidents
- Uses ChatGPT's native deletion flow with all safety checks

**Permissions:**

- `scripting` - To inject the UI into ChatGPT pages
- `activeTab` - To interact with the active tab
- Limited to `chat.openai.com` and `chatgpt.com` only

## ⚠️ Limitations

- Chats are deleted sequentially (by design, for safety)
- May break if ChatGPT significantly changes their UI
- Deleted chats cannot be recovered
- Chrome/Chromium browsers only

## 🐛 Troubleshooting

**Extension not appearing?**

- Make sure you're on `chat.openai.com` or `chatgpt.com`
- Check that the extension is enabled in `chrome://extensions/`
- Refresh the page

**Checkboxes not showing?**

- Click the "Select" button to activate multi-select mode
- Ensure conversations are loaded in the sidebar

**Deletion failing?**

- Check browser console for error messages
- Ensure you have permission to delete (not shared/archived chats)
- Try deleting one chat manually first

## 🛠️ Development

**Project Structure:**

```
chatgpt-bulk-delete/
├── icon/              # Extension icons
├── manifest.json      # Extension manifest
├── contentScript.js   # Main logic
├── styles.css         # Styling
├── background.js      # Service worker
└── README.md
```

**Tech Stack:**

- Vanilla JavaScript (no build step)
- Manifest V3
- DOM APIs for interaction simulation

## 🤝 Contributing

Contributions are welcome! Please:

1. Check existing [Issues](https://github.com/yourusername/chatgpt-bulk-delete/issues) first
2. Fork the repo and create a feature branch
3. Test thoroughly on ChatGPT
4. Submit a Pull Request

**Areas for contribution:**

- Browser support (Firefox, Edge)
- UI/UX improvements
- Bug fixes
- Better DOM selector strategies

## 📝 License

MIT License - see [LICENSE](LICENSE) for details.

## 📞 Support

- [GitHub Issues](https://github.com/yourusername/chatgpt-bulk-delete/issues)
- [GitHub Discussions](https://github.com/yourusername/chatgpt-bulk-delete/discussions)

---

**Disclaimer**: This extension is not affiliated with OpenAI or ChatGPT. It's an independent, open-source project.

**Important**: Always review code before installing browser extensions. This extension is open source so you can verify its behavior.
