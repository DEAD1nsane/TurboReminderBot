"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("../constants");
const results_1 = require("../../../results");
const AbstractParserWithWordBoundary_1 = require("../../../common/parsers/AbstractParserWithWordBoundary");
const PATTERN = new RegExp("(" + constants_1.TIME_UNITS_PATTERN + ")" + "\\s{0,5}(?:sau|n\u1eefa|t\u1edbi|ti\u1ebfp)(?=\\W|$)", "i");
class VITimeUnitLaterFormatParser extends AbstractParserWithWordBoundary_1.AbstractParserWithWordBoundaryChecking {
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
        return results_1.ParsingComponents.createRelativeFromReference(context.reference, duration);
    }
}
exports.default = VITimeUnitLaterFormatParser;
//# sourceMappingURL=VITimeUnitLaterFormatParser.js.map