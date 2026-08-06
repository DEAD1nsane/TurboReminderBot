import { Meridiem } from "../../../types.js";
import { AbstractTimeExpressionParser } from "../../../common/parsers/AbstractTimeExpressionParser.js";
export default class ITTimeExpressionParser extends AbstractTimeExpressionParser {
    constructor(strictMode) {
        super(strictMode);
    }
    followingPhase() {
        return "\\s*(?:\\-|\\–|\\~|\\〜|a|fino\\s*a|alle?|\\?)\\s*";
    }
    primaryPrefix() {
        return "(?:(?:alle?|dalle?)\\s*)??";
    }
    primarySuffix() {
        return "(?:\\s*(?:di\\s*(?:sera|notte|mattina|pomeriggio)))?(?!/)(?=\\W|$)";
    }
    extractPrimaryTimeComponents(context, match) {
        const components = super.extractPrimaryTimeComponents(context, match);
        if (!components) {
            return components;
        }
        if (match[0].match(/di\s*(?:sera|notte)/i)) {
            const hour = components.get("hour");
            if (hour >= 6 && hour < 12) {
                components.assign("hour", components.get("hour") + 12);
                components.assign("meridiem", Meridiem.PM);
            }
            else if (hour < 6) {
                components.assign("meridiem", Meridiem.AM);
            }
        }
        if (match[0].match(/di\s*pomeriggio/i)) {
            components.assign("meridiem", Meridiem.PM);
            const hour = components.get("hour");
            if (hour >= 0 && hour <= 6) {
                components.assign("hour", components.get("hour") + 12);
            }
        }
        if (match[0].match(/di\s*mattina/i)) {
            components.assign("meridiem", Meridiem.AM);
            const hour = components.get("hour");
            if (hour < 12) {
                components.assign("hour", components.get("hour"));
            }
        }
        return components.addTag("parser/ITTimeExpressionParser");
    }
    extractFollowingTimeComponents(context, match, result) {
        const followingComponents = super.extractFollowingTimeComponents(context, match, result);
        if (followingComponents) {
            followingComponents.addTag("parser/ITTimeExpressionParser");
        }
        return followingComponents;
    }
}
//# sourceMappingURL=ITTimeExpressionParser.js.map