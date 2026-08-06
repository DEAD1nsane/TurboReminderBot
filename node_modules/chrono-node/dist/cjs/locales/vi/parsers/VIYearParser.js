"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("../constants");
const AbstractParserWithWordBoundary_1 = require("../../../common/parsers/AbstractParserWithWordBoundary");
const PATTERN = new RegExp("(?:\\bnăm\\s*(" + constants_1.YEAR_PATTERN + ")|\\b([0-9]{1,4})\\s*(TCN))(?=\\W|$)", "i");
const YEAR_WITH_NAM_GROUP = 1;
const BARE_BC_YEAR_GROUP = 2;
const BARE_BC_SUFFIX_GROUP = 3;
class VIYearParser extends AbstractParserWithWordBoundary_1.AbstractParserWithWordBoundaryChecking {
    innerPattern() {
        return PATTERN;
    }
    innerExtract(context, match) {
        let yearText;
        if (match[YEAR_WITH_NAM_GROUP]) {
            yearText = match[YEAR_WITH_NAM_GROUP];
        }
        else {
            yearText = match[BARE_BC_YEAR_GROUP] + " " + match[BARE_BC_SUFFIX_GROUP];
        }
        const result = context.createParsingResult(match.index, match[0]);
        result.start.assign("year", (0, constants_1.parseYear)(yearText));
        result.start.imply("month", 1);
        result.start.imply("day", 1);
        return result;
    }
}
exports.default = VIYearParser;
//# sourceMappingURL=VIYearParser.js.map