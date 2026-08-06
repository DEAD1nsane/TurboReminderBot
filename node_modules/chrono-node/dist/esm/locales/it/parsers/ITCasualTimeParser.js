import { AbstractParserWithWordBoundaryChecking } from "../../../common/parsers/AbstractParserWithWordBoundary.js";
import * as casualReferences from "../../../common/casualReferences.js";
const PATTERN = /(stamattina|stasera|stanotte|stamani)|(questa\s*)?(mattina|pomeriggio|sera|notte|mezzanotte|mezzogiorno)(?=\W|$)/i;
export default class ITCasualTimeParser extends AbstractParserWithWordBoundaryChecking {
    innerPattern() {
        return PATTERN;
    }
    innerExtract(context, match) {
        let component = null;
        if (match[1]) {
            switch (match[1].toLowerCase()) {
                case "stamattina":
                case "stamani":
                    component = casualReferences.morning(context.reference);
                    break;
                case "stasera":
                case "stanotte":
                    component = casualReferences.evening(context.reference);
                    break;
            }
        }
        else if (match[3]) {
            switch (match[3].toLowerCase()) {
                case "pomeriggio":
                    component = casualReferences.afternoon(context.reference);
                    break;
                case "sera":
                case "notte":
                    component = casualReferences.evening(context.reference);
                    break;
                case "mezzanotte":
                    component = casualReferences.midnight(context.reference);
                    break;
                case "mattina":
                    component = casualReferences.morning(context.reference);
                    break;
                case "mezzogiorno":
                    component = casualReferences.noon(context.reference);
                    break;
            }
        }
        if (component) {
            component.addTag("parser/ITCasualTimeParser");
        }
        return component;
    }
}
//# sourceMappingURL=ITCasualTimeParser.js.map