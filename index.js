function parseFlexibleDate(text, timeZone) {
    let clean = text.trim().replace(/^reminder\s*/i, '');
    const nowInZone = DateTime.now().setZone(timeZone);

    let wantRepeatMenu = false;
    if (/\brepeat\b$/i.test(clean)) {
        wantRepeatMenu = true;
        clean = clean.replace(/\brepeat\b$/i, '').trim();
    }

    const compoundRegex = /^((?:\d+d)?\s*(?:\d+h)?\s*(?:\d+m)?\s*(?:\d+s)?)\s+(.+)$/i;
    const match = clean.match(compoundRegex);

    if (match && match[1].trim().length > 0) {
        const timePart = match[1];
        const days = (timePart.match(/(\d+)d/i) || [])[1] ? parseInt(RegExp.$1, 10) : 0;
        const hours = (timePart.match(/(\d+)h/i) || [])[1] ? parseInt(RegExp.$1, 10) : 0;
        const minutes = (timePart.match(/(\d+)m/i) || [])[1] ? parseInt(RegExp.$1, 10) : 0;
        const seconds = (timePart.match(/(\d+)s/i) || [])[1] ? parseInt(RegExp.$1, 10) : 0;

        if (days > 0 || hours > 0 || minutes > 0 || seconds > 0) {
            let dt = nowInZone;
            if (days) dt = dt.plus({ days });
            if (hours) dt = dt.plus({ hours });
            if (minutes) dt = dt.plus({ minutes });
            if (seconds) dt = dt.plus({ seconds });

            if (dt <= nowInZone.plus({ seconds: 59 })) return null;
            return { date: dt.toJSDate(), reminderText: match[2].trim(), wantRepeatMenu };
        }
    }

    const parsed = chrono.parse(clean, nowInZone.toJSDate(), { forwardDate: true });
    if (parsed.length > 0) {
        const parsedResult = parsed[0];
        const parsedComp = parsedResult.start;

        let dt = nowInZone.set({
            hour: parsedComp.get('hour') !== null ? parsedComp.get('hour') : nowInZone.hour,
            minute: parsedComp.get('minute') !== null ? parsedComp.get('minute') : 0,
            second: 0,
            millisecond: 0
        });

        if (parsedComp.get('day') !== null) {
            dt = dt.set({
                year: parsedComp.get('year') || nowInZone.year,
                month: parsedComp.get('month'),
                day: parsedComp.get('day')
            });
        }

        if (dt <= nowInZone) {
            dt = dt.plus({ days: 1 });
        }

        const reminderText = clean.replace(parsedResult.text, '').trim() || clean;
        return { date: dt.toJSDate(), reminderText: reminderText, wantRepeatMenu };
    }
    return null;
}
