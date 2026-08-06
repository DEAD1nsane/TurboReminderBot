import { AbstractParserWithWordBoundaryChecking } from "../../../common/parsers/AbstractParserWithWordBoundary.js";
import * as references from "../../../common/casualReferences.js";
const PATTERN = /\b(hôm nay|hôm qua|hôm kia|ngày mai|ngày kia|bây giờ|lúc này)(?=\W|$)/i;
export default class VICasualDateParser extends AbstractParserWithWordBoundaryChecking {
    innerPattern() {
        return PATTERN;
    }
    innerExtract(context, match) {
        switch (match[1].toLowerCase()) {
            case "bây giờ":
            case "lúc này":
                return references.now(context.reference);
            case "hôm nay":
                return references.today(context.reference);
            case "hôm qua":
                return references.yesterday(context.reference);
            case "hôm kia":
                return references.theDayBefore(context.reference, 2);
            case "ngày mai":
                return references.tomorrow(context.reference);
            case "ngày kia":
                return references.theDayAfter(context.reference, 2);
        }
        return context.createParsingComponents();
    }
}
//# sourceMappingURL=VICasualDateParser.js.map