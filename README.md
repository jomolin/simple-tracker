# Simple Student Tracker

A stripped-down Chrome extension for round-robin student selection during lessons. Built for a Year 4–5 combined class but works for any age.

## What it does

- **Round-robin selection**: every student gets called once before anyone gets called twice. No time-based resets.
- **One-button feedback**: pressing "select next student" automatically counts the previous student as correct. Press the incorrect hotkey instead if they didn't get it.
- **One retry on a wrong answer**: a student who answers incorrectly gets one extra turn later in the same round before falling back to normal rotation — see [Round-robin behaviour](#round-robin-behaviour).
- **Group filter**: cycle between all students and whatever groups you've defined (e.g. year levels, reading groups). Groups are free text — if you only use one group (or none), the filter has nothing to cycle through and always shows all students.
- **Absences**: skip a student for the day; resets overnight.
- **On-screen name only**: a clean overlay shows the student's name and fades after 5 seconds. No buttons visible to students.
- **Side panel** for managing the class list, viewing history, and exporting data.

## Hotkeys

| Action | Shortcut |
|---|---|
| Select next student (previous → correct) | `Alt+Shift+S` |
| Mark incorrect / no answer | `Alt+Shift+X` |
| Mark absent (today only) | `Alt+Shift+A` |
| Toggle group filter | `Alt+Shift+G` |

These are global — they work from any tab. If they conflict with another extension, change them at `chrome://extensions/shortcuts`.

## Installation

1. Download or clone the `simple-tracker` folder.
2. Open `chrome://extensions/`.
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked** and select the folder.
5. Click the extension icon in the toolbar to open the side panel.

## How to use it

1. **Set up your class list**: Class List tab → upload a CSV (`firstname,lastname,group` — group is optional) or add students manually.
2. **Start a session**: hit `Alt+Shift+S`. A name appears on screen.
3. **If they got it right**: hit `Alt+Shift+S` again to pick the next student. The previous one is logged as correct.
4. **If they got it wrong or didn't answer**: hit `Alt+Shift+X`. The current student is logged as incorrect, and the overlay clears.
5. **If they're absent**: hit `Alt+Shift+A`. They're skipped for the rest of the day.
6. **Done for the day**: open the side panel → Data tab → export.

## Round-robin behaviour

- When the pool runs out (everyone has been called once), it reshuffles and starts again.
- **Wrong answer → one retry this round.** The student goes to the back of the current round's queue, so everyone who hasn't had a turn yet gets called before they come up again. If they get it wrong a *second* time in the same round, they don't requeue again — they just wait for the next reshuffle like everyone else. This keeps a student who keeps missing from dominating the end of a round.
- Changing the group filter wipes the current pool so the new filter takes effect immediately.
- Marked-absent students are removed from the current pool and skipped on reshuffles until tomorrow.
- The pool persists across browser restarts — only the absence list resets overnight.

## Exports

- **Summary CSV**: one row per student with totals and accuracy.
- **Event log CSV**: every call timestamped with outcome. Good for spotting patterns.
- **Backup JSON**: full data dump including class list, all events, and settings. Use this to restore later.

## Files

```
simple-tracker/
├── manifest.json     Extension config + hotkey definitions
├── background.js     Selection logic, hotkey handlers, daily reset
├── content.js        On-screen name overlay (name only, auto-fades)
├── sidebar.html      Side panel markup
├── sidebar.js        Side panel logic (class list, exports)
└── icons/            Extension icons
```

## Architecture

`background.js` owns all selection logic and is the single source of truth. The sidebar reads from `chrome.storage.local` and sends messages to the background for any action that mutates state. This avoids the duplicate-logic problems that plagued the previous tracker.

## Things this doesn't do (on purpose)

- No subject schedules or time-based session resets.
- No participation weighting beyond the single automatic retry on a wrong answer — correct answers never get extra turns.
- No MGCs, goals, interests, or notes.
- No correct button on the overlay — correctness is implicit in pressing "next".
