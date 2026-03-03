import * as FileSystem from "@effect/platform/FileSystem";
import * as Config from "effect/Config";
import * as ConfigError from "effect/ConfigError";
import * as ConfigProvider from "effect/ConfigProvider";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Option from "effect/Option";
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

export function dateTimeConfig(name: string) {
	return Config.date(name).pipe(
		Config.mapOrFail((date) => {
			const parsed = DateTime.make(date);
			if (Option.isNone(parsed)) {
				return Either.left(
					ConfigError.InvalidData([], `Invalid date: ${date}`),
				);
			}

			return Either.right(parsed.value);
		}),
	);
}
