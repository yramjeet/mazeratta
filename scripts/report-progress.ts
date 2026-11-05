const NUMBERED_STEP_TITLE = /^\d+\. \*\*(.+?)\.?\*\*/;

export function stepTitles(steps: string[]) {
  return steps.flatMap((line) => line.match(NUMBERED_STEP_TITLE)?.[1] ?? []);
}

export function progressSection(titles: string[]) {
  return [
    `## Report progress`,
    "",
    `Keep the user informed as you go, so they can follow along and stop you:`,
    "",
    `- Before each step, say \`Step N/${titles.length}: <title>\`.`,
    `- After it, say in one line what changed: the files created, edited, moved or deleted, or that nothing was needed.`,
    `- If a step can't be done as written, stop and say why before doing anything else.`,
    `- At the end, summarise: every file created, edited, moved or deleted, and each "Done when" check with its result.`,
    "",
    `The steps:`,
    "",
    ...titles.map((title, i) => `${i + 1}. ${title}`),
    "",
  ];
}
