"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const AbstractMergeDateRangeRefiner_1 = __importDefault(require("../../../common/refiners/AbstractMergeDateRangeRefiner"));
class ITMergeDateRangeRefiner extends AbstractMergeDateRangeRefiner_1.default {
    patternBetween() {
        return /^\s*(a|al|-|–|fino\s*a|fino\s*al)\s*$/i;
    }
}
exports.default = ITMergeDateRangeRefiner;
//# sourceMappingURL=ITMergeDateRangeRefiner.js.map