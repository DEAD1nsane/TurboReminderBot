"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("../constants");
const pattern_1 = require("../../../utils/pattern");
const AbstractParserWithWordBoundary_1 = require("../../../common/parsers/AbstractParserWithWordBoundary");
const weekdays_1 = require("../../../calculation/weekdays");
const types_1 = require("../../../types");
const PATTERN = new RegExp("(?:(?:\\,|\\(|\\（)\\s*)?" +
    "(?:(questo|questa|quest'|scorso|scorsa|prossimo|prossima)\\s*)?" +
    `(${(0, pattern_1.matchAnyPattern)(constants_1.WEEKDAY_DICTIONARY)}|weekend|fine\\s*settimana)` +
    "(?:\\s*(?:\\,|\\)|\\）))?" +
    "(?:\\s*(scorso|scorsa|prossimo|prossima)(?:\\s*settimana)?)?" +
    "(?=\\W|$)", "i");
const PREFIX_GROUP = 1;
const WEEKDAY_GROUP = 2;
const POSTFIX_GROUP = 3;
class ITWeekdayParser extends AbstractParserWithWordBoundary_1.AbstractParserWithWordBoundaryChecking {
    innerPattern() {
        return PATTERN;
    }
    innerExtract(context, match) {
        const prefix = match[PREFIX_GROUP];
        const postfix = match[POSTFIX_GROUP];
        let modifierWord = prefix || postfix;
        modifierWord = modifierWord || "";
        modifierWord = modifierWord.toLowerCase();
        let modifier = null;
        if (modifierWord == "scorso" || modifierWord == "scorsa") {
            modifier = "last";
        }
        else if (modifierWord == "prossimo" || modifierWord == "prossima") {
            modifier = "next";
        }
        else if (modifierWord == "questo" || modifierWord == "questa" || modifierWord == "quest'") {
            modifier = "this";
        }
        const weekday_word = match[WEEKDAY_GROUP].toLowerCase();
        let weekday;
        if (constants_1.WEEKDAY_DICTIONARY[weekday_word] !== undefined) {
            weekday = constants_1.WEEKDAY_DICTIONARY[weekday_word];
        }
        else if (weekday_word == "weekend" || weekday_word.match(/fine\s*settimana/)) {
            weekday = modifier == "last" ? types_1.Weekday.SUNDAY : types_1.Weekday.SATURDAY;
        }
        else {
            return null;
        }
        return (0, weekdays_1.createParsingComponentsAtWeekday)(context.reference, weekday, modifier);
    }
}
exports.default = ITWeekdayParser;
//# sourceMappingURL=ITWeekdayParser.js.map