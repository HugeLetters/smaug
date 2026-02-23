import * as FileSystem from "@effect/platform/FileSystem";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

interface JsonFileConfig {
	readonly path: string;
}
const JsonSchema = Schema.parseJson();
export const jsonFileConfigProvider = Effect.fn("jsonFileConfigProvider")(
	function* ({ path }: JsonFileConfig) {
		const json = yield* FileSystem.FileSystem.pipe(
			Effect.flatMap((fs) => fs.readFileString(path)),
			Effect.flatMap((file) => Schema.decode(JsonSchema)(file)),
		);
		return ConfigProvider.fromJson(json);
	},
);
