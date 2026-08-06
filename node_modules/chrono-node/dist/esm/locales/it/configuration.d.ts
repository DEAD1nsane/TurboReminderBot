import { Configuration } from "../../chrono.js";
export default class ITDefaultConfiguration {
    createCasualConfiguration(): Configuration;
    createConfiguration(strictMode?: boolean): Configuration;
}
