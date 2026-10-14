# ChatGPT Usage Bar
![Version](https://img.shields.io/badge/version-5.0.0-blue)
![Platform](https://img.shields.io/badge/platform-Tampermonkey%20%7C%20Violentmonkey-orange)
![License](https://img.shields.io/badge/license-MIT-green)

[English](README.md) | [简体中文](README.zh-CN.md)

[Install from Greasy Fork](https://greasyfork.org/en/scripts/600084-chatgpt-usage-bar)

A lightweight Tampermonkey userscript that displays remaining ChatGPT usage directly inside the profile row in the ChatGPT sidebar.


## Features

- Displays **remaining usage**, not used percentage
- Shows multiple usage windows such as `5h` and `7d`
- Uses compact progress bars inside the profile row
- Automatically follows ChatGPT light and dark themes
- Refreshes after ChatGPT finishes generating a response
- Refreshes after returning to the page when cached data is older than 5 minutes
- Supports manual refresh by hovering over the profile row for 2 seconds
- Shows a circular 2-second hover progress indicator
- Shows a subtle 60-second cooldown ring after manual refresh
- Avoids fixed-interval polling of the usage API
- Re-mounts automatically when ChatGPT rebuilds the sidebar

## Preview

```text
┌──────────────────────────────────────────────┐
│  AZ   User Name          5h  ███████░   72%  │
│       Plus               7d  █████████  94%  │
└──────────────────────────────────────────────┘
```

The circular refresh indicator only appears while:

1. charging during the 2-second hover action
2. counting down the 60-second manual refresh cooldown

After the cooldown finishes, the ring disappears.

## Installation

### Requirements

- Tampermonkey or another compatible userscript manager
- A supported desktop browser
- An active ChatGPT web session

### Install from Greasy Fork (recommended)

1. Install Tampermonkey or another compatible userscript manager.
2. Open [ChatGPT Usage Bar on Greasy Fork](https://greasyfork.org/en/scripts/600084-chatgpt-usage-bar).
3. Click **Install this script** and confirm installation in your userscript manager.
4. Reload [ChatGPT](https://chatgpt.com/).

The usage widget should appear in the profile row at the bottom of the sidebar.

### Manual installation from GitHub

1. Install Tampermonkey.
2. Create a new userscript.
3. Replace the default template with the complete contents of [GPTusage.js](GPTusage.js).
4. Save the script.
5. Reload `https://chatgpt.com/`.

The usage widget should appear in the profile row at the bottom of the sidebar.

## Refresh Behaviour

ChatGPT Usage Bar intentionally avoids continuous API polling.

| Trigger | Behaviour |
| --- | --- |
| Initial page load | Fetch once |
| ChatGPT finishes generating | Fetch after a short delay |
| Resume after inactivity | Fetch only if the previous successful result is older than 5 minutes |
| Hover profile row for 2 seconds | Fetch once |
| Hover cooldown | Prevent repeated manual refreshes for 60 seconds |

The generation detector currently watches for:

```text
button[aria-label="Stop"]
```

When the button disappears and does not return during the completion delay, the response is treated as complete.

## Manual Hover Refresh

```text
Hover profile row
        ↓
2-second progress ring
        ↓
Refresh usage
        ↓
60-second subtle cooldown ring
        ↓
Ring disappears
```

Moving the pointer away before the 2-second hold completes cancels the refresh.

## Theme Integration

The UI follows ChatGPT's current theme instead of maintaining a separate colour scheme.

For example:

```css
color: inherit;
background: currentColor;
stroke: currentColor;
```

This allows the widget to adapt automatically to light and dark themes.

## Configuration

The main behaviour can be adjusted near the top of the script:

```javascript
const CONFIG = Object.freeze({
    debug: false,

    hoverHoldMs: 2_000,
    hoverCooldownMs: 60_000,

    resumeThresholdMs: 5 * 60_000,
    generationEndDelayMs: 2_000,
    completionMinAgeMs: 15_000,

    generationCheckMs: 750,
    mountRetryMs: 500,
    requestTimeoutMs: 10_000
});
```

Examples:

```javascript
// Require a 3-second hover before manual refresh
hoverHoldMs: 3_000,

// Use a 2-minute hover cooldown
hoverCooldownMs: 120_000,

// Refresh after returning to data older than 10 minutes
resumeThresholdMs: 10 * 60_000,
```

## Code Structure

Repository files:

| File | Purpose |
| --- | --- |
| [GPTusage.js](GPTusage.js) | Userscript source |
| [README.md](README.md) | English documentation |
| [README.zh-CN.md](README.zh-CN.md) | Simplified Chinese documentation |
| [LICENSE.txt](LICENSE.txt) | MIT License |

The userscript remains a single file to keep deployment simple, but the source is organised into clear sections:

```text
1.  Configuration
2.  Runtime State
3.  Debug
4.  Utilities
5.  Authentication
6.  Usage API
7.  Usage Data
8.  ChatGPT DOM
9.  UI Style
10. UI Create / Mount
11. Usage Render
12. Refresh Policy
13. Refresh Ring
14. Generation Watch
15. Page Resume
16. SPA DOM Watch
17. Init
```

No build step or external runtime dependency is required.

## Security and Privacy

ChatGPT Usage Bar is designed to minimise exposure of authentication data.

- Requests are made only to same-origin ChatGPT endpoints
- Access tokens and account identifiers remain in local function scope
- Authentication data is not written to `localStorage`, `sessionStorage`, or IndexedDB
- Authentication data is not inserted into the page DOM
- Debug logging is disabled by default
- Raw authentication data is not printed to the console
- No third-party analytics or telemetry is included
- No external JavaScript dependencies are loaded

The script uses the existing authenticated ChatGPT session only to request usage information.

## Internal APIs

The script currently relies on ChatGPT internal endpoints such as:

```text
/api/auth/session
/backend-api/wham/usage
```

These are not stable public APIs and may change without notice.

## DOM Dependencies

The script also relies on parts of the current ChatGPT interface, including selectors such as:

```text
button[aria-label="Open profile menu"]
button[aria-label="Stop"]
```

If ChatGPT changes its DOM structure or accessibility labels, the script may require an update.

Selectors and API paths are kept together in the source to make maintenance easier.

## Known Limitations

- ChatGPT internal APIs may change
- ChatGPT DOM selectors may change after frontend updates
- Usage values may not update immediately after a response finishes
- The script only displays usage windows returned by the current usage endpoint
- The script targets the ChatGPT web interface

## Development

No build process is required.

Edit the userscript directly, save it in Tampermonkey, and reload ChatGPT.

For local debugging:

```javascript
debug: true
```

When contributing changes:

- Keep authentication and account information out of logs and screenshots
- Avoid increasing API request frequency unnecessarily
- Prefer semantic selectors over generated CSS class names
- Keep configuration values centralised
- Keep light and dark theme compatibility
- Avoid external dependencies unless they provide a clear benefit

## Disclaimer

ChatGPT Usage Bar is an unofficial community userscript.

It is not affiliated with, endorsed by, or maintained by OpenAI.

ChatGPT frontend behaviour and internal endpoints may change at any time.

## License

Licensed under the MIT License.

See [LICENSE.txt](LICENSE.txt) for details.
