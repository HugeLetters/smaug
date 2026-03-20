import { inspect } from "node:util";
import { regex } from "arkregex";
import * as Chunk from "effect/Chunk";
import * as Match from "effect/Match";

export interface Empty {
	readonly _tag: "Empty";
}

export interface Nested {
	readonly _tag: "Nested";
	readonly label: string;
	readonly patch: Tree;
}

export interface Sequence {
	readonly _tag: "Sequence";
	readonly patch: Chunk.Chunk<Tree>;
}

export interface Unit {
	readonly _tag: "Unit";
	readonly content: string;
}

export type Tree = Empty | Unit | Nested | Sequence;

export const empty: Tree = { _tag: "Empty" };

const ItemPrefix = "├──";
const LastPrefix = "└──";
const LinePrefix = "│  ";
const AfterLastPrefix = "   ";
interface TreeMeta {
	prefix: {
		item: string;
		line: string;
		last: string;
		afterLast: string;
	};
}

export function drawTree(
	tree: Tree,
	meta: TreeMeta = {
		prefix: {
			item: "",
			last: "",
			line: "",
			afterLast: "",
		},
	},
): string {
	const { prefix } = meta;
	return Match.value(tree).pipe(
		Match.tagsExhaustive({
			Empty() {
				return `${prefix.last}<unchanged>`;
			},
			Unit(tree) {
				return `${prefix.last}${tree.content}`;
			},
			Sequence(tree) {
				const nonEmptyPatches = tree.patch.pipe(
					flattenSequence,
					Chunk.filter((tree) => tree._tag !== "Empty"),
				);

				if (Chunk.isEmpty(nonEmptyPatches)) {
					return `${prefix.last}${drawTree(empty)}`;
				}

				return nonEmptyPatches.pipe(
					Chunk.map((tree, i) => {
						const isLast = i === nonEmptyPatches.length - 1;
						return `${drawTree(tree, {
							prefix: {
								...prefix,
								line: isLast
									? prefix.line
									: prefix.line.replace(
											regex(`${AfterLastPrefix}$`),
											LinePrefix,
										),
								last: isLast ? prefix.last : prefix.item,
							},
						})}`;
					}),
					Chunk.join("\n"),
				);
			},
			Nested(tree) {
				const patch = drawTree(tree.patch, {
					prefix: {
						item: `${prefix.line}${ItemPrefix}`,
						line: `${prefix.line}${AfterLastPrefix}`,
						last: `${prefix.line}${LastPrefix}`,
						afterLast: `${prefix.line}${AfterLastPrefix}`,
					},
				});
				return `${prefix.last}${tree.label}\n${patch}`;
			},
		}),
	);
}

function flattenSequence(
	patches: Chunk.Chunk<Tree>,
): Chunk.Chunk<Exclude<Tree, Sequence>> {
	return Chunk.flatMap(patches, (tree) => {
		if (tree._tag !== "Sequence") {
			return Chunk.of(tree);
		}

		return flattenSequence(tree.patch);
	});
}

export function formatValue(value: unknown) {
	return inspect(value, {
		compact: true,
		colors: true,
		depth: 0,
		maxArrayLength: 0,
		maxStringLength: 10,
		breakLength: Number.POSITIVE_INFINITY,
	});
}
