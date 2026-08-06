import AbstractMergeDateRangeRefiner from "../../../common/refiners/AbstractMergeDateRangeRefiner.js";
export default class FIMergeDateRangeRefiner extends AbstractMergeDateRangeRefiner {
    patternBetween() {
        return /^\s*(-|–)\s*$/i;
    }
}
//# sourceMappingURL=FIMergeDateRangeRefiner.js.map