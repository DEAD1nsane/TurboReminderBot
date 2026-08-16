const { DateTime } = require('luxon');

function formatRepeatText(rec) {
    if (!rec) return 'None';
    const [type, num] = rec.split(':');
    if (type === 'daily' || type === 'days') return num === '1' ? 'Daily' : `Every ${num} Days`;
    if (type === 'weekly' || type === 'weeks') return num === '1' ? 'Weekly' : `Every ${num} Weeks`;
    if (type === 'monthly' || type === 'months') return num === '1' ? 'Monthly' : `Every ${num} Months`;
    if (type === 'hourly' || type === 'hours') return num === '1' ? 'Hourly' : `Every ${num} Hours`;
    if (type === 'dow') { const map = {1:'Mon', 2:'Tue', 3:'Wed', 4:'Thu', 5:'Fri', 6:'Sat', 7:'Sun'}; return num.split(',').map(n => map[n]).join(', '); }
    return `${type} ${num}`;
}

function getTimezonePickerKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '🇺🇸 Eastern (EST/EDT)', callback_data: 'settz:America/New_York' }, { text: '🇺🇸 Central (CST/CDT)', callback_data: 'settz:America/Chicago' }],
            [{ text: '🇺🇸 Mountain (MST/MDT)', callback_data: 'settz:America/Denver' }, { text: '🇺🇸 Pacific (PST/PDT)', callback_data: 'settz:America/Los_Angeles' }],
            [{ text: '🇬🇧 London (GMT/BST)', callback_data: 'settz:Europe/London' }, { text: '🇪🇺 Central Europe (CET)', callback_data: 'settz:Europe/Paris' }],
            [{ text: '🌐 UTC', callback_data: 'settz:UTC' }]
        ]
    };
}

function getEditMenuKeyboard(reminderId, currentRecurring, totalOccurrences, earlyOffset) {
    const recType = formatRepeatText(currentRecurring);
    const limitLabel = totalOccurrences ? `${totalOccurrences}x` : 'Forever';
    return {
        inline_keyboard: [
            [{ text: '📝 Edit Note/Text', callback_data: `prompt_edit_text:${reminderId}` }, { text: '🕒 Edit Time/Date', callback_data: `prompt_edit_time:${reminderId}` }],
            [{ text: currentRecurring === null ? ' ✅ None' : 'None', callback_data: `setrec:${reminderId}:none` }, { text: currentRecurring === 'daily:1' ? '✅ Daily' : 'Daily', callback_data: `setrec:${reminderId}:daily:1` }],
            [{ text: currentRecurring === 'weekly:1' ? '✅ Weekly' : 'Weekly', callback_data: `setrec:${reminderId}:weekly:1` }, { text: currentRecurring === 'monthly:1' ? '✅ Monthly' : 'Monthly', callback_data: `setrec:${reminderId}:monthly:1` }],
            [{ text: `⚙️ Interval (${recType})`, callback_data: `unitmenu:${reminderId}` }, { text: `📅 Pick Days`, callback_data: `dowmenu:${reminderId}` }],
            [{ text: `🔁 Repeat Limit (${limitLabel})`, callback_data: `limitmenu:${reminderId}` }],
            [{ text: earlyOffset === 5 ? '✅ 5m ⚡' : '5m ⚡', callback_data: `setearly:${reminderId}:5` }, { text: earlyOffset === 10 ? '✅ 10m ⚡' : '10m ⚡', callback_data: `setearly:${reminderId}:10` }, { text: (earlyOffset && earlyOffset !== 5 && earlyOffset !== 10) ? `✅ ${earlyOffset}m ⚡` : 'Custom ⚡', callback_data: `prompt_early:${reminderId}` }, { text: !earlyOffset ? '✅ Off' : 'Off ❌', callback_data: `setearly:${reminderId}:0` }],
            [{ text: '⬅️ Back to Reminders', callback_data: 'menu:list' }]
        ]
    };
}

function getUnitMenuKeyboard(reminderId) {
    return {
        inline_keyboard: [
            [{ text: '⏱️ Hours', callback_data: `nummenu:${reminderId}:hours` }, { text: '📅 Days', callback_data: `nummenu:${reminderId}:days` }],
            [{ text: '🗓️ Weeks', callback_data: `nummenu:${reminderId}:weeks` }, { text: '📆 Months', callback_data: `nummenu:${reminderId}:months` }],
            [{ text: '⬅️ Back to Edit', callback_data: `edit:${reminderId}` }]
        ]
    };
}

function getNumberMenuKeyboard(reminderId, unit) {
    const nums = [2, 3, 4, 5, 6, 8, 10, 12, 14, 21, 30];
    let buttons = [], row = [];
    nums.forEach((n, idx) => {
        row.push({ text: `${n}`, callback_data: `setrec:${reminderId}:${unit}:${n}` });
        if (row.length === 4 || idx === nums.length - 1) { buttons.push(row); row = []; }
    });
    buttons.push([{ text: '⬅️ Back to Units', callback_data: `unitmenu:${reminderId}` }]);
    return { inline_keyboard: buttons };
}

function getLimitMenuKeyboard(reminderId, totalOccurrences) {
    const current = totalOccurrences || 0;
    const limits = [0, 2, 3, 5, 10, 15, 20, 30, 50, 100];
    let buttons = [], row = [];
    limits.forEach((val, idx) => {
        const label = val === 0 ? 'Forever' : `${val}x`;
        row.push({ text: current === val ? `✅ ${label}` : label, callback_data: `setlimit:${reminderId}:${val}` });
        if (row.length === 3 || idx === limits.length - 1) { buttons.push(row); row = []; }
    });
    buttons.push([{ text: '⬅️ Back to Edit', callback_data: `edit:${reminderId}` }]);
    return { inline_keyboard: buttons };
}


function getDowMenuKeyboard(reminderId, currentRecurring) {
    const selected = (currentRecurring && currentRecurring.startsWith('dow:')) ? currentRecurring.split(':')[1].split(',').map(Number) : [];
    const d = (n, label) => ({ text: selected.includes(n) ? `✅ ${label}` : label, callback_data: `toggledow:${reminderId}:${n}` });
    return {
        inline_keyboard: [
            [d(1, 'Mon'), d(2, 'Tue'), d(3, 'Wed'), d(4, 'Thu')],
            [d(5, 'Fri'), d(6, 'Sat'), d(7, 'Sun')],
            [{ text: '💾 Save / Back', callback_data: `edit:${reminderId}` }]
        ]
    };
}
module.exports = { formatRepeatText, getTimezonePickerKeyboard, getEditMenuKeyboard, getUnitMenuKeyboard, getNumberMenuKeyboard, getLimitMenuKeyboard, getDowMenuKeyboard };
