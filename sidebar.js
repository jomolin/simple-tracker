// ======================
// SIMPLE STUDENT TRACKER — SIDEBAR
// ======================
// UI only. All selection and marking logic lives in background.js.

let state = {
    students: [],
    currentStudent: null,
    sessionPool: [],
    absentToday: [],
    groupFilter: 'all',
    eventLog: []
};

// ======================
// UTILITIES
// ======================

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function todayISO() {
    return new Date().toISOString().split('T')[0];
}

function callsToday() {
    const today = todayISO();
    return state.eventLog.filter(e => e.timestamp.startsWith(today)).length;
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ======================
// DATA LOADING
// ======================

function loadData() {
    chrome.storage.local.get(
        ['students', 'currentStudent', 'sessionPool', 'absentToday', 'groupFilter', 'eventLog'],
        (result) => {
            state.students = result.students || [];
            state.currentStudent = result.currentStudent || null;
            state.sessionPool = result.sessionPool || [];
            state.absentToday = result.absentToday || [];
            state.groupFilter = result.groupFilter || 'all';
            state.eventLog = result.eventLog || [];
            renderAll();
        }
    );
}

function saveStudents() {
    chrome.storage.local.set({ students: state.students });
}

// ======================
// RENDERING
// ======================

function renderAll() {
    renderCurrentStudent();
    renderFilterBadge();
    renderInfoCards();
    renderStudentList();
    renderSummaryList();
    renderEventLog();
}

function renderCurrentStudent() {
    const display = document.getElementById('current-display');
    if (state.currentStudent) {
        const fresh = state.students.find(s => s.id === state.currentStudent.id) || state.currentStudent;
        const total = (fresh.correct || 0) + (fresh.incorrect || 0);
        const accuracy = total > 0 ? Math.round((fresh.correct / total) * 100) : 0;
        const groupLabel = state.currentStudent.group ? `${escapeHtml(state.currentStudent.group)} · ` : '';
        display.innerHTML = `
            <div class="current-name">${escapeHtml(state.currentStudent.name)}</div>
            <div style="font-size: 0.85rem; margin-top: 0.4rem; color: var(--accent-secondary);">
                ${groupLabel}${fresh.timesCalled || 0} calls · ${accuracy}% accuracy
            </div>
        `;
        document.getElementById('btn-incorrect').disabled = false;
        document.getElementById('btn-absent').disabled = false;
    } else {
        display.innerHTML = `<div class="current-placeholder">Press <strong>Alt+Shift+S</strong> to pick a student</div>`;
        document.getElementById('btn-incorrect').disabled = true;
        document.getElementById('btn-absent').disabled = true;
    }
}

function renderFilterBadge() {
    document.getElementById('filter-badge').textContent =
        state.groupFilter && state.groupFilter !== 'all' ? `${state.groupFilter} only` : 'All students';
}

function renderInfoCards() {
    // Eligible students (matching filter, not absent)
    let eligible = state.students;
    if (state.groupFilter !== 'all') {
        eligible = eligible.filter(s => s.group === state.groupFilter);
    }
    eligible = eligible.filter(s => !state.absentToday.includes(s.id));

    // Pool remaining = how many in current shuffled queue still eligible
    const eligibleIds = new Set(eligible.map(s => s.id));
    const poolRemaining = state.sessionPool.filter(id => eligibleIds.has(id)).length;

    document.getElementById('pool-remaining').textContent =
        poolRemaining > 0 ? poolRemaining : eligible.length;
    document.getElementById('calls-today').textContent = callsToday();
    document.getElementById('absent-count').textContent = state.absentToday.length;
}

function renderStudentList() {
    const list = document.getElementById('student-list');
    if (state.students.length === 0) {
        list.innerHTML = '<div class="empty-state">No students yet. Import a CSV or click ＋ Add student.</div>';
        return;
    }
    // Sort by group, then name
    const sorted = [...state.students].sort((a, b) => {
        const groupCompare = (a.group || '').localeCompare(b.group || '');
        if (groupCompare !== 0) return groupCompare;
        return a.name.localeCompare(b.name);
    });

    list.innerHTML = sorted.map(s => {
        if (s.id === editingStudentId) {
            // Split name back into first/last for editing
            const parts = s.name.trim().split(/\s+/);
            const firstname = parts.slice(0, -1).join(' ') || parts[0] || '';
            const lastname = parts.length > 1 ? parts[parts.length - 1] : '';
            return `
                <div class="student-row manage editing">
                    <div class="inline-form-row">
                        <input type="text" id="edit-firstname" value="${escapeHtml(firstname)}" placeholder="First name" autocomplete="off">
                        <input type="text" id="edit-lastname" value="${escapeHtml(lastname)}" placeholder="Last name" autocomplete="off">
                        <input type="text" id="edit-group" value="${escapeHtml(s.group || '')}" placeholder="Group (optional)" autocomplete="off">
                    </div>
                    <div class="inline-form-actions">
                        <button class="success" data-action="save-edit" data-id="${s.id}">✓ Save</button>
                        <button class="secondary" data-action="cancel-edit">✕ Cancel</button>
                    </div>
                </div>
            `;
        }

        const isAbsent = state.absentToday.includes(s.id);
        const total = (s.correct || 0) + (s.incorrect || 0);
        const accuracy = total > 0 ? Math.round((s.correct / total) * 100) : 0;
        const groupLabel = s.group ? `${escapeHtml(s.group)} · ` : '';
        return `
            <div class="student-row manage ${isAbsent ? 'absent' : ''}">
                <div>
                    <div class="student-name">${escapeHtml(s.name)}</div>
                    <div class="student-meta">
                        ${groupLabel}${s.timesCalled || 0} calls · ${s.correct || 0}✓ ${s.incorrect || 0}✗ · ${accuracy}%
                    </div>
                </div>
                <button class="secondary" data-action="start-edit" data-id="${s.id}" title="Edit student">✎</button>
                <button class="${isAbsent ? 'success' : 'secondary'}" data-action="toggle-absent" data-id="${s.id}" title="${isAbsent ? 'Mark present' : 'Mark absent'}">
                    ${isAbsent ? '✓' : '🚫'}
                </button>
                <button class="danger" data-action="delete-student" data-id="${s.id}" title="Delete student">✕</button>
            </div>
        `;
    }).join('');
}

function renderSummaryList() {
    const list = document.getElementById('summary-list');
    if (state.students.length === 0) {
        list.innerHTML = '<div class="empty-state">No data yet.</div>';
        return;
    }
    const sorted = [...state.students].sort((a, b) => {
        const groupCompare = (a.group || '').localeCompare(b.group || '');
        if (groupCompare !== 0) return groupCompare;
        return a.name.localeCompare(b.name);
    });
    list.innerHTML = sorted.map(s => {
        const total = (s.correct || 0) + (s.incorrect || 0);
        const accuracy = total > 0 ? Math.round((s.correct / total) * 100) : 0;
        const groupLabel = s.group ? `${escapeHtml(s.group)} · ` : '';
        return `
            <div class="student-row">
                <div>
                    <div class="student-name">${escapeHtml(s.name)}</div>
                    <div class="student-meta">${groupLabel}${s.timesCalled || 0} calls</div>
                </div>
                <div style="text-align: right; font-size: 0.85rem;">
                    <div style="color: var(--success); font-weight: 600;">${s.correct || 0} ✓</div>
                    <div style="color: var(--warning); font-weight: 600;">${s.incorrect || 0} ✗</div>
                </div>
                <div style="font-size: 1rem; font-weight: 700; color: var(--accent-secondary);">${accuracy}%</div>
            </div>
        `;
    }).join('');
}

function renderEventLog() {
    const log = document.getElementById('event-log');
    if (state.eventLog.length === 0) {
        log.innerHTML = '<div class="empty-state">No events logged yet.</div>';
        return;
    }
    // Last 50 events, newest first
    const recent = state.eventLog.slice(-50).reverse();
    log.innerHTML = recent.map(e => {
        const d = new Date(e.timestamp);
        const timeStr = d.toLocaleString('en-NZ', {
            month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
        const groupLabel = e.group ? ` <span style="color: var(--text-secondary);">(${escapeHtml(e.group)})</span>` : '';
        return `
            <div class="log-row">
                <div class="log-time">${escapeHtml(timeStr)}</div>
                <div>${escapeHtml(e.name)}${groupLabel}</div>
                <div class="log-outcome ${e.outcome}">${e.outcome}</div>
            </div>
        `;
    }).join('');
}

// ======================
// TAB SWITCHING
// ======================

function switchTab(tabName) {
    document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`${tabName}-tab`).classList.add('active');
}

// ======================
// CLASS LIST MANAGEMENT
// ======================

function makeNewStudent(name, group) {
    return {
        id: generateId(),
        name: name,
        group: (group || '').trim(),
        timesCalled: 0,
        correct: 0,
        incorrect: 0
    };
}

function importCSV() {
    const fileInput = document.getElementById('class-csv-input');
    const file = fileInput.files[0];
    if (!file) {
        alert('Please choose a CSV file first.');
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length === 0) {
            alert('CSV is empty.');
            return;
        }

        // Detect header row (skip if first row contains "firstname" or "name")
        const firstLineLower = lines[0].toLowerCase();
        const startIndex = (firstLineLower.includes('firstname') || firstLineLower.includes('name')) ? 1 : 0;

        let added = 0;
        let skipped = 0;
        for (let i = startIndex; i < lines.length; i++) {
            const parts = lines[i].split(',').map(p => p.trim());
            const [firstname, lastname, group] = parts;
            if (!firstname || !lastname) {
                skipped++;
                continue;
            }
            const fullName = `${firstname} ${lastname}`;
            if (state.students.find(s => s.name === fullName)) {
                skipped++;
                continue;
            }
            state.students.push(makeNewStudent(fullName, group));
            added++;
        }
        saveStudents();
        renderAll();
        fileInput.value = '';
        alert(`Imported ${added} student${added !== 1 ? 's' : ''}. ${skipped > 0 ? `Skipped ${skipped} (duplicates or invalid rows).` : ''}`);
    };
    reader.readAsText(file);
}

function downloadTemplate() {
    const csv = 'firstname,lastname,group\nJohn,Smith,\nJane,Doe,Group A\n';
    downloadFile('class-list-template.csv', csv, 'text/csv');
}

function toggleAddForm() {
    const form = document.getElementById('add-form');
    const btn = document.getElementById('btn-add-toggle');
    const isHidden = form.style.display === 'none';
    if (isHidden) {
        form.style.display = 'block';
        btn.textContent = '✕ Close';
        btn.classList.remove('success');
        btn.classList.add('secondary');
        document.getElementById('add-firstname').value = '';
        document.getElementById('add-lastname').value = '';
        document.getElementById('add-group').value = '';
        document.getElementById('add-firstname').focus();
    } else {
        form.style.display = 'none';
        btn.textContent = '＋ Add student';
        btn.classList.remove('secondary');
        btn.classList.add('success');
    }
}

function cancelAdd() {
    const form = document.getElementById('add-form');
    const btn = document.getElementById('btn-add-toggle');
    form.style.display = 'none';
    btn.textContent = '＋ Add student';
    btn.classList.remove('secondary');
    btn.classList.add('success');
}

function saveNewStudent() {
    const firstname = document.getElementById('add-firstname').value.trim();
    const lastname = document.getElementById('add-lastname').value.trim();
    const group = document.getElementById('add-group').value.trim();

    if (!firstname || !lastname) {
        alert('Please enter both a first name and a last name.');
        return;
    }
    const fullName = `${firstname} ${lastname}`;
    if (state.students.find(s => s.name === fullName)) {
        alert(`${fullName} is already in the class list.`);
        return;
    }
    state.students.push(makeNewStudent(fullName, group));
    saveStudents();
    renderAll();
    // Reset form fields but keep it open so multiple students can be added quickly
    document.getElementById('add-firstname').value = '';
    document.getElementById('add-lastname').value = '';
    document.getElementById('add-firstname').focus();
}

let editingStudentId = null;

function startEdit(studentId) {
    editingStudentId = studentId;
    renderStudentList();
    // Focus the firstname input in the edit row
    setTimeout(() => {
        const input = document.getElementById('edit-firstname');
        if (input) input.focus();
    }, 0);
}

function cancelEdit() {
    editingStudentId = null;
    renderStudentList();
}

function saveEdit(studentId) {
    const firstname = document.getElementById('edit-firstname').value.trim();
    const lastname = document.getElementById('edit-lastname').value.trim();
    const group = document.getElementById('edit-group').value.trim();

    if (!firstname || !lastname) {
        alert('Please enter both a first name and a last name.');
        return;
    }
    const fullName = `${firstname} ${lastname}`;
    // Allow keeping the same name; only block if a *different* student has this name
    const clash = state.students.find(s => s.name === fullName && s.id !== studentId);
    if (clash) {
        alert(`${fullName} is already in the class list.`);
        return;
    }

    const student = state.students.find(s => s.id === studentId);
    if (!student) return;
    student.name = fullName;
    student.group = group;

    saveStudents();
    editingStudentId = null;
    renderAll();
}

function deleteStudent(studentId) {
    const student = state.students.find(s => s.id === studentId);
    if (!student) return;
    if (!confirm(`Delete ${student.name}? This cannot be undone.`)) return;
    state.students = state.students.filter(s => s.id !== studentId);
    chrome.storage.local.set({ students: state.students });
    renderAll();
}

function toggleAbsent(studentId) {
    const idx = state.absentToday.indexOf(studentId);
    if (idx === -1) {
        state.absentToday.push(studentId);
    } else {
        state.absentToday.splice(idx, 1);
    }
    chrome.storage.local.set({ absentToday: state.absentToday });
    renderAll();
}

// ======================
// EXPORTS
// ======================

function exportSummaryCSV() {
    if (state.students.length === 0) {
        alert('No students to export.');
        return;
    }
    const header = 'Name,Group,Times Called,Correct,Incorrect,Accuracy %';
    const rows = state.students.map(s => {
        const total = (s.correct || 0) + (s.incorrect || 0);
        const accuracy = total > 0 ? Math.round((s.correct / total) * 100) : 0;
        return [
            csvEscape(s.name),
            csvEscape(s.group),
            csvEscape(s.timesCalled || 0),
            csvEscape(s.correct || 0),
            csvEscape(s.incorrect || 0),
            csvEscape(accuracy)
        ].join(',');
    });
    const csv = [header, ...rows].join('\n');
    downloadFile(`tracker-summary-${todayISO()}.csv`, csv, 'text/csv');
}

function exportEventsCSV() {
    if (state.eventLog.length === 0) {
        alert('No events to export.');
        return;
    }
    const header = 'Timestamp,Name,Group,Outcome';
    const rows = state.eventLog.map(e => [
        csvEscape(e.timestamp),
        csvEscape(e.name),
        csvEscape(e.group),
        csvEscape(e.outcome)
    ].join(','));
    const csv = [header, ...rows].join('\n');
    downloadFile(`tracker-events-${todayISO()}.csv`, csv, 'text/csv');
}

function exportBackupJSON() {
    const backup = {
        version: 1,
        exportDate: new Date().toISOString(),
        students: state.students,
        eventLog: state.eventLog,
        absentToday: state.absentToday,
        groupFilter: state.groupFilter
    };
    downloadFile(
        `tracker-backup-${todayISO()}.json`,
        JSON.stringify(backup, null, 2),
        'application/json'
    );
}

function restoreBackup() {
    const fileInput = document.getElementById('backup-json-input');
    const file = fileInput.files[0];
    if (!file) {
        alert('Please choose a JSON backup file first.');
        return;
    }
    if (!confirm('Restoring will REPLACE your current class list and history. Continue?')) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (!data.students || !Array.isArray(data.students)) {
                throw new Error('Invalid backup file — missing students array.');
            }
            // Old backups (pre-groups) store grade instead of group — convert on the way in.
            state.students = data.students.map(s => {
                if (s.group !== undefined) return s;
                const { grade, ...rest } = s;
                return { ...rest, group: grade !== undefined ? String(grade) : '' };
            });
            state.eventLog = data.eventLog || [];
            state.absentToday = data.absentToday || [];
            state.groupFilter = data.groupFilter || (data.gradeFilter && data.gradeFilter !== 'all' ? String(data.gradeFilter) : 'all');

            chrome.storage.local.set({
                students: state.students,
                eventLog: state.eventLog,
                absentToday: state.absentToday,
                groupFilter: state.groupFilter,
                retriedIds: [],
                groupMigrated: true,
                sessionPool: [],
                currentStudent: null
            }, () => {
                renderAll();
                fileInput.value = '';
                alert(`Restored ${state.students.length} students and ${state.eventLog.length} events.`);
            });
        } catch (err) {
            alert('Could not restore backup: ' + err.message);
        }
    };
    reader.readAsText(file);
}

// ======================
// RESET ACTIONS
// ======================

function resetStats() {
    if (!confirm('Reset all stats (times called, correct, incorrect, event log)? Class list will be kept.')) return;
    state.students.forEach(s => {
        s.timesCalled = 0;
        s.correct = 0;
        s.incorrect = 0;
    });
    state.eventLog = [];
    chrome.storage.local.set({
        students: state.students,
        eventLog: [],
        sessionPool: [],
        retriedIds: [],
        currentStudent: null,
        absentToday: []
    }, () => {
        renderAll();
        alert('Stats reset.');
    });
}

function clearAll() {
    if (!confirm('DELETE EVERYTHING? This cannot be undone!')) return;
    if (!confirm('Are you sure? This deletes students, history, and all settings.')) return;
    chrome.storage.local.clear(() => {
        state = {
            students: [],
            currentStudent: null,
            sessionPool: [],
            absentToday: [],
            groupFilter: 'all',
            eventLog: []
        };
        renderAll();
        alert('All data cleared.');
    });
}

// ======================
// EVENT DELEGATION
// ======================

document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action], [data-tab]');
    if (!target) return;

    if (target.dataset.tab) {
        switchTab(target.dataset.tab);
        return;
    }

    const action = target.dataset.action;
    const id = target.dataset.id;

    const actions = {
        'select-student':       () => chrome.runtime.sendMessage({ action: 'selectStudent' }),
        'mark-incorrect':       () => chrome.runtime.sendMessage({ action: 'markIncorrect' }),
        'mark-absent':          () => chrome.runtime.sendMessage({ action: 'markAbsent' }),
        'toggle-group-filter':  () => chrome.runtime.sendMessage({ action: 'toggleGroupFilter' }),
        'import-csv':           importCSV,
        'download-template':    downloadTemplate,
        'toggle-add-form':      toggleAddForm,
        'cancel-add':           cancelAdd,
        'save-new-student':     saveNewStudent,
        'start-edit':           () => startEdit(id),
        'cancel-edit':          cancelEdit,
        'save-edit':            () => saveEdit(id),
        'toggle-absent':        () => toggleAbsent(id),
        'delete-student':       () => deleteStudent(id),
        'export-summary-csv':   exportSummaryCSV,
        'export-events-csv':    exportEventsCSV,
        'export-backup-json':   exportBackupJSON,
        'restore-backup':       restoreBackup,
        'reset-stats':          resetStats,
        'clear-all':            clearAll
    };

    const handler = actions[action];
    if (handler) handler();
});

// ======================
// FORM KEYBOARD SHORTCUTS
// ======================

document.addEventListener('keydown', (e) => {
    const inAddForm = e.target.closest('#add-form');
    const inEditRow = e.target.closest('.student-row.editing');

    if (e.key === 'Enter' && inAddForm) {
        e.preventDefault();
        saveNewStudent();
    } else if (e.key === 'Escape' && inAddForm) {
        e.preventDefault();
        cancelAdd();
    } else if (e.key === 'Enter' && inEditRow) {
        e.preventDefault();
        if (editingStudentId) saveEdit(editingStudentId);
    } else if (e.key === 'Escape' && inEditRow) {
        e.preventDefault();
        cancelEdit();
    }
});

// ======================
// STORAGE SYNC — react instantly to changes from background.js
// ======================

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    if (changes.students) state.students = changes.students.newValue || [];
    if (changes.currentStudent) state.currentStudent = changes.currentStudent.newValue || null;
    if (changes.sessionPool) state.sessionPool = changes.sessionPool.newValue || [];
    if (changes.absentToday) state.absentToday = changes.absentToday.newValue || [];
    if (changes.groupFilter) state.groupFilter = changes.groupFilter.newValue || 'all';
    if (changes.eventLog) state.eventLog = changes.eventLog.newValue || [];

    renderAll();
});

// ======================
// INIT
// ======================

loadData();
