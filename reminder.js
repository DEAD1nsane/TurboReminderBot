const chrono = require('chrono-node');
const { DateTime } = require('luxon');

const userInput = "in 2 hours";
const userTimezone = "America/Chicago";

const nowLocal = DateTime.now().setZone(userTimezone);
const parsedDate = chrono.parseDate(userInput, nowLocal.toJSDate());

if (parsedDate) {
    const localDt = DateTime.fromJSDate(parsedDate, { zone: userTimezone });
    const utcDt = localDt.toUTC();

    console.log(`User Local Time: ${localDt.toISO()}`);
    console.log(`Store in DB (UTC): ${utcDt.toISO()}`);
} else {
    console.log("Could not parse time.");
}
