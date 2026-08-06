import { Meridiem } from "../../../types.js";
import { AbstractParserWithWordBoundaryChecking } from "../../../common/parsers/AbstractParserWithWordBoundary.js";
import { implySimilarTime } from "../../../utils/dates.js";
const PATTERN = /(buổi\s*)?(sáng sớm|sáng|trưa|chiều|tối|đêm|nửa đêm|bình minh)(?=\W|$)/i;
export default class VICasualTimeParser extends AbstractParserWithWordBoundaryChecking {
    innerPattern() {
        return PATTERN;
    }
    innerExtract(context, match) {
        const component = context.createParsingComponents();
        implySimilarTime(component, context.refDate);
        return VICasualTimeParser.extractTimeComponents(component, match[2].toLowerCase());
    }
    static extractTimeComponents(component, keyword) {
        switch (keyword) {
            case "b\u00ecnh minh":
            case "s\u00e1ng s\u1edbm":
                component.imply("hour", 6);
                component.imply("minute", 0);
                component.imply("meridiem", Meridiem.AM);
                break;
            case "s\u00e1ng":
                component.imply("hour", 9);
                component.imply("minute", 0);
                component.imply("meridiem", Meridiem.AM);
                break;
            case "tr\u01b0a":
                component.imply("hour", 12);
                component.imply("minute", 0);
                component.imply("meridiem", Meridiem.PM);
                break;
            case "chi\u1ec1u":
                component.imply("hour", 15);
                component.imply("minute", 0);
                component.imply("meridiem", Meridiem.PM);
                break;
            case "t\u1ed1i":
                component.imply("hour", 19);
                component.imply("minute", 0);
                component.imply("meridiem", Meridiem.PM);
                break;
            case "\u0111\u00eam":
                component.imply("hour", 22);
                component.imply("minute", 0);
                component.imply("meridiem", Meridiem.PM);
                break;
            case "n\u1eeda \u0111\u00eam":
                component.imply("hour", 0);
                component.imply("minute", 0);
                component.imply("meridiem", Meridiem.AM);
                break;
        }
        return component;
    }
}
//# sourceMappingURL=VICasualTimeParser.js.map