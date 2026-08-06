import { Configuration } from "../../chrono";
export default class ITDefaultConfiguration {
    createCasualConfiguration(): Configuration;
    createConfiguration(strictMode?: boolean): Configuration;
}
