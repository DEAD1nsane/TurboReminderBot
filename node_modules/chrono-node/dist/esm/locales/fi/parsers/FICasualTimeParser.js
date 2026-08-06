import { Meridiem } from "../../../types.js";
import { AbstractParserWithWordBoundaryChecking } from "../../../common/parsers/AbstractParserWithWordBoundary.js";
import { implySimilarTime } from "../../../utils/dates.js";
export default class FICasualTimeParser extends AbstractParserWithWordBoundaryChecking {
    innerPattern(context) {
        return /(tänä\s*)?(aamulla|aamuna|aamupäivällä|päivällä|iltapäivällä|illalla|yöllä|keskiyöllä)(?=\W|$)/i;
    }
    innerExtract(context, match) {
        const targetDate = context.refDate;
        const timeKeywordPattern = match[2].toLowerCase();
        const component = context.createParsingComponents();
        implySimilarTime(component, targetDate);
        return FICasualTimeParser.extractTimeComponents(component, timeKeywordPattern);
    }
    static extractTimeComponents(component, timeKeywordPattern) {
        switch (timeKeywordPattern) {
            case "aamulla":
            case "aamuna":
                component.imply("hour", 6);
                component.imply("minute", 0);
                component.imply("second", 0);
                component.imply("meridiem", Meridiem.AM);
                component.addTag("casualReference/morning");
                break;
            case "aamupäivällä":
                component.imply("hour", 9);
                component.imply("minute", 0);
                component.imply("second", 0);
                component.imply("meridiem", Meridiem.AM);
                component.addTag("casualReference/morning");
                break;
            case "päivällä":
                component.imply("hour", 12);
                component.imply("minute", 0);
                component.imply("second", 0);
                component.imply("meridiem", Meridiem.AM);
                component.addTag("casualReference/noon");
                break;
            case "iltapäivällä":
                component.imply("hour", 15);
                component.imply("minute", 0);
                component.imply("second", 0);
                component.imply("meridiem", Meridiem.PM);
                component.addTag("casualReference/afternoon");
                break;
            case "illalla":
                component.imply("hour", 18);
                component.imply("minute", 0);
                component.imply("second", 0);
                component.imply("meridiem", Meridiem.PM);
                component.addTag("casualReference/evening");
                break;
            case "yöllä":
                component.imply("hour", 22);
                component.imply("minute", 0);
                component.imply("second", 0);
                component.imply("meridiem", Meridiem.PM);
                component.addTag("casualReference/evening");
                break;
            case "keskiyöllä":
                if (component.get("hour") > 1) {
                    component.addDurationAsImplied({ "day": 1 });
                }
                component.imply("hour", 0);
                component.imply("minute", 0);
                component.imply("second", 0);
                component.imply("meridiem", Meridiem.AM);
                component.addTag("casualReference/midnight");
                break;
        }
        return component;
    }
}
//# sourceMappingURL=FICasualTimeParser.js.map