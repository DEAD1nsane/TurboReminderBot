"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("../constants");
const pattern_1 = require("../../../utils/pattern");
const constants_2 = require("../constants");
const AbstractParserWithWordBoundary_1 = require("../../../common/parsers/AbstractParserWithWordBoundary");
const YEAR_PATTERN = `(?:[1-9][0-9]{0,3}\\s{0,2}(?:BE|AD|BC|BCE|CE)|[1-9][0-9]{3})`;
const PATTERN = new RegExp(`(${YEAR_PATTERN})` +
    `(?:\\s*[-.\\/,]?\\s*|\\s+of\\s+)` +
    `(${(0, pattern_1.matchAnyPattern)(constants_1.MONTH_DICTIONARY)})` +
    `(?=[^\\s\\w]|\\s+[^0-9]|\\s+$|$)`, "i");
const YEAR_GROUP = 1;
const MONTH_NAME_GROUP = 2;
class ENYearMonthNameParser extends AbstractParserWithWordBoundary_1.AbstractParserWithWordBoundaryChecking {
    innerPattern() {
        return PATTERN;
    }
    innerExtract(context, match) {
        const year = (0, constants_2.parseYear)(match[YEAR_GROUP]);
        const monthName = match[MONTH_NAME_GROUP].toLowerCase();
        const month = constants_1.MONTH_DICTIONARY[monthName];
        const result = context.createParsingResult(match.index, match[0]);
        result.start.imply("day", 1);
        result.start.assign("month", month);
        result.start.assign("year", year);
        result.start.addTag("parser/ENYearMonthNameParser");
        return result;
    }
}
exports.default = ENYearMonthNameParser;
//# sourceMappingURL=ENYearMonthNameParser.js.map