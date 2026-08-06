import { AbstractParserWithWordBoundaryChecking } from "../../../common/parsers/AbstractParserWithWordBoundary.js";
import { Meridiem } from "../../../types.js";
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
export default class VITimeExpressionParser extends AbstractParserWithWordBoundaryChecking {
    innerPattern() {
        return PATTERN;
    }
    innerExtract(context, match) {
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
        const meridiem = match[MERIDIEM_GROUP]?.toLowerCase();
        if (meridiem === "sáng") {
            result.start.assign("meridiem", Meridiem.AM);
            if (hour === 12)
                result.start.assign("hour", 0);
        }
        else if (meridiem === "trưa") {
            if (hour < 10) {
                result.start.assign("meridiem", Meridiem.PM);
                result.start.assign("hour", hour + 12);
            }
            else {
                result.start.assign("meridiem", hour >= 12 ? Meridiem.PM : Meridiem.AM);
            }
        }
        else if (meridiem === "chiều" || meridiem === "tối" || meridiem === "đêm") {
            result.start.assign("meridiem", Meridiem.PM);
            if (hour < 12)
                result.start.assign("hour", hour + 12);
        }
        result.start.imply("second", 0);
        result.start.imply("millisecond", 0);
        return result;
    }
}
//# sourceMappingURL=VITimeExpressionParser.js.map