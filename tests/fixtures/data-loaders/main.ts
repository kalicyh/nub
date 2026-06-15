// Data loaders are DEFAULT-EXPORT ONLY (no per-key named exports). Consumers
// destructure the default; a named import (`import { host } from "./c.yaml"`)
// is a load-time error on nub, asserted separately by the
// data_named_import_is_a_load_error test against the data-loaders-named fixture.
import config from "./config.jsonc";
import greeting from "./greeting.txt";
import yaml from "./config.yaml";
const { database, tags } = yaml;
console.log("jsonc:" + config.host);
console.log("txt:" + greeting.trim());
console.log("yaml-host:" + database.host);
console.log("yaml-port:" + database.port);
console.log("yaml-tags:" + tags.join(","));
console.log("yaml-default:" + yaml.database.name);
import toml from "./config.toml";
const { title, server } = toml;
console.log("toml-title:" + title);
console.log("toml-port:" + server.port);
console.log("toml-tls:" + server.tls.enabled);
console.log("toml-debug:" + toml.debug);
// `package` is a reserved word: reachable via the default export (A15).
console.log("toml-pkg:" + toml.package.name);
import json5 from "./config.json5";
const { name, features } = json5;
console.log("json5-name:" + name);
console.log("json5-ver:" + json5.version);
console.log("json5-feat:" + features.join(","));
