"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const AbstractParserWithWordBoundary_1 = require("../../../common/parsers/AbstractParserWithWordBoundary");
const dates_1 = require("../../../utils/dates");
const references = __importStar(require("../../../common/casualReferences"));
const PATTERN = /(adesso|ora|oggi|stasera|stanotte|domani|dopodomani|ieri|ieri\s*sera|ieri\s*notte)(?=\W|$)/i;
class ITCasualDateParser extends AbstractParserWithWordBoundary_1.AbstractParserWithWordBoundaryChecking {
    innerPattern(context) {
        return PATTERN;
    }
    innerExtract(context, match) {
        let targetDate = context.refDate;
        const lowerText = match[0].toLowerCase();
        let component = context.createParsingComponents();
        switch (lowerText) {
            case "adesso":
            case "ora":
                component = references.now(context.reference);
                break;
            case "oggi":
                component = references.today(context.reference);
                break;
            case "ieri":
                component = references.yesterday(context.reference);
                break;
            case "domani":
                component = references.tomorrow(context.reference);
                break;
            case "stasera":
            case "stanotte":
                component = references.tonight(context.reference);
                break;
            case "dopodomani":
                component = references.theDayAfter(context.reference, 2);
                break;
            default:
                if (lowerText.match(/ieri\s*sera/) || lowerText.match(/ieri\s*notte/)) {
                    if (targetDate.getHours() > 6) {
                        const previousDay = new Date(targetDate.getTime());
                        previousDay.setDate(previousDay.getDate() - 1);
                        targetDate = previousDay;
                    }
                    (0, dates_1.assignSimilarDate)(component, targetDate);
                    component.imply("hour", 0);
                }
                break;
        }
        component.addTag("parser/ITCasualDateParser");
        return component;
    }
}
exports.default = ITCasualDateParser;
//# sourceMappingURL=ITCasualDateParser.js.map