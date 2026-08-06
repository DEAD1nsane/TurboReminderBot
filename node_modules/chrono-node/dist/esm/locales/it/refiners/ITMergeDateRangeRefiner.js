import AbstractMergeDateRangeRefiner from "../../../common/refiners/AbstractMergeDateRangeRefiner.js";
export default class ITMergeDateRangeRefiner extends AbstractMergeDateRangeRefiner {
    patternBetween() {
        return /^\s*(a|al|-|–|fino\s*a|fino\s*al)\s*$/i;
    }
}
//# sourceMappingURL=ITMergeDateRangeRefiner.js.map