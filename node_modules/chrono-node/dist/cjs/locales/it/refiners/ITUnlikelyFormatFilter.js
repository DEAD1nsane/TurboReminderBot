"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const abstractRefiners_1 = require("../../../common/abstractRefiners");
class ITUnlikelyFormatFilter extends abstractRefiners_1.Filter {
    constructor() {
        super();
    }
    isValid(context, result) {
        const text = result.text.trim();
        if (text === context.text.trim()) {
            return true;
        }
        if (text.toLowerCase().endsWith("il secondo") || text.toLowerCase() === "secondo") {
            const textAfter = context.text.substring(result.index + result.text.length).trim();
            if (textAfter.length > 0) {
                context.debug(() => {
                    console.log(`Removing unlikely result: ${result}`);
                });
            }
            return false;
        }
        return true;
    }
}
exports.default = ITUnlikelyFormatFilter;
//# sourceMappingURL=ITUnlikelyFormatFilter.js.map