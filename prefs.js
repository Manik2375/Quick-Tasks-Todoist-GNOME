/**
 * prefs.js
 * Libadwaita Preferences Window for Quick Tasks for Todoist.
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class QuickTasksPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'view-list-bullet-symbolic',
        });
        window.add(page);

        // 1. Authentication Group
        const authGroup = new Adw.PreferencesGroup({
            title: _('Todoist Account'),
            description: _('Connect your account using your Todoist Personal API Token.'),
        });
        page.add(authGroup);

        const tokenRow = new Adw.PasswordEntryRow({
            title: _('Personal API Token'),
        });
        settings.bind('api-token', tokenRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        authGroup.add(tokenRow);

        const linkRow = new Adw.ActionRow({
            title: _('Find Permanent API Token'),
            subtitle: _('Under Settings > Integrations > Developer > API token (never expires)'),
            activatable: true,
        });
        const openIcon = new Gtk.Image({
            icon_name: 'network-server-symbolic',
            valign: Gtk.Align.CENTER,
        });
        linkRow.add_suffix(openIcon);
        linkRow.connect('activated', () => {
            Gio.AppInfo.launch_default_for_uri(
                'https://app.todoist.com/app/settings/integrations/developer',
                null
            );
        });
        authGroup.add(linkRow);

        // 2. Top Bar Indicator Display
        const displayGroup = new Adw.PreferencesGroup({
            title: _('Top Bar Indicator'),
            description: _('Configure how your ongoing task and counts appear in the GNOME panel.'),
        });
        page.add(displayGroup);

        const showCurrentTaskRow = new Adw.SwitchRow({
            title: _('Show Ongoing Task in Top Bar'),
            subtitle: _('Display the title of your current active task next to the checkmark icon'),
        });
        settings.bind('show-current-task-in-panel', showCurrentTaskRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(showCurrentTaskRow);

        const maxLenRow = new Adw.SpinRow({
            title: _('Maximum Title Characters'),
            subtitle: _('Truncates long task titles in the top bar to save space'),
            adjustment: new Gtk.Adjustment({
                lower: 10,
                upper: 80,
                step_increment: 2,
                page_increment: 10,
                value: settings.get_int('max-panel-task-length'),
            }),
        });
        settings.bind('max-panel-task-length', maxLenRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(maxLenRow);

        // 3. Task Details & Appearance
        const taskDisplayGroup = new Adw.PreferencesGroup({
            title: _('Task Details & Appearance'),
            description: _('Configure what details are displayed on tasks in the popup list.'),
        });
        page.add(taskDisplayGroup);

        const showLabelsRow = new Adw.SwitchRow({
            title: _('Show Task Labels'),
            subtitle: _('Display Todoist tags/labels (e.g. @work) on task items'),
        });
        settings.bind('show-task-labels', showLabelsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        taskDisplayGroup.add(showLabelsRow);

        const showDueDatesRow = new Adw.SwitchRow({
            title: _('Show Due Dates'),
            subtitle: _('Display scheduled dates on tasks'),
        });
        settings.bind('show-due-dates', showDueDatesRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        taskDisplayGroup.add(showDueDatesRow);

        const showProjectRow = new Adw.SwitchRow({
            title: _('Show Project Name'),
            subtitle: _('Display project badge on task items (e.g. #Eat the frog)'),
        });
        settings.bind('show-task-project', showProjectRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        taskDisplayGroup.add(showProjectRow);

        const showOverdueDaysRow = new Adw.SwitchRow({
            title: _('Show Overdue Days Count'),
            subtitle: _('Display whether tasks are overdue and by how many days (e.g. "Overdue by 3 days")'),
        });
        settings.bind('show-overdue-days', showOverdueDaysRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        taskDisplayGroup.add(showOverdueDaysRow);

        const sortModel = new Gtk.StringList();
        sortModel.append(_('Newest First (Added tasks stay at top)'));
        sortModel.append(_('Todoist Default Order'));
        sortModel.append(_('Priority (Urgent First)'));

        const sortValues = ['newest-first', 'todoist', 'priority'];
        const currentSort = settings.get_string('task-sort-order') || 'newest-first';
        let currentIdx = sortValues.indexOf(currentSort);
        if (currentIdx === -1) currentIdx = 0;

        const sortRow = new Adw.ComboRow({
            title: _('Task Sort Order'),
            subtitle: _('Controls the order of tasks in the list'),
            model: sortModel,
            selected: currentIdx,
        });
        sortRow.connect('notify::selected', () => {
            const val = sortValues[sortRow.selected] || 'newest-first';
            settings.set_string('task-sort-order', val);
        });
        taskDisplayGroup.add(sortRow);

        // 4. Synchronization & Filter
        const syncGroup = new Adw.PreferencesGroup({
            title: _('Sync & Filter'),
            description: _('Task retrieval frequency and query filters.'),
        });
        page.add(syncGroup);

        const intervalRow = new Adw.SpinRow({
            title: _('Auto-Refresh Interval (Minutes)'),
            subtitle: _('How often to fetch your latest tasks from Todoist in the background'),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 60,
                step_increment: 1,
                page_increment: 5,
                value: settings.get_int('sync-interval'),
            }),
        });
        settings.bind('sync-interval', intervalRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        syncGroup.add(intervalRow);

        const filterRow = new Adw.EntryRow({
            title: _('Todoist Filter Query'),
        });
        settings.bind('filter-query', filterRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        syncGroup.add(filterRow);
    }
}
