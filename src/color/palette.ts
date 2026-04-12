import { regex } from "arkregex";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Record from "effect/Record";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import * as SchemaIssue from "effect/SchemaIssue";
import type * as Types from "effect/Types";

const Shade = Schema.Literals([
	"50",
	"100",
	"200",
	"300",
	"400",
	"500",
	"600",
	"700",
	"800",
	"900",
]);
type Shade = typeof Shade.Type;

const ShadeToColorMap = Schema.Record(Shade, Schema.String);
type ShadeToColorMap = typeof ShadeToColorMap.Type;

type Token =
	| "primary"
	| "secondary"
	| "accent"
	| "neutral"
	| "success"
	| "warning"
	| "error";

type BasePalette = Record<Token, string>;
export type Palette = Record.ReadonlyRecord<Token, ShadeToColorMap>;

const oklchRegex = regex(
	"^oklch\\((?<l>[\\d.]+) (?<c>[\\d.]+) (?<h>[\\d.]+)\\)$",
);

const OklchFromSelf = Schema.Struct({
	l: Schema.Number,
	c: Schema.Number,
	h: Schema.Number,
});

const Oklch = Schema.String.pipe(
	Schema.decodeTo(OklchFromSelf, {
		decode: SchemaGetter.transformOrFail((s) => {
			const match = oklchRegex.exec(s);
			if (!match) {
				return Effect.fail(
					new SchemaIssue.InvalidValue(Option.some(s), {
						message: "Invalid OKLCH format",
					}),
				);
			}
			return Effect.succeed({
				l: parseFloat(match.groups.l),
				c: parseFloat(match.groups.c),
				h: parseFloat(match.groups.h),
			});
		}),
		encode: SchemaGetter.transform(({ l, c, h }) => {
			return `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)})`;
		}),
	}),
);

/**
 * Generate OKLCH shades from a base color, deriving L and C relative to base for all levels
 * @param baseOklch - Base color in oklch(L C H) format
 * @returns Shades object with 50-900 keys
 */
const generateShades = Effect.fn(function* (baseOklch: string) {
	const {
		l: baseL,
		c: baseC,
		h: baseH,
	} = yield* Schema.decodeEffect(Oklch)(baseOklch);

	// Reference values for relative scaling (based on a mid-tone base at L=0.6, C=0.21)

	// Lightness deltas relative to referenceBaseL (ensures L decreases from 50 to 900)
	const lightnessDeltas: Record<Shade, number> = {
		50: 0.37, // 0.97 - 0.6
		100: 0.29, // 0.89 - 0.6
		200: 0.21, // 0.81 - 0.6
		300: 0.13, // 0.73 - 0.6
		400: -0.05, // 0.55 - 0.6
		500: 0, // base
		600: -0.15, // 0.45 - 0.6
		700: -0.23, // 0.37 - 0.6
		800: -0.31, // 0.29 - 0.6
		900: -0.39, // 0.21 - 0.6
	};

	// Chroma factors relative to referenceBaseC (bell-curve for natural saturation)
	const chromaFactors: Record<Shade, number> = {
		50: 0.095, // 0.02 / 0.21
		100: 0.143, // 0.03 / 0.21
		200: 0.286, // 0.06 / 0.21
		300: 0.524, // 0.11 / 0.21
		400: 0.81, // 0.17 / 0.21
		500: 1, // base
		600: 1.19, // 0.25 / 0.21
		700: 1.095, // 0.23 / 0.21
		800: 0.952, // 0.20 / 0.21
		900: 0.714, // 0.15 / 0.21
	};

	const shades: Partial<Types.Mutable<ShadeToColorMap>> = {};
	for (const shade of Object.keys(lightnessDeltas) as Shade[]) {
		// Derive L from base, clamp to [0,1] for very light/dark bases
		const l = Math.max(0, Math.min(1, baseL + lightnessDeltas[shade]));
		// Derive C from base, scale proportionally, ensure non-negative
		const c = Math.max(0, baseC * chromaFactors[shade]);
		shades[shade] = yield* Schema.encodeEffect(Oklch)({
			l,
			c,
			h: baseH,
		});
	}

	return yield* Schema.decodeUnknownEffect(ShadeToColorMap)(shades);
});

const generatePalette = Effect.fn(function* (baseColors: BasePalette) {
	const entries: Palette = yield* Effect.all(
		Record.mapEntries(baseColors, (oklch, key) => [key, generateShades(oklch)]),
	);
	return entries;
});

export const Presets = Effect.gen(function* () {
	const palette = yield* Effect.all({
		default: generatePalette({
			primary: "oklch(0.62 0.21 259.8)",
			secondary: "oklch(0.62 0.21 240)",
			accent: "oklch(0.62 0.21 30)",
			neutral: "oklch(0.5 0.01 0)",
			success: "oklch(0.72 0.22 149.6)",
			warning: "oklch(0.77 0.19 70.1)",
			error: "oklch(0.64 0.25 16.4)",
		}),
		warm: generatePalette({
			primary: "oklch(0.62 0.21 20)", // Reddish
			secondary: "oklch(0.62 0.21 60)", // Yellowish
			accent: "oklch(0.62 0.21 120)", // Greenish
			neutral: "oklch(0.5 0.01 0)",
			success: "oklch(0.72 0.22 149.6)", // Keep same
			warning: "oklch(0.77 0.19 70.1)",
			error: "oklch(0.64 0.25 16.4)",
		}),
		cool: generatePalette({
			primary: "oklch(0.62 0.21 220)", // Bluish
			secondary: "oklch(0.62 0.21 280)", // Purplish
			accent: "oklch(0.62 0.21 180)", // Cyan
			neutral: "oklch(0.5 0.01 0)",
			success: "oklch(0.72 0.22 149.6)",
			warning: "oklch(0.77 0.19 70.1)",
			error: "oklch(0.64 0.25 16.4)",
		}),
	} satisfies Record.ReadonlyRecord<
		string,
		Effect.Effect<Palette, unknown, unknown>
	>);

	return palette;
});

export type PresetMap = Effect.Success<typeof Presets>;
export type Preset = keyof PresetMap;
