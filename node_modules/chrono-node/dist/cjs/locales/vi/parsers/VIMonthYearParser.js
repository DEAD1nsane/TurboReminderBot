"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("../constants");
const pattern_1 = require("../../../utils/pattern");
const AbstractParserWithWordBoundary_1 = require("../../../common/parsers/AbstractParserWithWordBoundary");
const PATTERN = new RegExp("(" + (0, pattern_1.matchAnyPattern)(constants_1.MONTH_DICTIONARY) + ")" + "(?:\\s*(?:năm|/)\\s*(" + constants_1.YEAR_PATTERN + "))?" + "(?=\\W|$)", "i");
const MONTH_GROUP = 1;
const YEAR_GROUP = 2;
class VIMonthYearParser extends AbstractParserWithWordBoundary_1.AbstractParserWithWordBoundaryChecking {
    innerPattern() {
        return PATTERN;
    }
    innerExtract(context, match) {
        const month = constants_1.MONTH_DICTIONARY[match[MONTH_GROUP].toLowerCase()];
        if (!month)
            return null;
        const result = context.createParsingResult(match.index, match[0]);
        result.start.assign("month", month);
        result.start.imply("day", 1);
        if (match[YEAR_GROUP]) {
            result.start.assign("year", (0, constants_1.parseYear)(match[YEAR_GROUP]));
        }
        else {
            result.start.imply("year", context.reference.getDateWithAdjustedTimezone().getFullYear());
        }
        return result;
    }
}
exports.default = VIMonthYearParser;
//# sourceMappingURL=VIMonthYearParser.js.map