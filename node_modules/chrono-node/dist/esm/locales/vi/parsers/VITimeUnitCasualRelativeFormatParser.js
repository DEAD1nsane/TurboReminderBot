import { TIME_UNIT_DICTIONARY, NUMBER_PATTERN, parseDuration } from "../constants.js";
import { ParsingComponents } from "../../../results.js";
import { AbstractParserWithWordBoundaryChecking } from "../../../common/parsers/AbstractParserWithWordBoundary.js";
import { reverseDuration } from "../../../calculation/duration.js";
import { matchAnyPattern } from "../../../utils/pattern.js";
const CASUAL_UNIT_PATTERN = "(?:" + NUMBER_PATTERN + "\\s{0,5})?(?:" + matchAnyPattern(TIME_UNIT_DICTIONARY) + ")";
const PATTERN = new RegExp("(này|trước|qua|sau|tới|tiếp)\\s*(" +
    CASUAL_UNIT_PATTERN +
    ")" +
    "|(" +
    CASUAL_UNIT_PATTERN +
    ")\\s*(này|trước|qua|sau|tới|tiếp)" +
    "(?=\\W|$)", "i");
export default class VITimeUnitCasualRelativeFormatParser extends AbstractParserWithWordBoundaryChecking {
    innerPattern() {
        return PATTERN;
    }
    innerExtract(context, match) {
        const modifier = (match[1] || match[4] || "").toLowerCase();
        const unitText = (match[2] || match[3] || "").toLowerCase();
        let duration = parseDuration(unitText);
        if (Object.keys(duration).length === 0) {
            const unit = TIME_UNIT_DICTIONARY[unitText];
            if (!unit)
                return null;
            duration = { [unit]: 1 };
        }
        if (modifier === "trước" || modifier === "qua") {
            duration = reverseDuration(duration);
        }
        return ParsingComponents.createRelativeFromReference(context.reference, duration);
    }
}
//# sourceMappingURL=VITimeUnitCasualRelativeFormatParser.js.map