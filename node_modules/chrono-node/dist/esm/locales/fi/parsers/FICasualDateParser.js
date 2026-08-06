import { AbstractParserWithWordBoundaryChecking } from "../../../common/parsers/AbstractParserWithWordBoundary.js";
import { assignSimilarDate, implySimilarTime } from "../../../utils/dates.js";
import FICasualTimeParser from "./FICasualTimeParser.js";
import * as references from "../../../common/casualReferences.js";
import { addDuration } from "../../../calculation/duration.js";
const PATTERN = new RegExp(`(nyt|tänään|huomenna|ylihuomenna|eilen|toissapäivänä|viime\\s*yönä)` +
    `(?:\\s*(aamulla|aamuna|aamupäivällä|päivällä|iltapäivällä|illalla|yöllä|keskiyöllä))?` +
    `(?=\\W|$)`, "i");
const DATE_GROUP = 1;
const TIME_GROUP = 2;
export default class FICasualDateParser extends AbstractParserWithWordBoundaryChecking {
    innerPattern(context) {
        return PATTERN;
    }
    innerExtract(context, match) {
        let targetDate = context.reference.getDateWithAdjustedTimezone();
        const dateKeyword = (match[DATE_GROUP] || "").toLowerCase();
        const timeKeyword = (match[TIME_GROUP] || "").toLowerCase();
        let component = context.createParsingComponents();
        switch (dateKeyword) {
            case "nyt":
                component = references.now(context.reference);
                break;
            case "tänään":
                component = references.today(context.reference);
                break;
            case "huomenna":
                targetDate = addDuration(targetDate, { day: 1 });
                assignSimilarDate(component, targetDate);
                implySimilarTime(component, targetDate);
                break;
            case "ylihuomenna":
                targetDate = addDuration(targetDate, { day: 2 });
                assignSimilarDate(component, targetDate);
                implySimilarTime(component, targetDate);
                break;
            case "eilen":
                targetDate = addDuration(targetDate, { day: -1 });
                assignSimilarDate(component, targetDate);
                implySimilarTime(component, targetDate);
                break;
            case "toissapäivänä":
                targetDate = addDuration(targetDate, { day: -2 });
                assignSimilarDate(component, targetDate);
                implySimilarTime(component, targetDate);
                break;
            default:
                if (dateKeyword.match(/viime\s*yönä/)) {
                    if (targetDate.getHours() > 6) {
                        targetDate = addDuration(targetDate, { day: -1 });
                    }
                    assignSimilarDate(component, targetDate);
                    component.imply("hour", 0);
                }
                break;
        }
        if (timeKeyword) {
            component = FICasualTimeParser.extractTimeComponents(component, timeKeyword);
        }
        return component;
    }
}
//# sourceMappingURL=FICasualDateParser.js.map