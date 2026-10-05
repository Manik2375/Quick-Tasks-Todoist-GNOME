# Quick Tasks for Todoist

A GNOME Shell extension for managing Todoist tasks directly from the top panel.

## Features

- **Panel Indicator**: Displays task counts and optionally the active task title.
- **Task Management**: Create tasks quickly from the menu and mark tasks as complete with smooth UI transitions.
- **Task Details**: Visual badges for Todoist projects, user labels, due dates, and overdue day counters.
- **Customizable Sorting**: Supports sorting by newest first, priority, or Todoist default order.
- **Preferences**: Libadwaita-based configuration window to customize task display and top bar appearance.

## Requirements

- GNOME Shell 45 or later
- Libadwaita
- libsoup 3.0

## Installation

1. Clone the repository into your GNOME Shell extensions directory:
   ```bash
   git clone https://github.com/Manik2375/Quick-Tasks-Todoist-GNOME.git ~/.local/share/gnome-shell/extensions/quick-tasks-todoist@manik2375.com
   ```

2. Compile the schema:
   ```bash
   glib-compile-schemas ~/.local/share/gnome-shell/extensions/quick-tasks-todoist@manik2375.com/schemas/
   ```

3. Restart GNOME Shell:
   - **X11**: Press `Alt + F2`, type `r`, and press `Enter`.
   - **Wayland**: Log out and log back in.

4. Enable the extension:
   ```bash
   gnome-extensions enable quick-tasks-todoist@manik2375.com
   ```

## Configuration

1. Open the extension preferences via **GNOME Extensions** or **Extension Manager**.
2. Click **Find Permanent API Token** or navigate to [Todoist Developer Settings](https://app.todoist.com/app/settings/integrations/developer).
3. Copy your API token and paste it into the **Personal API Token** field.

## License

This project is licensed under the terms of the GNU General Public License v3.0 (GPL-3.0). See [LICENSE](LICENSE) for details.
