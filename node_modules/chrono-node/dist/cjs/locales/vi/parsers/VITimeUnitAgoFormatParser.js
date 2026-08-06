"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("../constants");
const results_1 = require("../../../results");
const AbstractParserWithWordBoundary_1 = require("../../../common/parsers/AbstractParserWithWordBoundary");
const duration_1 = require("../../../calculation/duration");
const PATTERN = new RegExp("(" + constants_1.TIME_UNITS_PATTERN + ")" + "\\s{0,5}(?:tr\u01b0\u1edbc|qua)(?=\\W|$)", "i");
class VITimeUnitAgoFormatParser extends AbstractParserWithWordBoundary_1.AbstractParserWithWordBoundaryChecking {
    constructor(strictMode = false) {
        super();
        this.strictMode = strictMode;
    }
    innerPattern() {
        return PATTERN;
    }
    innerExtract(context, match) {
        const duration = (0, constants_1.parseDuration)(match[1]);
        if (!duration)
            return null;
        return results_1.ParsingComponents.createRelativeFromReference(context.reference, (0, duration_1.reverseDuration)(duration));
    }
}
exports.default = VITimeUnitAgoFormatParser;
//# sourceMappingURL=VITimeUnitAgoFormatParser.js.map