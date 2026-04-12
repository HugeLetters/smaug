import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Record from "effect/Record";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import { type Palette, Presets } from "./palette";

function generatePaletteCss(palette: Palette): string {
	const paletteCss = Record.reduce(palette, "", (res, shadeMap, token) => {
		const tokenCss = Record.reduce(shadeMap, "", (res, color, shade) => {
			return `${res}--color-${token}-${shade}: ${color};`;
		});

		return `${res}\n/* ${token} */\n${tokenCss}\n`;
	});
	return `@theme {${paletteCss}}`;
}
class GeneratePaletteError extends Data.TaggedError("GeneratePaletteError")<{
	readonly message: string;
}> {}
export const GeneratePalette = Effect.gen(function* () {
	const presets = yield* Presets;
	const css = generatePaletteCss(presets.default);

	const path = yield* Path.Path;
	const fs = yield* FileSystem.FileSystem;

	const outputPath = path.resolve(import.meta.dir, "palette.css");
	const exists = yield* fs.exists(outputPath);
	if (!exists) {
		return yield* new GeneratePaletteError({
			message: `${outputPath} does not exist`,
		});
	}

	yield* fs.writeFileString(outputPath, css);

	const formatCommand = ChildProcess.make("bun", ["run", "format", outputPath]);

	const formatProcess = yield* formatCommand;
	const exit = yield* formatProcess.exitCode;
	if (exit !== 0) {
		return yield* new GeneratePaletteError({
			message: `Format exited with ${exit}`,
		});
	}
});
