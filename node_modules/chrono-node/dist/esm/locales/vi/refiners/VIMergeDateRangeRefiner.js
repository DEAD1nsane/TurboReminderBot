import AbstractMergeDateRangeRefiner from "../../../common/refiners/AbstractMergeDateRangeRefiner.js";
export default class VIMergeDateRangeRefiner extends AbstractMergeDateRangeRefiner {
    patternBetween() {
        return /^\s*(?:–|-|đến|tới|và)\s*$/;
    }
}
//# sourceMappingURL=VIMergeDateRangeRefiner.js.map