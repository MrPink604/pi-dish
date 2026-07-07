import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const CUSTOM_TYPE = "mood-state";
const DEFAULT_FACE = "(•‿•)";
const DEFAULT_DESCRIPTION = "calm";
const MAX_FACE_WIDTH = 24;
const MAX_DESCRIPTION_WIDTH = 14;

type MoodState = {
	description: string;
	face: string;
};

function sanitizeFace(value: string): string {
	const face = value.trim().replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ");
	if (!face) return DEFAULT_FACE;
	return truncateToWidth(face, MAX_FACE_WIDTH, "…");
}

function sanitizeDescription(value: string): string {
	const description = value.trim().split(/\s+/)[0] ?? "";
	if (!description) return DEFAULT_DESCRIPTION;
	return truncateToWidth(description.toLowerCase(), MAX_DESCRIPTION_WIDTH, "…");
}

function formatMood(state: MoodState): string {
	return `${state.description} ${state.face}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

class MoodEditor extends CustomEditor {
	constructor(
		tui: ConstructorParameters<typeof CustomEditor>[0],
		private readonly moodTheme: ConstructorParameters<typeof CustomEditor>[1],
		keybindings: ConstructorParameters<typeof CustomEditor>[2],
		private readonly getMood: () => MoodState,
	) {
		super(tui, moodTheme, keybindings);
	}

	render(width: number): string[] {
		const lines = super.render(width);
		if (lines.length === 0 || width <= 0) return lines;

		const label = this.moodTheme.borderColor(formatMood(this.getMood()));
		const labelWidth = visibleWidth(label);
		if (labelWidth >= width) return [truncateToWidth(label, width, ""), ...lines];

		// Render above the editor, right-aligned, so it sits at the top-right of
		// the prompt box without cutting into the border line.
		return [" ".repeat(width - labelWidth) + label, ...lines];
	}
}

export default function (pi: ExtensionAPI) {
	let mood: MoodState = { description: DEFAULT_DESCRIPTION, face: DEFAULT_FACE };

	function setMood(face: string, description = mood.description) {
		mood = {
			description: sanitizeDescription(description),
			face: sanitizeFace(face),
		};
	}

	function restoreMood(ctx: ExtensionContext) {
		mood = { description: DEFAULT_DESCRIPTION, face: DEFAULT_FACE };
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "set_mood") {
				const details = entry.message.details;
				if (isRecord(details)) {
					if (typeof details.face === "string") setMood(details.face, String(details.description ?? mood.description));
					else if (typeof details.mood === "string") setMood(details.mood, String(details.description ?? mood.description));
				}
			}
			if (entry.type === "custom" && entry.customType === CUSTOM_TYPE) {
				const data = entry.data;
				if (isRecord(data)) {
					if (typeof data.face === "string") setMood(data.face, String(data.description ?? mood.description));
					else if (typeof data.mood === "string") setMood(data.mood, String(data.description ?? mood.description));
				}
			}
		}
	}

	pi.on("session_start", (_event, ctx) => {
		restoreMood(ctx);
		ctx.ui.setEditorComponent((tui, theme, keybindings) => new MoodEditor(tui, theme, keybindings, () => mood));
	});

	pi.registerCommand("mood", {
		description: "Set the prompt-box mood indicator: /mood <one-word-description> <kaomoji>",
		handler: async (args, ctx) => {
			let next = args?.trim();
			if (!next) next = await ctx.ui.input("Mood: one word then kaomoji", formatMood(mood));
			if (!next) return;
			const [description = DEFAULT_DESCRIPTION, ...faceParts] = next.split(/\s+/);
			setMood(faceParts.join(" ") || mood.face, description);
			pi.appendEntry(CUSTOM_TYPE, { ...mood });
			ctx.ui.notify(`Mood set to ${formatMood(mood)}`, "info");
		},
	});

	pi.registerTool({
		name: "set_mood",
		label: "Set Mood",
		description: "Set the assistant's current mood as a one-word description plus a kaomoji shown at the top-right of the prompt box.",
		promptSnippet: "Set the assistant's visible current mood as a one-word description and kaomoji in the prompt box",
		promptGuidelines: [
			"Use set_mood when your apparent mood changes or when the user asks you to show a mood; pass one concise one-word description plus one concise kaomoji, such as description=focused kaomoji=(ง'̀-'́)ง.",
		],
		parameters: Type.Object({
			description: Type.String({ description: "Exactly one word describing the assistant's current mood, e.g. focused, playful, curious." }),
			kaomoji: Type.String({ description: "One concise kaomoji that represents the assistant's current mood." }),
		}),
		async execute(_toolCallId, params) {
			setMood(params.kaomoji, params.description);
			return {
				content: [{ type: "text", text: `Mood set to ${formatMood(mood)}` }],
				details: { ...mood },
			};
		},
		renderCall(args, theme) {
			const state = {
				description: sanitizeDescription(String(args.description ?? "")),
				face: sanitizeFace(String(args.kaomoji ?? "")),
			};
			const text = `${theme.fg("toolTitle", theme.bold("set_mood"))} ${theme.fg("accent", formatMood(state))}`;
			return new Text(text, 0, 0);
		},
	});
}
