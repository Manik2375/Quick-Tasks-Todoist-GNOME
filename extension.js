/* extension.js
 *
 * Quick Tasks for Todoist GNOME Shell Extension
 * Connects to Todoist REST API v2 using Soup 3.0.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {TodoistClient} from './todoistApi.js';

const TODOIST_COLORS = {
    berry_red: '#b8256f',
    red: '#db4035',
    orange: '#ff9933',
    yellow: '#fad000',
    olive_green: '#afb83b',
    lime_green: '#7ecc49',
    green: '#299438',
    mint_green: '#6accbc',
    teal: '#158fad',
    sky_blue: '#14aaf5',
    light_blue: '#96c3eb',
    blue: '#4073ff',
    grape: '#884dff',
    violet: '#af38eb',
    lavender: '#eb96eb',
    magenta: '#e05194',
    salmon: '#ff8d85',
    charcoal: '#808080',
    grey: '#b8b8b8',
    taupe: '#ccac93',
};

const QuickTasksIndicator = GObject.registerClass(
class QuickTasksIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, _('Quick Tasks for Todoist'), false);

        this._extension = extension;
        this._settings = extension.getSettings();
        this._client = new TodoistClient();

        this._tasks = [];
        this._projectsMap = new Map();
        this._currentTask = null;
        this._syncTimerId = null;
        this._isLoading = false;
        this._lastSyncTime = null;
        this._idleSources = [];

        // Build Top Bar Panel Indicator
        this._buildPanelWidget();

        // Build Popup Menu UI
        this._buildMenu();

        // Settings Signal Connections
        this._settingsSignals = [
            this._settings.connect('changed::api-token', () => this._onSettingsChanged(true)),
            this._settings.connect('changed::sync-interval', () => this._setupSyncTimer()),
            this._settings.connect('changed::show-current-task-in-panel', () => this._updatePanelDisplay()),
            this._settings.connect('changed::max-panel-task-length', () => this._updatePanelDisplay()),
            this._settings.connect('changed::filter-query', () => this._syncTasks()),
            this._settings.connect('changed::show-task-labels', () => this._renderTaskList()),
            this._settings.connect('changed::show-task-project', () => this._renderTaskList()),
            this._settings.connect('changed::show-due-dates', () => this._renderTaskList()),
            this._settings.connect('changed::show-overdue-days', () => this._renderTaskList()),
            this._settings.connect('changed::task-sort-order', () => {
                this._tasks = this._sortTasks(this._tasks);
                this._renderTaskList();
            }),
        ];

        // Fetch tasks when menu opens
        this._menuOpenSignal = this.menu.connect('open-state-changed', (menu, isOpen) => {
            if (isOpen) {
                this._syncTasks();
            }
        });

        // Setup background sync timer and initial fetch
        this._setupSyncTimer();
        this._syncTasks();
    }

    /* =========================================================================
     * Top Bar Panel Widget
     * ========================================================================= */
    _buildPanelWidget() {
        this._panelBox = new St.BoxLayout({
            style_class: 'quick-tasks-panel-box',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
        });

        this._panelIcon = new St.Icon({
            icon_name: 'checkbox-checked-symbolic',
            style_class: 'system-status-icon quick-tasks-panel-icon',
        });
        this._panelBox.add_child(this._panelIcon);

        this._panelLabel = new St.Label({
            text: '',
            style_class: 'quick-tasks-panel-label',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this._panelBox.add_child(this._panelLabel);

        this._panelBadge = new St.Label({
            text: '',
            style_class: 'quick-tasks-panel-badge',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this._panelBox.add_child(this._panelBadge);

        this.add_child(this._panelBox);
    }

    _updatePanelDisplay() {
        const token = this._settings.get_string('api-token');
        if (!token) {
            this._panelLabel.visible = false;
            this._panelBadge.visible = false;
            return;
        }

        const showCurrent = this._settings.get_boolean('show-current-task-in-panel');
        const maxLen = this._settings.get_int('max-panel-task-length') || 28;

        if (showCurrent && this._currentTask) {
            let title = this._currentTask.content || '';
            if (title.length > maxLen) {
                title = title.substring(0, maxLen - 1) + '…';
            }
            this._panelLabel.set_text(title);
            this._panelLabel.visible = true;
        } else {
            this._panelLabel.visible = false;
        }

        // Count of pending tasks
        const count = this._tasks.length;
        if (count > 0) {
            this._panelBadge.set_text(`${count}`);
            this._panelBadge.visible = true;
        } else {
            this._panelBadge.visible = false;
        }
    }

    /* =========================================================================
     * Dropdown Menu Layout
     * ========================================================================= */
    _buildMenu() {
        // Main container menu item (prevents closing on internal interactions)
        this._mainMenuItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'quick-tasks-menu-item-base',
        });

        this._menuBox = new St.BoxLayout({
            vertical: true,
            style_class: 'quick-tasks-menu-box',
            x_expand: true,
        });


        // 2. Quick Add Task Input
        this._addBox = new St.BoxLayout({
            style_class: 'quick-tasks-add-box',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._addEntry = new St.Entry({
            hint_text: _('Add a task for today… (Press Enter)'),
            style_class: 'quick-tasks-entry',
            x_expand: true,
            can_focus: true,
        });
        this._addEntry.clutter_text.connect('key-press-event', (actor, event) => {
            const symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                this._onAddTask();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this._addBox.add_child(this._addEntry);

        this._addBtn = new St.Button({
            style_class: 'quick-tasks-add-btn',
            child: new St.Icon({
                icon_name: 'list-add-symbolic',
                icon_size: 16,
            }),
            can_focus: true,
        });
        this._addBtn.connect('clicked', () => this._onAddTask());
        this._addBox.add_child(this._addBtn);
        this._menuBox.add_child(this._addBox);

        // 3. Section Title
        this._listTitle = new St.Label({
            text: _("TODAY'S TASKS"),
            style_class: 'quick-tasks-section-title',
        });
        this._menuBox.add_child(this._listTitle);

        // 4. Scrollable Task List
        this._scrollView = new St.ScrollView({
            style_class: 'quick-tasks-scroll-view',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
        });

        this._taskListContainer = new St.BoxLayout({
            vertical: true,
            style_class: 'quick-tasks-list-container',
            x_expand: true,
        });
        this._scrollView.add_child(this._taskListContainer);
        this._menuBox.add_child(this._scrollView);

        // 5. Empty / Connect Container (shown when needed)
        this._emptyContainer = new St.BoxLayout({
            vertical: true,
            style_class: 'quick-tasks-empty-state',
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            visible: false,
        });
        this._menuBox.add_child(this._emptyContainer);

        // 6. Separator
        const separator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._mainMenuItem);
        this._mainMenuItem.add_child(this._menuBox);
        this.menu.addMenuItem(separator);

        // 7. Footer Action Bar
        this._buildFooter();

        // Render initial empty / connect state
        this._renderViews();
    }

    _buildFooter() {
        this._footerItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });

        const footerBox = new St.BoxLayout({
            style_class: 'quick-tasks-footer-box',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._statusLabel = new St.Label({
            text: _('Ready'),
            style_class: 'quick-tasks-status-label',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        footerBox.add_child(this._statusLabel);

        // Refresh Button
        const refreshBtn = new St.Button({
            style_class: 'quick-tasks-icon-button',
            child: new St.Icon({
                icon_name: 'view-refresh-symbolic',
                icon_size: 14,
            }),
            can_focus: true,
        });
        refreshBtn.connect('clicked', () => this._syncTasks(true));
        footerBox.add_child(refreshBtn);

        // Open Web Todoist Button
        const webBtn = new St.Button({
            style_class: 'quick-tasks-icon-button',
            child: new St.Icon({
                icon_name: 'web-browser-symbolic',
                icon_size: 14,
            }),
            can_focus: true,
        });
        webBtn.connect('clicked', () => {
            this.menu.close();
            Gio.AppInfo.launch_default_for_uri('https://todoist.com/app/today', null);
        });
        footerBox.add_child(webBtn);

        // Extension Settings Button
        const settingsBtn = new St.Button({
            style_class: 'quick-tasks-icon-button',
            child: new St.Icon({
                icon_name: 'emblem-system-symbolic',
                icon_size: 14,
            }),
            can_focus: true,
        });
        settingsBtn.connect('clicked', () => {
            this.menu.close();
            this._extension.openPreferences();
        });
        footerBox.add_child(settingsBtn);

        this._footerItem.add_child(footerBox);
        this.menu.addMenuItem(this._footerItem);
    }

    /* =========================================================================
     * Rendering UI Views
     * ========================================================================= */
    _renderViews() {
        const token = this._settings.get_string('api-token');

        if (!token) {
            this._renderConnectPrompt();
            this._updatePanelDisplay();
            return;
        }

        this._emptyContainer.visible = false;
        this._addBox.visible = true;
        this._listTitle.visible = true;
        this._scrollView.visible = true;

        this._renderTaskList();
        this._updatePanelDisplay();
    }

    _renderConnectPrompt() {
        this._addBox.visible = false;
        this._listTitle.visible = false;
        this._scrollView.visible = false;

        this._emptyContainer.destroy_all_children();
        this._emptyContainer.visible = true;

        const icon = new St.Icon({
            icon_name: 'dialog-password-symbolic',
            style_class: 'quick-tasks-empty-icon',
        });
        this._emptyContainer.add_child(icon);

        const title = new St.Label({
            text: _('Connect to Todoist'),
            style_class: 'quick-tasks-empty-title',
        });
        this._emptyContainer.add_child(title);

        const desc = new St.Label({
            text: _('Add your Todoist API token in settings to see today’s tasks and manage your work from GNOME.'),
            style_class: 'quick-tasks-empty-subtitle',
        });
        desc.clutter_text.set_line_wrap(true);
        this._emptyContainer.add_child(desc);

        const btn = new St.Button({
            label: _('Open Settings'),
            style_class: 'quick-tasks-action-btn',
            can_focus: true,
        });
        btn.connect('clicked', () => {
            this.menu.close();
            this._extension.openPreferences();
        });
        this._emptyContainer.add_child(btn);
    }

    _renderTaskList(animateTaskId = null) {
        this._taskListContainer.destroy_all_children();

        if (this._listTitle) {
            this._listTitle.set_text(
                this._tasks.length > 0
                    ? `${_("TODAY'S TASKS")} (${this._tasks.length})`
                    : _("TODAY'S TASKS")
            );
        }

        if (this._tasks.length === 0) {
            const emptyBox = new St.BoxLayout({
                vertical: true,
                style_class: 'quick-tasks-empty-list-box',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            const emptyIcon = new St.Icon({
                icon_name: 'emblem-default-symbolic',
                icon_size: 24,
                style_class: 'quick-tasks-empty-list-icon',
            });
            emptyBox.add_child(emptyIcon);
            const emptyLabel = new St.Label({
                text: _('🎉 All caught up for today! Add a task above.'),
                style_class: 'quick-tasks-status-label',
                style: 'padding: 8px 6px; text-align: center;',
            });
            emptyBox.add_child(emptyLabel);
            this._taskListContainer.add_child(emptyBox);
            return;
        }

        const showTaskLabels = this._settings.get_boolean('show-task-labels');

        this._tasks.forEach(task => {
            const isCurrent = this._currentTask && this._currentTask.id === task.id;
            const isNew = animateTaskId && task.id === animateTaskId;

            const row = new St.BoxLayout({
                style_class: isCurrent ? 'quick-tasks-item-row quick-tasks-item-row-active' : 'quick-tasks-item-row',
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                reactive: true,
                can_focus: true,
                track_hover: true,
            });

            // Smooth drop-in animation for newly added tasks
            if (isNew) {
                row.opacity = 0;
                row.translation_y = -14;
                const idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    const idx = this._idleSources.indexOf(idleId);
                    if (idx !== -1) {
                        this._idleSources.splice(idx, 1);
                    }
                    if (!row) return GLib.SOURCE_REMOVE;
                    row.ease({
                        opacity: 255,
                        translation_y: 0,
                        duration: 350,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });
                    return GLib.SOURCE_REMOVE;
                });
                this._idleSources.push(idleId);
            }

            // Circular Checkbox button (clicking completes the task)
            const checkBtn = new St.Button({
                style_class: `quick-tasks-checkbox-btn quick-tasks-priority-${task.priority || 1}`,
                can_focus: true,
                y_align: Clutter.ActorAlign.CENTER,
                x_align: Clutter.ActorAlign.CENTER,
            });

            const checkIcon = new St.Icon({
                icon_name: 'object-select-symbolic',
                icon_size: 10,
                style_class: 'quick-tasks-checkbox-icon',
                visible: false,
            });
            checkBtn.set_child(checkIcon);

            // Hover preview of checkmark inside circular checkbox
            checkBtn.connect('notify::hover', () => {
                if (!checkBtn._completed) {
                    checkIcon.visible = checkBtn.hover;
                }
            });

            // Task content & metadata
            const contentBox = new St.BoxLayout({
                vertical: true,
                style_class: 'quick-tasks-item-content-box',
                x_expand: true,
                reactive: true,
            });

            const title = new St.Label({
                text: task.content || '',
                style_class: 'quick-tasks-item-title',
            });
            title.clutter_text.set_line_wrap(true);
            contentBox.add_child(title);

            // Metadata row: Due date, Project badge, Task labels
            const dueInfo = this._getDueInfo(task.due);
            const showTaskProject = this._settings.get_boolean('show-task-project');
            let projectChip = null;
            if (showTaskProject && task.project_id && this._projectsMap.has(task.project_id)) {
                const project = this._projectsMap.get(task.project_id);
                if (project && !project.isInbox) {
                    projectChip = new St.Label({
                        text: `#${project.name}`,
                        style_class: 'quick-tasks-project-chip',
                        y_align: Clutter.ActorAlign.CENTER,
                        style: `color: ${project.color}; background-color: ${project.color}25;`,
                    });
                }
            }

            let labelsBox = null;
            if (showTaskLabels && Array.isArray(task.labels) && task.labels.length > 0) {
                labelsBox = new St.BoxLayout({
                    style_class: 'quick-tasks-labels-box',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                task.labels.forEach(labelName => {
                    const labelChip = new St.Label({
                        text: `@${labelName}`,
                        style_class: 'quick-tasks-label-chip',
                        y_align: Clutter.ActorAlign.CENTER,
                    });
                    labelsBox.add_child(labelChip);
                });
            }

            if (dueInfo || projectChip || (labelsBox && labelsBox.get_n_children() > 0)) {
                const metaBox = new St.BoxLayout({
                    style_class: 'quick-tasks-item-meta-box',
                    y_align: Clutter.ActorAlign.CENTER,
                });

                if (dueInfo) {
                    const dueLabel = new St.Label({
                        text: dueInfo.text,
                        style_class: dueInfo.isOverdue
                            ? 'quick-tasks-item-due quick-tasks-item-due-overdue'
                            : 'quick-tasks-item-due',
                        y_align: Clutter.ActorAlign.CENTER,
                    });
                    metaBox.add_child(dueLabel);
                }

                if (projectChip) {
                    metaBox.add_child(projectChip);
                }

                if (labelsBox) {
                    metaBox.add_child(labelsBox);
                }

                contentBox.add_child(metaBox);
            }

            // Click checkbox -> Complete task with animation
            checkBtn.connect('clicked', () => {
                if (checkBtn._completed) return;
                checkBtn._completed = true;
                this._onCompleteTask(task.id, row, checkBtn, checkIcon, title);
            });

            // Click row / content -> Set as top-bar active task
            contentBox.connect('button-press-event', (actor, event) => {
                if (event.get_button() === 1) {
                    this._setCurrentTask(task);
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

            row.add_child(checkBtn);
            row.add_child(contentBox);

            // Make Current / Focus star button
            const pinBtn = new St.Button({
                style_class: isCurrent ? 'quick-tasks-item-pin-btn quick-tasks-item-pin-btn-active' : 'quick-tasks-item-pin-btn',
                child: new St.Icon({
                    icon_name: isCurrent ? 'starred-symbolic' : 'non-starred-symbolic',
                    icon_size: 14,
                }),
                can_focus: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            pinBtn.connect('clicked', () => {
                this._setCurrentTask(task);
            });
            row.add_child(pinBtn);

            this._taskListContainer.add_child(row);
        });
    }

    _getDueInfo(dueObj) {
        if (!dueObj) return null;

        const showDueDates = this._settings.get_boolean('show-due-dates');
        if (!showDueDates) return null;

        const showOverdueDays = this._settings.get_boolean('show-overdue-days');
        const dueDateStr = dueObj.date;
        const isRecurring = dueObj.is_recurring;

        if (!dueDateStr) {
            return {
                text: dueObj.string || '',
                isOverdue: false,
            };
        }

        try {
            const datePart = dueDateStr.substring(0, 10);
            const now = GLib.DateTime.new_now_local();
            const todayStr = now.format('%Y-%m-%d');

            if (datePart === todayStr) {
                return {
                    text: dueObj.string || _('Today'),
                    isOverdue: false,
                };
            }

            const [y, m, d] = datePart.split('-').map(Number);
            const dueDt = GLib.DateTime.new_local(y, m, d, 0, 0, 0);
            const todayDt = GLib.DateTime.new_local(now.get_year(), now.get_month(), now.get_day_of_month(), 0, 0, 0);

            // diffSpan in microseconds (positive if due date is before today)
            const diffSpan = todayDt.difference(dueDt);
            const diffDays = Math.floor(diffSpan / (1000 * 1000 * 60 * 60 * 24));

            if (diffDays > 0) {
                let text;
                const recSuffix = isRecurring && dueObj.string ? ` (${dueObj.string})` : '';
                if (showOverdueDays) {
                    const daysText = diffDays === 1
                        ? _('Overdue by 1 day')
                        : _(`Overdue by ${diffDays} days`);
                    text = `${daysText}${recSuffix}`;
                } else {
                    text = dueObj.string ? _(`Overdue: ${dueObj.string}`) : _('Overdue');
                }
                return {
                    text,
                    isOverdue: true,
                };
            }

            return {
                text: dueObj.string || datePart,
                isOverdue: false,
            };
        } catch (e) {
            return {
                text: dueObj.string || '',
                isOverdue: false,
            };
        }
    }

    _isTaskOverdue(dueDateStr) {
        if (!dueDateStr) return false;
        try {
            const todayStr = GLib.DateTime.new_now_local().format('%Y-%m-%d');
            return dueDateStr < todayStr;
        } catch (e) {
            return false;
        }
    }

    _setCurrentTask(task) {
        this._currentTask = task;
        if (task && task.id) {
            this._settings.set_string('current-task-id', task.id);
        } else {
            this._settings.set_string('current-task-id', '');
        }
        this._renderViews();
    }

    _sortTasks(tasksList) {
        if (!Array.isArray(tasksList)) return [];

        const sortOrder = this._settings.get_string('task-sort-order') || 'newest-first';
        const now = GLib.DateTime.new_now_local();
        const todayStr = now.format('%Y-%m-%d');

        const isOverdue = t => {
            if (!t.due || !t.due.date) return false;
            return t.due.date.substring(0, 10) < todayStr;
        };

        return [...tasksList].sort((a, b) => {
            const aOverdue = isOverdue(a);
            const bOverdue = isOverdue(b);

            // Overdue tasks always appear before today's tasks
            if (aOverdue && !bOverdue) return -1;
            if (!aOverdue && bOverdue) return 1;

            if (sortOrder === 'priority') {
                return (b.priority || 1) - (a.priority || 1);
            }

            if (sortOrder === 'newest-first') {
                const aTime = a.added_at || a.created_at || '';
                const bTime = b.added_at || b.created_at || '';
                if (aTime && bTime) {
                    return bTime.localeCompare(aTime);
                }
            }

            // Default: preserve server order (child_order)
            return (a.child_order ?? 0) - (b.child_order ?? 0);
        });
    }

    /* =========================================================================
     * Data Operations: Sync, Add, Complete
     * ========================================================================= */
    async _syncTasks(showFeedback = false) {
        const token = this._settings.get_string('api-token');
        if (!token) {
            this._renderViews();
            return;
        }

        if (this._isLoading) return;
        this._isLoading = true;

        if (showFeedback) {
            this._statusLabel.set_text(_('Syncing…'));
        }

        try {
            const filter = this._settings.get_string('filter-query') || 'today | overdue';
            const [tasks, projects] = await Promise.all([
                this._client.fetchTasks(token, filter),
                this._client.fetchProjects(token),
            ]);

            if (Array.isArray(projects)) {
                this._projectsMap.clear();
                projects.forEach(p => {
                    this._projectsMap.set(p.id, {
                        name: p.name,
                        color: TODOIST_COLORS[p.color] || '#78aeed',
                        isInbox: !!p.inbox_project,
                    });
                });
            }

            const rawTasks = Array.isArray(tasks) ? tasks : [];
            this._tasks = this._sortTasks(rawTasks);

            // Restore or pick current task
            const savedTaskId = this._settings.get_string('current-task-id');
            const foundSaved = this._tasks.find(t => t.id === savedTaskId);

            if (foundSaved) {
                this._currentTask = foundSaved;
            } else if (this._tasks.length > 0) {
                this._currentTask = this._tasks[0];
                this._settings.set_string('current-task-id', this._currentTask.id);
            } else {
                this._currentTask = null;
                this._settings.set_string('current-task-id', '');
            }

            if (!this._settings || !this._client) return;

            const now = GLib.DateTime.new_now_local();
            this._lastSyncTime = now.format('%H:%M');
            this._statusLabel.set_text(_(`Synced at ${this._lastSyncTime}`));

            this._renderViews();
        } catch (err) {
            console.error(`[QuickTasksTodoist] Sync error: ${err.message}`);
            this._statusLabel.set_text(_('Sync failed'));
            if (showFeedback) {
                Main.notifyError(_('Todoist Sync Error'), err.message);
            }
        } finally {
            this._isLoading = false;
        }
    }

    async _onAddTask() {
        const text = this._addEntry.get_text().trim();
        if (!text) return;

        const token = this._settings.get_string('api-token');
        if (!token) {
            this._extension.openPreferences();
            return;
        }

        this._addBtn.reactive = false;
        this._statusLabel.set_text(_('Adding task…'));

        try {
            const newTask = await this._client.createTask(token, {
                content: text,
                due_string: 'today',
            });

            this._addEntry.set_text('');

            // Assign current timestamp if missing from API response so sorting is accurate
            if (!newTask.added_at) {
                newTask.added_at = new Date().toISOString();
            }

            // Insert new task according to the selected sort order
            const sortOrder = this._settings.get_string('task-sort-order') || 'newest-first';
            if (sortOrder === 'todoist') {
                this._tasks.push(newTask);
            } else {
                // For newest-first: insert at top of today's tasks (below any overdue tasks)
                const now = GLib.DateTime.new_now_local();
                const todayStr = now.format('%Y-%m-%d');
                const firstNonOverdueIndex = this._tasks.findIndex(t => {
                    if (!t.due || !t.due.date) return true;
                    return t.due.date.substring(0, 10) >= todayStr;
                });

                if (firstNonOverdueIndex === -1) {
                    this._tasks.unshift(newTask);
                } else {
                    this._tasks.splice(firstNonOverdueIndex, 0, newTask);
                }
            }

            if (!this._currentTask) {
                this._currentTask = newTask;
                this._settings.set_string('current-task-id', newTask.id);
            }

            // Animate newly added task smoothly into the list
            this._renderTaskList(newTask.id);
            this._updatePanelDisplay();
            this._statusLabel.set_text(_('Task added!'));

            // Refresh in background without changing position
            this._syncTasks();
        } catch (err) {
            console.error(`[QuickTasksTodoist] Create task error: ${err.message}`);
            Main.notifyError(_('Failed to add task'), err.message);
            this._statusLabel.set_text(_('Error adding task'));
        } finally {
            this._addBtn.reactive = true;
        }
    }

    async _onCompleteTask(taskId, visualRow = null, checkBtn = null, checkIcon = null, titleLabel = null) {
        const token = this._settings.get_string('api-token');
        if (!token || !taskId) return;

        // Visual completion feedback immediately
        if (visualRow) {
            visualRow.reactive = false;
            if (checkBtn) {
                checkBtn.add_style_class_name('quick-tasks-checkbox-completed');
                if (checkIcon) checkIcon.visible = true;
            }
            if (titleLabel) {
                titleLabel.add_style_class_name('quick-tasks-item-title-completed');
            }

            // Animate row: slide slightly right and fade out smoothly
            visualRow.ease({
                opacity: 0,
                translation_x: 20,
                duration: 250,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    visualRow.destroy();
                    if (this._tasks.length === 0) {
                        this._renderTaskList();
                    }
                },
            });
        }

        // Optimistic UI update: Remove task from list immediately
        this._tasks = this._tasks.filter(t => t.id !== taskId);

        // If the completed task was the ongoing task, advance to next
        if (this._currentTask && this._currentTask.id === taskId) {
            this._currentTask = this._tasks.length > 0 ? this._tasks[0] : null;
            this._settings.set_string('current-task-id', this._currentTask ? this._currentTask.id : '');
        }

        this._updatePanelDisplay();
        if (this._listTitle) {
            this._listTitle.set_text(
                this._tasks.length > 0
                    ? `${_("TODAY'S TASKS")} (${this._tasks.length})`
                    : _("TODAY'S TASKS")
            );
        }

        if (!visualRow) {
            this._renderViews();
        }

        this._statusLabel.set_text(_('Completing task…'));

        try {
            await this._client.closeTask(token, taskId);
            this._statusLabel.set_text(_('Task completed!'));
            // Re-sync in background to confirm server state
            this._syncTasks();
        } catch (err) {
            console.error(`[QuickTasksTodoist] Complete task error: ${err.message}`);
            Main.notifyError(_('Failed to complete task'), err.message);
            this._syncTasks();
        }
    }

    /* =========================================================================
     * Timers & Lifecycle
     * ========================================================================= */
    _setupSyncTimer() {
        if (this._syncTimerId) {
            GLib.Source.remove(this._syncTimerId);
            this._syncTimerId = null;
        }

        let intervalMins = this._settings.get_int('sync-interval');
        if (!intervalMins || intervalMins < 1) {
            intervalMins = 5;
        }

        this._syncTimerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            intervalMins * 60,
            () => {
                this._syncTasks();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _onSettingsChanged(isTokenChange = false) {
        if (isTokenChange) {
            this._syncTasks(true);
        } else {
            this._updatePanelDisplay();
        }
    }

    destroy() {
        if (this._syncTimerId) {
            GLib.Source.remove(this._syncTimerId);
            this._syncTimerId = null;
        }

        if (this._idleSources) {
            this._idleSources.forEach(id => GLib.Source.remove(id));
            this._idleSources = [];
        }

        if (this._menuOpenSignal) {
            this.menu.disconnect(this._menuOpenSignal);
            this._menuOpenSignal = null;
        }

        if (this._settingsSignals) {
            this._settingsSignals.forEach(id => this._settings.disconnect(id));
            this._settingsSignals = [];
        }

        if (this._client) {
            this._client.abort();
            this._client = null;
        }

        this._settings = null;
        this._extension = null;

        super.destroy();
    }
});

export default class QuickTasksExtension extends Extension {
    enable() {
        this._indicator = new QuickTasksIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
