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
const references = __importStar(require("../../../common/casualReferences"));
const PATTERN = /\b(hôm nay|hôm qua|hôm kia|ngày mai|ngày kia|bây giờ|lúc này)(?=\W|$)/i;
class VICasualDateParser extends AbstractParserWithWordBoundary_1.AbstractParserWithWordBoundaryChecking {
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
exports.default = VICasualDateParser;
//# sourceMappingURL=VICasualDateParser.js.map