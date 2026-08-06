"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("../constants");
const results_1 = require("../../../results");
const AbstractParserWithWordBoundary_1 = require("../../../common/parsers/AbstractParserWithWordBoundary");
const duration_1 = require("../../../calculation/duration");
const pattern_1 = require("../../../utils/pattern");
const CASUAL_UNIT_PATTERN = "(?:" + constants_1.NUMBER_PATTERN + "\\s{0,5})?(?:" + (0, pattern_1.matchAnyPattern)(constants_1.TIME_UNIT_DICTIONARY) + ")";
const PATTERN = new RegExp("(này|trước|qua|sau|tới|tiếp)\\s*(" +
    CASUAL_UNIT_PATTERN +
    ")" +
    "|(" +
    CASUAL_UNIT_PATTERN +
    ")\\s*(này|trước|qua|sau|tới|tiếp)" +
    "(?=\\W|$)", "i");
class VITimeUnitCasualRelativeFormatParser extends AbstractParserWithWordBoundary_1.AbstractParserWithWordBoundaryChecking {
    innerPattern() {
        return PATTERN;
    }
    innerExtract(context, match) {
        const modifier = (match[1] || match[4] || "").toLowerCase();
        const unitText = (match[2] || match[3] || "").toLowerCase();
        let duration = (0, constants_1.parseDuration)(unitText);
        if (Object.keys(duration).length === 0) {
            const unit = constants_1.TIME_UNIT_DICTIONARY[unitText];
            if (!unit)
                return null;
            duration = { [unit]: 1 };
        }
        if (modifier === "trước" || modifier === "qua") {
            duration = (0, duration_1.reverseDuration)(duration);
        }
        return results_1.ParsingComponents.createRelativeFromReference(context.reference, duration);
    }
}
exports.default = VITimeUnitCasualRelativeFormatParser;
//# sourceMappingURL=VITimeUnitCasualRelativeFormatParser.js.map