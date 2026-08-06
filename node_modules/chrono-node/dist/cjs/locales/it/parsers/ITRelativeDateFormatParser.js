"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("../constants");
const results_1 = require("../../../results");
const AbstractParserWithWordBoundary_1 = require("../../../common/parsers/AbstractParserWithWordBoundary");
const pattern_1 = require("../../../utils/pattern");
const PATTERN = new RegExp("(?:" +
    `(?:il\\s*|la\\s*|l'\\s*)?(questo|questa|quest'|scorso|scorsa|prossimo|prossima|dopo\\s*questo|dopo\\s*questa)\\s*(${(0, pattern_1.matchAnyPattern)(constants_1.TIME_UNIT_DICTIONARY)})` +
    "|" +
    `(?:il\\s*|la\\s*|l'\\s*)(${(0, pattern_1.matchAnyPattern)(constants_1.TIME_UNIT_DICTIONARY)})\\s*(scorso|scorsa|prossimo|prossima)` +
    ")(?=\\W|$)", "i");
const MODIFIER_WORD_GROUP_1 = 1;
const RELATIVE_WORD_GROUP_1 = 2;
const RELATIVE_WORD_GROUP_2 = 3;
const MODIFIER_WORD_GROUP_2 = 4;
class ITRelativeDateFormatParser extends AbstractParserWithWordBoundary_1.AbstractParserWithWordBoundaryChecking {
    innerPattern() {
        return PATTERN;
    }
    innerExtract(context, match) {
        let modifier;
        let unitWord;
        if (match[MODIFIER_WORD_GROUP_1]) {
            modifier = match[MODIFIER_WORD_GROUP_1].toLowerCase();
            unitWord = match[RELATIVE_WORD_GROUP_1].toLowerCase();
        }
        else {
            modifier = match[MODIFIER_WORD_GROUP_2].toLowerCase();
            unitWord = match[RELATIVE_WORD_GROUP_2].toLowerCase();
        }
        const timeunit = constants_1.TIME_UNIT_DICTIONARY[unitWord];
        if (modifier == "prossimo" || modifier == "prossima" || modifier.startsWith("dopo")) {
            const timeUnits = {};
            timeUnits[timeunit] = 1;
            return results_1.ParsingComponents.createRelativeFromReference(context.reference, timeUnits);
        }
        if (modifier == "scorso" || modifier == "scorsa") {
            const timeUnits = {};
            timeUnits[timeunit] = -1;
            return results_1.ParsingComponents.createRelativeFromReference(context.reference, timeUnits);
        }
        const components = context.createParsingComponents();
        let date = new Date(context.reference.instant.getTime());
        if (unitWord.match(/settimana/i)) {
            date.setDate(date.getDate() - date.getDay());
            components.imply("day", date.getDate());
            components.imply("month", date.getMonth() + 1);
            components.imply("year", date.getFullYear());
        }
        else if (unitWord.match(/mese/i)) {
            date.setDate(1);
            components.imply("day", date.getDate());
            components.assign("year", date.getFullYear());
            components.assign("month", date.getMonth() + 1);
        }
        else if (unitWord.match(/anno/i)) {
            date.setDate(1);
            date.setMonth(0);
            components.imply("day", date.getDate());
            components.imply("month", date.getMonth() + 1);
            components.assign("year", date.getFullYear());
        }
        return components;
    }
}
exports.default = ITRelativeDateFormatParser;
//# sourceMappingURL=ITRelativeDateFormatParser.js.map