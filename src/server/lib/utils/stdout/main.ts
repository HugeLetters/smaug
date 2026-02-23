function ansiColor(colorName: string) {
	return Bun.color(colorName, "ansi");
}

export function colored(color: string, message: unknown) {
	return `${ansiColor(color)}${message}\x1b[0m`;
}

export function green(message: unknown) {
	return colored("limegreen", message);
}
