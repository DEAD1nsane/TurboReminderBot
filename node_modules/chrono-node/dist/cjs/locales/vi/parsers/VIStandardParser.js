"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const years_1 = require("../../../calculation/years");
const constants_1 = require("../constants");
const AbstractParserWithWordBoundary_1 = require("../../../common/parsers/AbstractParserWithWordBoundary");
const PATTERN = new RegExp("(?:ng\u00e0y\\s*)?" +
    "([0-9]{1,2})" +
    "\\s*th\u00e1ng\\s*" +
    "([0-9]{1,2})" +
    "(?:\\s*n\u0103m\\s*(" +
    constants_1.YEAR_PATTERN +
    "))?" +
    "(?=\\W|$)", "i");
const DAY_GROUP = 1;
const MONTH_GROUP = 2;
const YEAR_GROUP = 3;
class VIStandardParser extends AbstractParserWithWordBoundary_1.AbstractParserWithWordBoundaryChecking {
    innerPattern() {
        return PATTERN;
    }
    innerExtract(context, match) {
        const day = parseInt(match[DAY_GROUP]);
        const month = parseInt(match[MONTH_GROUP]);
        if (day > 31 || month > 12)
            return null;
        const result = context.createParsingResult(match.index, match[0]);
        result.start.assign("day", day);
        result.start.assign("month", month);
        if (match[YEAR_GROUP]) {
            result.start.assign("year", (0, constants_1.parseYear)(match[YEAR_GROUP]));
        }
        else {
            result.start.imply("year", (0, years_1.findYearClosestToRef)(context.refDate, day, month));
        }
        return result;
    }
}
exports.default = VIStandardParser;
//# sourceMappingURL=VIStandardParser.js.map