"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("../constants");
const pattern_1 = require("../../../utils/pattern");
const AbstractParserWithWordBoundary_1 = require("../../../common/parsers/AbstractParserWithWordBoundary");
const weekdays_1 = require("../../../calculation/weekdays");
const PATTERN = new RegExp("(" +
    (0, pattern_1.matchAnyPattern)(constants_1.WEEKDAY_DICTIONARY) +
    ")" +
    "(?:\\s*(này|tới|sau(?!\\s*khi)|qua))?" +
    "(?=\\W|$)", "i");
const WEEKDAY_GROUP = 1;
const MODIFIER_GROUP = 2;
class VIWeekdayParser extends AbstractParserWithWordBoundary_1.AbstractParserWithWordBoundaryChecking {
    innerPattern() {
        return PATTERN;
    }
    innerExtract(context, match) {
        const dowText = match[WEEKDAY_GROUP].toLowerCase();
        const dow = constants_1.WEEKDAY_DICTIONARY[dowText];
        if (dow === undefined)
            return null;
        const modifier = match[MODIFIER_GROUP];
        let modifierType = null;
        if (modifier) {
            const m = modifier.toLowerCase();
            if (m.includes("tới") || m.includes("sau"))
                modifierType = "next";
            else if (m.includes("qua"))
                modifierType = "last";
        }
        return (0, weekdays_1.createParsingComponentsAtWeekday)(context.reference, dow, modifierType);
    }
}
exports.default = VIWeekdayParser;
//# sourceMappingURL=VIWeekdayParser.js.map