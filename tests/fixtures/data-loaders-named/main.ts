// A named import of a data module must FAIL to instantiate: data loaders emit a
// default export only, so the named binding `database` has no matching export.
// Node reports "does not provide an export named 'database'" at module load.
import { database } from "./config.yaml";
console.log("should-not-print:" + database);
