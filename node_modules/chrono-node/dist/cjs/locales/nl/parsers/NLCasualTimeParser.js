"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const types_1 = require("../../../types");
const AbstractParserWithWordBoundary_1 = require("../../../common/parsers/AbstractParserWithWordBoundary");
const dates_1 = require("../../../utils/dates");
const DAY_GROUP = 1;
const MOMENT_GROUP = 2;
class NLCasualTimeParser extends AbstractParserWithWordBoundary_1.AbstractParserWithWordBoundaryChecking {
    innerPattern() {
        return /(deze)?\s*(namiddag|avond|middernacht|ochtend|middag|'s middags|'s avonds|'s ochtends)(?=\W|$)/i;
    }
    innerExtract(context, match) {
        const targetDate = context.refDate;
        const component = context.createParsingComponents();
        if (match[DAY_GROUP] === "deze") {
            component.assign("day", context.refDate.getDate());
            component.assign("month", context.refDate.getMonth() + 1);
            component.assign("year", context.refDate.getFullYear());
        }
        switch (match[MOMENT_GROUP].toLowerCase()) {
            case "namiddag":
            case "'s namiddags":
                component.imply("meridiem", types_1.Meridiem.PM);
                component.imply("hour", 15);
                component.addTag("casualReference/afternoon");
                break;
            case "avond":
            case "'s avonds'":
                component.imply("meridiem", types_1.Meridiem.PM);
                component.imply("hour", 20);
                component.addTag("casualReference/evening");
                break;
            case "middernacht":
                const nextDay = new Date(targetDate.getTime());
                nextDay.setDate(nextDay.getDate() + 1);
                (0, dates_1.assignSimilarDate)(component, nextDay);
                (0, dates_1.implySimilarTime)(component, nextDay);
                component.imply("hour", 0);
                component.imply("minute", 0);
                component.imply("second", 0);
                component.addTag("casualReference/midnight");
                break;
            case "ochtend":
            case "'s ochtends":
                component.imply("meridiem", types_1.Meridiem.AM);
                component.imply("hour", 6);
                component.addTag("casualReference/morning");
                break;
            case "middag":
            case "'s middags":
                component.imply("meridiem", types_1.Meridiem.AM);
                component.imply("hour", 12);
                component.addTag("casualReference/noon");
                break;
        }
        return component;
    }
}
exports.default = NLCasualTimeParser;
//# sourceMappingURL=NLCasualTimeParser.js.map