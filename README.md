# Tunet Dashboard

A modern React dashboard for Home Assistant with real-time entity control, energy monitoring, and multi-device profile sync.

![Main Dashboard](public/Main.png)

## Features

### 🎴 Cards

- **Universal Sensor Card**: One card to rule them all. Handles numeric sensors (with history graphs), binary sensors (doors, windows, motion), switches, input booleans, scripts, and scenes.
- **Specialized Control Cards**:
  - **Alarm** (BETA): Arm/disarm with mode selection, PIN-protected actions, and quick-action keypad.
  - **Light**: Brightness, color (RGB/temp), and toggle limits.
  - **Climate**: Thermostat modes, target temperature, and HVAC action feedback.
  - **Media**: Generic media players + dedicated **Android TV** remote with app launching.
    - Playlist browsing requires a **Music Assistant** `media_player`.
    - Sonos Favorites browsing requires a **Sonos** `media_player`.
  - **Cover**: Position sliders for blinds and toggle controls for garage doors.
  - **Vacuum**: State monitoring, start/pause/dock commands.
  - **Fan**: Speed percentage, oscillation, and direction controls.
- **Energy & Environment**:
  - **Nordpool**: Hourly electricity prices with beautiful trend graphs.
  - **Energy Cost**: Track daily and monthly energy expenditure.
  - **Weather**: Dynamic weather animations, current temperature, and forecasts.
  - **Car**: EV monitoring (battery, range, charging status).
- **Productivity & Organization**:
  - **Calendar**: Agenda view for upcoming events.
  - **Todo Lists**: Manage Home Assistant to-do items.
  - **Room Card**: Compact summary of a room's state (lights, temp, occupancy).
  - **Person**: Presence detection and location tracking.

### 🚀 Advanced Capabilities

- **Server-side Profiles + Deploy**: Save layout configurations per user, load on any device, and publish/deploy current settings to selected devices.
- **Validated Backend Auth**: Protected profile/settings API calls are verified against the authenticated Home Assistant user, not just browser-side state.
- **Conflict-safe Settings Sync**: Multi-device settings updates use revision-aware sync to prevent stale tabs from overwriting newer layouts.
- **Optional Data-at-Rest Encryption**: Encrypt server-stored profiles/settings with migration-safe compatibility modes.
- **Persistent OAuth Session Reuse**: Browser-stored OAuth sessions can survive reloads and same-browser tab handoff while backend API calls continue to validate against Home Assistant.
- **Dashboard Import/Export**: Portable JSON backup/restore directly from Profiles.
- **Live Updates**: Instant state reflection via Home Assistant WebSocket.
- **Drag-and-Drop Grid**: Fully customizable masonry layout.
- **Settings Lock**: PIN protection prevents accidental edits.
- **Theming**: Dark/Light modes with high-end glassmorphism and animated backgrounds.
- **Multi-language**: Native support for English, German, Norwegian (NB/NN), Swedish, and Simplified Chinese.

## Quick Start

### Home Assistant Add-on

1. Go to **Settings** -> **Add-ons** -> **Add-on Store** -> **Repositories** (three dots).
2. Add `https://github.com/oyvhov/tunet`.
3. Install **Tunet Dashboard**.
4. Configure and Start.

### Docker Compose (Recommended)

```bash
git clone https://github.com/oyvhov/tunet.git
cd tunet
docker compose up -d
```

Open `http://localhost:3002` and connect your Home Assistant instance.

### Local Development

```bash
git clone https://github.com/oyvhov/tunet.git
cd tunet
npm install
npm run dev:all
```

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3002/api`

## Public Dashboard Mode (Kiosk Mode)

Public Mode lets you run Tunet on wall-mounted tablets or kiosk screens without requiring a manual login. When enabled, new devices that open the dashboard are automatically bootstrapped with the pre-configured Home Assistant credentials and the latest saved profile from the database.

### Configuration Parameters

| Parameter | Type | Description |
|---|---|---|
| `tunet_public_mode_enabled` | Boolean | Enables Public Mode. When `true`, the login screen is bypassed for new devices and the credentials below are used automatically. |
| `tunet_public_ha_url` | String | Internal or external URL of your Home Assistant instance (e.g. `http://192.168.1.100:8123`). |
| `tunet_public_ha_token` | Password | A Long-Lived Access Token from HA used by the public dashboard to fetch entity data and control devices. |
| `tunet_public_read_only` | Boolean | Locks the dashboard layout. Users cannot move cards, add new ones, or access settings. Ideal for wall-mounted tablets. |

### Quick Start Guide

1. **Generate a Long-Lived Access Token** in Home Assistant: go to your profile page (`/profile`) → scroll to *Long-Lived Access Tokens* → *Create Token*.
2. **Set the parameters** in the Add-on configuration (or as environment variables when using Docker):
   ```yaml
   tunet_public_mode_enabled: true
   tunet_public_ha_url: 'http://192.168.1.100:8123'
   tunet_public_ha_token: 'your_token_here'
   tunet_public_read_only: true   # optional — locks layout on kiosk screens
   ```
3. **Restart the Add-on** (or container) to apply the new settings.
4. **Verify** by opening the dashboard in an incognito / private window — it should load without showing the login screen.

### Troubleshooting

> **Dashboard appears empty after the first load?**
> Ensure you have imported or saved at least one profile while logged in as a normal user. Public Mode automatically serves the most recently saved profile in the database. If the database is empty, save your layout once from the Profiles panel and reload the kiosk page.

---

## Updating

See [SETUP.md](SETUP.md) for detailed setup, configuration, and troubleshooting.
See [CARD_OPTIONS.md](CARD_OPTIONS.md) for card-by-card options and screenshots.
See [CSS_VARIABLES.md](src/docs/CSS_VARIABLES.md) for theme token naming and usage.

## Technologies

- React 18 + Vite 7
- Tailwind CSS 4
- Express + SQLite (profile storage)
- Home Assistant WebSocket API
- Lucide Icons + MDI

## 🗺️ Roadmap

See our [ROADMAP.md](ROADMAP.md) for planned features and future development.

## License

GNU General Public License v3.0 — See [LICENSE](LICENSE)

## Author

[oyvhov](https://github.com/oyvhov)
