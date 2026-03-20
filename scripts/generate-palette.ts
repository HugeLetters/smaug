import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import { GeneratePalette } from "~/color/generate";

GeneratePalette.pipe(
	Effect.provide([Logger.layer([Logger.consolePretty()]), BunServices.layer]),
	Effect.scoped,
	BunRuntime.runMain,
);
