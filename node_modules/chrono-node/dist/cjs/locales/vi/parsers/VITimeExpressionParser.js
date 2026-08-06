"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const AbstractParserWithWordBoundary_1 = require("../../../common/parsers/AbstractParserWithWordBoundary");
const types_1 = require("../../../types");
const PATTERN = new RegExp("(?:l\u00fac\\s*|v\u00e0o\\s*)?" +
    "([0-9]{1,2})" +
    "(?:\\s*gi\u1edd\\s*([0-9]{1,2})?\\s*(?:ph\u00fat\\s*)?" +
    "(s\u00e1ng|tr\u01b0a|chi\u1ec1u|t\u1ed1i|\u0111\u00eam)?" +
    "|:([0-9]{2}))" +
    "(?=\\W|$)", "i");
const HOUR_GROUP = 1;
const MINUTE_GIO_GROUP = 2;
const MERIDIEM_GROUP = 3;
const MINUTE_COLON_GROUP = 4;
class VITimeExpressionParser extends AbstractParserWithWordBoundary_1.AbstractParserWithWordBoundaryChecking {
    innerPattern() {
        return PATTERN;
    }
    innerExtract(context, match) {
        var _a;
        const hour = parseInt(match[HOUR_GROUP]);
        if (hour > 23)
            return null;
        const result = context.createParsingResult(match.index, match[0]);
        result.start.assign("hour", hour);
        const minute = match[MINUTE_COLON_GROUP]
            ? parseInt(match[MINUTE_COLON_GROUP])
            : match[MINUTE_GIO_GROUP]
                ? parseInt(match[MINUTE_GIO_GROUP])
                : 0;
        if (minute >= 60)
            return null;
        result.start.assign("minute", minute);
        const meridiem = (_a = match[MERIDIEM_GROUP]) === null || _a === void 0 ? void 0 : _a.toLowerCase();
        if (meridiem === "sáng") {
            result.start.assign("meridiem", types_1.Meridiem.AM);
            if (hour === 12)
                result.start.assign("hour", 0);
        }
        else if (meridiem === "trưa") {
            if (hour < 10) {
                result.start.assign("meridiem", types_1.Meridiem.PM);
                result.start.assign("hour", hour + 12);
            }
            else {
                result.start.assign("meridiem", hour >= 12 ? types_1.Meridiem.PM : types_1.Meridiem.AM);
            }
        }
        else if (meridiem === "chiều" || meridiem === "tối" || meridiem === "đêm") {
            result.start.assign("meridiem", types_1.Meridiem.PM);
            if (hour < 12)
                result.start.assign("hour", hour + 12);
        }
        result.start.imply("second", 0);
        result.start.imply("millisecond", 0);
        return result;
    }
}
exports.default = VITimeExpressionParser;
//# sourceMappingURL=VITimeExpressionParser.js.map