/**
 * todoistApi.js
 * Todoist API v1 client using Soup 3.0 for GNOME Shell extensions.
 */

import Soup from 'gi://Soup?version=3.0';
import GLib from 'gi://GLib';

const BASE_URL = 'https://api.todoist.com/api/v1';

export class TodoistClient {
    constructor() {
        this._session = new Soup.Session();
        this._session.timeout = 15;
    }

    /**
     * Helper to perform an asynchronous HTTP request using Soup 3.0 and Promises.
     * @private
     */
    _request(method, endpoint, token, bodyData = null) {
        return new Promise((resolve, reject) => {
            if (!token || !token.trim()) {
                reject(new Error('Todoist API token is missing. Please set it in preferences.'));
                return;
            }

            const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
            const message = Soup.Message.new(method, url);
            if (!message) {
                reject(new Error(`Failed to create HTTP request for ${url}`));
                return;
            }

            message.request_headers.append('Authorization', `Bearer ${token.trim()}`);

            if (bodyData !== null) {
                const jsonStr = JSON.stringify(bodyData);
                const bytes = GLib.Bytes.new(new TextEncoder().encode(jsonStr));
                message.set_request_body_from_bytes('application/json', bytes);
            }

            this._session.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                null,
                (session, res) => {
                    try {
                        const responseBytes = session.send_and_read_finish(res);
                        const status = message.get_status();

                        if (status === 204) {
                            // 204 No Content (e.g. task close/reopen)
                            resolve(null);
                            return;
                        }

                        let text = '';
                        if (responseBytes) {
                            text = new TextDecoder('utf-8').decode(responseBytes.get_data());
                        }

                        if (status >= 200 && status < 300) {
                            try {
                                const data = text ? JSON.parse(text) : null;
                                resolve(data);
                            } catch (parseErr) {
                                reject(new Error(`Failed to parse Todoist response: ${parseErr.message}`));
                            }
                        } else if (status === 401) {
                            reject(new Error('Invalid Todoist API token (401 Unauthorized)'));
                        } else if (status === 403) {
                            reject(new Error('Access forbidden. Check your Todoist permissions.'));
                        } else if (status === 429) {
                            reject(new Error('Todoist rate limit reached. Please wait a moment.'));
                        } else {
                            let errorMsg = text || `HTTP status ${status}`;
                            if (text) {
                                try {
                                    const parsedError = JSON.parse(text);
                                    errorMsg = parsedError.error || parsedError.message || text;
                                } catch (_) {
                                    // keep raw text if not valid JSON
                                }
                            }
                            reject(new Error(`Todoist API error: ${errorMsg}`));
                        }
                    } catch (err) {
                        reject(err);
                    }
                }
            );
        });
    }

    /**
     * Fetch tasks filtered by query (default: 'today | overdue').
     * @param {string} token
     * @param {string} filterQuery
     * @returns {Promise<Array>}
     */
    async fetchTasks(token, filterQuery = 'today | overdue') {
        const trimmedFilter = (filterQuery || '').trim();
        const endpoint = trimmedFilter
            ? `/tasks/filter?query=${encodeURIComponent(trimmedFilter)}`
            : '/tasks';
        const response = await this._request('GET', endpoint, token);
        if (response && Array.isArray(response.results)) {
            return response.results;
        }
        return Array.isArray(response) ? response : [];
    }

    /**
     * Fetch all projects to resolve project names/colors for tasks.
     * @param {string} token
     * @returns {Promise<Array>}
     */
    async fetchProjects(token) {
        try {
            const response = await this._request('GET', '/projects', token);
            if (response && Array.isArray(response.results)) {
                return response.results;
            }
            return Array.isArray(response) ? response : [];
        } catch (e) {
            console.error(`[QuickTasksTodoist] Fetch projects failed: ${e.message}`);
            return [];
        }
    }

    /**
     * Create a new task (e.g. for today).
     * @param {string} token
     * @param {Object} taskData
     * @param {string} taskData.content - Task title/content
     * @param {string} [taskData.due_string] - e.g. "today"
     * @param {string} [taskData.description]
     * @param {number} [taskData.priority] - 1 to 4
     * @returns {Promise<Object>}
     */
    async createTask(token, { content, due_string = 'today', description = '', priority = 1 }) {
        const payload = {
            content: content.trim(),
            due_string: due_string,
        };
        if (description) {
            payload.description = description.trim();
        }
        if (priority && priority >= 1 && priority <= 4) {
            payload.priority = priority;
        }
        return this._request('POST', '/tasks', token, payload);
    }

    /**
     * Mark a task as completed (close task).
     * @param {string} token
     * @param {string} taskId
     * @returns {Promise<void>}
     */
    async closeTask(token, taskId) {
        return this._request('POST', `/tasks/${encodeURIComponent(taskId)}/close`, token);
    }

    /**
     * Reopen a completed task.
     * @param {string} token
     * @param {string} taskId
     * @returns {Promise<void>}
     */
    async reopenTask(token, taskId) {
        return this._request('POST', `/tasks/${encodeURIComponent(taskId)}/reopen`, token);
    }

    /**
     * Validate token by requesting user info or projects.
     * @param {string} token
     * @returns {Promise<boolean>}
     */
    async validateToken(token) {
        try {
            await this._request('GET', '/projects', token);
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Abort any pending HTTP requests when extension is disabled.
     */
    abort() {
        if (this._session) {
            this._session.abort();
        }
    }
}
