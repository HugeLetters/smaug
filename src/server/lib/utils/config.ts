import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

interface JsonFileConfig {
	readonly path: string;
}
const JsonFromString = Schema.fromJsonString(Schema.Unknown);
const decodeJson = Schema.decodeEffect(JsonFromString);

export const jsonFileConfigProvider = Effect.fn("jsonFileConfigProvider")(
	function* ({ path }: JsonFileConfig) {
		const fs = yield* FileSystem.FileSystem;
		const json = yield* fs
			.readFileString(path)
			.pipe(Effect.flatMap((file) => decodeJson(file)));

		return ConfigProvider.fromUnknown(json);
	},
);

export function dateTimeConfig(name: string) {
	return Config.schema(Schema.DateTimeUtcFromString, name);
}
