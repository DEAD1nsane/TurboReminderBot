import { YEAR_PATTERN, parseYear } from "../constants.js";
import { AbstractParserWithWordBoundaryChecking } from "../../../common/parsers/AbstractParserWithWordBoundary.js";
const PATTERN = new RegExp("(?:\\bnăm\\s*(" + YEAR_PATTERN + ")|\\b([0-9]{1,4})\\s*(TCN))(?=\\W|$)", "i");
const YEAR_WITH_NAM_GROUP = 1;
const BARE_BC_YEAR_GROUP = 2;
const BARE_BC_SUFFIX_GROUP = 3;
export default class VIYearParser extends AbstractParserWithWordBoundaryChecking {
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
        result.start.assign("year", parseYear(yearText));
        result.start.imply("month", 1);
        result.start.imply("day", 1);
        return result;
    }
}
//# sourceMappingURL=VIYearParser.js.map