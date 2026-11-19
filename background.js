// ======================
// SIMPLE STUDENT TRACKER — BACKGROUND
// ======================
// Data model (single source of truth, stored in chrome.storage.local):
// {
//   students: [{ id, name, group, timesCalled, correct, incorrect }],
//   sessionPool: [studentId, ...]   // shuffled queue for round-robin
//   currentStudent: { id, name, group } | null
//   absentToday: [studentId, ...]
//   groupFilter: 'all' | <group name>   // group names come from whatever students[].group values exist
//   retriedIds: [studentId, ...]    // students already given their one incorrect-answer retry this round
//   lastResetDate: 'YYYY-MM-DD'     // for overnight absent reset
//   eventLog: [{ timestamp, studentId, name, group, outcome }]
//     outcome: 'correct' | 'incorrect' | 'absent'
// }

// ======================
// CONSTANTS
// ======================

const OVERLAY_FADE_MS = 5000;

// ======================
// UTILITIES
// ======================

function isRestrictedPage(url) {
    if (!url) return true;
    return url.startsWith('chrome://') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('edge://') ||
        url.startsWith('about:');
}

function withActiveContentTab(callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) {
            console.error('Error querying tabs:', chrome.runtime.lastError);
            return;
        }
        if (!tabs[0] || isRestrictedPage(tabs[0].url)) {
            console.log('Cannot show overlay on restricted page:', tabs[0]?.url);
            return;
        }
        callback(tabs[0].id);
    });
}

function sendMessageToContentScript(tabId, message) {
    chrome.tabs.sendMessage(tabId, message, () => {
        if (chrome.runtime.lastError) {
            // Content script may not be loaded on this page; ignore silently
        }
    });
}

function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// "John Smith" → "John S." for the on-screen overlay only.
// Full name is preserved everywhere else (sidebar, exports, logs).
function toOverlayName(fullName) {
    if (!fullName) return '';
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    const last = parts[parts.length - 1];
    const initial = last.charAt(0).toUpperCase();
    return `${parts.slice(0, -1).join(' ')} ${initial}.`;
}

function todayISO() {
    return new Date().toISOString().split('T')[0];
}

// ======================
// MIGRATION (grade → group, one-time)
// ======================

function migrateGradeToGroup(callback) {
    chrome.storage.local.get(['students', 'gradeFilter', 'groupMigrated'], (result) => {
        if (result.groupMigrated) {
            if (callback) callback();
            return;
        }

        const students = (result.students || []).map(s => {
            if (s.group !== undefined) return s;
            const { grade, ...rest } = s;
            rest.group = grade !== undefined ? String(grade) : '';
            return rest;
        });

        const groupFilter = result.gradeFilter && result.gradeFilter !== 'all'
            ? String(result.gradeFilter)
            : 'all';

        chrome.storage.local.set({ students, groupFilter, groupMigrated: true }, () => {
            console.log('Migrated grade field to group for', students.length, 'students');
            if (callback) callback();
        });
    });
}

// ======================
// DAILY RESET (absences only — round-robin pool persists)
// ======================

function checkAndResetDaily(callback) {
    chrome.storage.local.get(['lastResetDate'], (result) => {
        const today = todayISO();
        if (result.lastResetDate !== today) {
            console.log('Daily reset — clearing absences for', today);
            chrome.storage.local.set({
                absentToday: [],
                lastResetDate: today
            }, () => {
                if (callback) callback();
            });
        } else {
            if (callback) callback();
        }
    });
}

// ======================
// STUDENT SELECTION
// ======================

function selectNextStudent() {
    migrateGradeToGroup(() => checkAndResetDaily(() => {
        chrome.storage.local.get(
            ['students', 'sessionPool', 'absentToday', 'groupFilter', 'currentStudent', 'eventLog', 'retriedIds'],
            (result) => {
                const allStudents = result.students || [];
                let sessionPool = result.sessionPool || [];
                const absentToday = result.absentToday || [];
                const groupFilter = result.groupFilter || 'all';
                const currentStudent = result.currentStudent || null;
                const eventLog = result.eventLog || [];
                let retriedIds = result.retriedIds || [];

                if (allStudents.length === 0) {
                    console.log('No students in class list');
                    return;
                }

                // If there's a student currently on screen, pressing "select" counts them correct
                if (currentStudent) {
                    recordOutcome(allStudents, eventLog, currentStudent.id, 'correct');
                }

                // Build eligible list
                let eligible = allStudents;
                if (groupFilter !== 'all') {
                    eligible = eligible.filter(s => s.group === groupFilter);
                }
                eligible = eligible.filter(s => !absentToday.includes(s.id));

                if (eligible.length === 0) {
                    console.log('No eligible students (filter or absences)');
                    return;
                }

                // Clean pool: drop IDs no longer eligible
                const eligibleIds = new Set(eligible.map(s => s.id));
                sessionPool = sessionPool.filter(id => eligibleIds.has(id));

                // Reshuffle when pool empty (round complete) — also clears retry allowances for the new round
                if (sessionPool.length === 0) {
                    sessionPool = shuffleArray(eligible.map(s => s.id));
                    retriedIds = [];
                    console.log('Round complete — reshuffled', sessionPool.length, 'students');
                }

                const selectedId = sessionPool.shift();
                const selected = eligible.find(s => s.id === selectedId);

                if (!selected) {
                    console.error('Selected ID not in eligible — reshuffling and retrying');
                    sessionPool = shuffleArray(eligible.map(s => s.id));
                    retriedIds = [];
                    const fallbackId = sessionPool.shift();
                    const fallback = eligible.find(s => s.id === fallbackId);
                    if (!fallback) return;
                    persistSelection(allStudents, eventLog, fallback, sessionPool, retriedIds);
                    return;
                }

                persistSelection(allStudents, eventLog, selected, sessionPool, retriedIds);
            }
        );
    }));
}

function persistSelection(allStudents, eventLog, selected, sessionPool, retriedIds) {
    // Increment timesCalled on the chosen student
    const studentInArray = allStudents.find(s => s.id === selected.id);
    if (studentInArray) {
        studentInArray.timesCalled = (studentInArray.timesCalled || 0) + 1;
    }

    chrome.storage.local.set({
        students: allStudents,
        sessionPool: sessionPool,
        retriedIds: retriedIds,
        currentStudent: { id: selected.id, name: selected.name, group: selected.group },
        eventLog: eventLog
    }, () => {
        if (chrome.runtime.lastError) {
            console.error('Error saving selection:', chrome.runtime.lastError);
            return;
        }
        console.log('Selected:', selected.name, '| Remaining in round:', sessionPool.length);
        withActiveContentTab((tabId) => {
            sendMessageToContentScript(tabId, {
                action: 'showStudent',
                name: toOverlayName(selected.name),
                fadeMs: OVERLAY_FADE_MS
            });
        });
    });
}

// ======================
// OUTCOME RECORDING (mutates allStudents + eventLog in place)
// ======================

function recordOutcome(allStudents, eventLog, studentId, outcome) {
    const student = allStudents.find(s => s.id === studentId);
    if (!student) return;

    if (outcome === 'correct') {
        student.correct = (student.correct || 0) + 1;
    } else if (outcome === 'incorrect') {
        student.incorrect = (student.incorrect || 0) + 1;
    }
    // 'absent' isn't a correct/incorrect tally — just logged

    eventLog.push({
        timestamp: new Date().toISOString(),
        studentId: student.id,
        name: student.name,
        group: student.group,
        outcome: outcome
    });
}

// ======================
// MARK INCORRECT
// ======================

function markIncorrect() {
    chrome.storage.local.get(['currentStudent', 'students', 'eventLog', 'sessionPool', 'retriedIds'], (result) => {
        const current = result.currentStudent;
        if (!current) {
            console.log('No student on screen to mark incorrect');
            return;
        }

        const allStudents = result.students || [];
        const eventLog = result.eventLog || [];
        let sessionPool = result.sessionPool || [];
        let retriedIds = result.retriedIds || [];

        recordOutcome(allStudents, eventLog, current.id, 'incorrect');

        // One retry per student per round: requeue at the back of this round's pool,
        // unless they've already used their retry (prevents them dominating the end of a round).
        let retried = false;
        if (!retriedIds.includes(current.id)) {
            retriedIds = [...retriedIds, current.id];
            sessionPool = [...sessionPool, current.id];
            retried = true;
        }

        chrome.storage.local.set({
            students: allStudents,
            eventLog: eventLog,
            sessionPool: sessionPool,
            retriedIds: retriedIds,
            currentStudent: null
        }, () => {
            console.log('Marked incorrect:', current.name, retried ? '(requeued for one retry)' : '(retry already used this round)');
            withActiveContentTab((tabId) => {
                sendMessageToContentScript(tabId, { action: 'hideOverlay' });
            });
        });
    });
}

// ======================
// MARK ABSENT
// ======================

function markAbsent() {
    chrome.storage.local.get(['currentStudent', 'students', 'absentToday', 'sessionPool', 'eventLog'], (result) => {
        const current = result.currentStudent;
        if (!current) {
            console.log('No student on screen to mark absent');
            return;
        }

        const allStudents = result.students || [];
        const eventLog = result.eventLog || [];
        const absentToday = result.absentToday || [];
        let sessionPool = result.sessionPool || [];

        if (!absentToday.includes(current.id)) {
            absentToday.push(current.id);
        }

        // Roll back the timesCalled bump — they didn't really get a turn
        const student = allStudents.find(s => s.id === current.id);
        if (student && student.timesCalled > 0) {
            student.timesCalled--;
        }

        // Remove from pool if somehow still there
        sessionPool = sessionPool.filter(id => id !== current.id);

        recordOutcome(allStudents, eventLog, current.id, 'absent');

        chrome.storage.local.set({
            students: allStudents,
            absentToday: absentToday,
            sessionPool: sessionPool,
            eventLog: eventLog,
            currentStudent: null
        }, () => {
            console.log('Marked absent:', current.name);
            withActiveContentTab((tabId) => {
                sendMessageToContentScript(tabId, { action: 'hideOverlay' });
            });
        });
    });
}

// ======================
// GROUP FILTER
// ======================
// Groups are whatever distinct, non-blank values exist in students[].group —
// there's no fixed list. With 0 or 1 group in use, the cycle is just ['all'],
// so toggling is a no-op and everyone is always shown.

function toggleGroupFilter() {
    chrome.storage.local.get(['students', 'groupFilter'], (result) => {
        const students = result.students || [];
        const groups = [...new Set(students.map(s => s.group).filter(g => g))].sort((a, b) => a.localeCompare(b));
        const cycle = ['all', ...groups];

        const currentIndex = cycle.indexOf(result.groupFilter || 'all');
        const newFilter = cycle[(currentIndex + 1) % cycle.length];
        const display = newFilter === 'all' ? 'All students' : `${newFilter} only`;

        // Changing the filter wipes the pool so the next round respects the new filter
        chrome.storage.local.set({
            groupFilter: newFilter,
            sessionPool: []
        }, () => {
            console.log('Group filter:', newFilter);
            withActiveContentTab((tabId) => {
                sendMessageToContentScript(tabId, {
                    action: 'showFilterChange',
                    filter: display
                });
            });
        });
    });
}

// ======================
// COMMAND DISPATCH
// ======================

chrome.commands.onCommand.addListener((command) => {
    const map = {
        'select-student': selectNextStudent,
        'mark-incorrect': markIncorrect,
        'mark-absent': markAbsent,
        'toggle-grade-filter': toggleGroupFilter
    };
    const handler = map[command];
    if (handler) handler();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const map = {
        'selectStudent': selectNextStudent,
        'markIncorrect': markIncorrect,
        'markAbsent': markAbsent,
        'toggleGroupFilter': toggleGroupFilter
    };
    const handler = map[request.action];
    if (handler) {
        handler();
        sendResponse({ success: true });
    }
    return true;
});

// Open the side panel when the toolbar icon is clicked
chrome.action.onClicked.addListener((tab) => {
    if (tab.windowId !== undefined) {
        chrome.sidePanel.open({ windowId: tab.windowId });
    }
});

// ======================
// LIFECYCLE
// ======================

chrome.runtime.onInstalled.addListener(() => {
    console.log('Simple Student Tracker installed');
    migrateGradeToGroup(() => checkAndResetDaily());
});

chrome.runtime.onStartup.addListener(() => {
    console.log('Simple Student Tracker started');
    migrateGradeToGroup(() => checkAndResetDaily());
});
