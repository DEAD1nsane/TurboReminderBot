import { AbstractTimeExpressionParser } from "../../../common/parsers/AbstractTimeExpressionParser.js";
export default class FITimeExpressionParser extends AbstractTimeExpressionParser {
    primaryPrefix() {
        return "(?:(?:klo|kello)\\s*)?";
    }
    followingPhase() {
        return "\\s*(?:\\-|\\–|\\~|\\〜)\\s*";
    }
    extractPrimaryTimeComponents(context, match) {
        if (match[0].match(/^\s*\d{4}\s*$/)) {
            return null;
        }
        return super.extractPrimaryTimeComponents(context, match);
    }
}
//# sourceMappingURL=FITimeExpressionParser.js.map